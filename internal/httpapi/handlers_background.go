package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"

	// Registered for their DecodeConfig, which is how the format is decided:
	// the browser's Content-Type is a claim, the bytes are the fact.
	_ "image/jpeg"
	_ "image/png"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/store"
)

// What an upload may be. The picture is stored as it arrived, so the limit is
// also what every page load will carry until the browser has it cached - large
// enough for a photograph off a phone, small enough that a database file stays
// something one can copy.
const maxBackgroundBytes = 12 << 20 // 12 MiB

// And how large it may be once decoded. A file of a few kilobytes can still
// describe a hundred megapixels; decoding that would cost hundreds of megabytes
// of memory, so the dimensions are checked before anything is drawn.
const (
	maxBackgroundSide   = 8000
	maxBackgroundPixels = 40_000_000
)

// handleGetBackground serves the picture, or 404 when the user has none.
func (s *Server) handleGetBackground(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	bg, ok, err := s.store.GetBackground(r.Context(), user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading background")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no background image stored")
		return
	}

	etag := `"` + bg.ETag + `"`
	w.Header().Set("ETag", etag)
	// Revalidate every time, and never in a shared cache: the picture is one
	// user's, and it changes the moment they upload another. The ETag makes
	// that cheap - a 304 is a few bytes.
	w.Header().Set("Cache-Control", "private, no-cache")
	// The type comes from what the decoder recognised, not from the upload, and
	// the browser is told not to guess anything else.
	w.Header().Set("Content-Type", bg.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(bg.Bytes)))
	w.Write(bg.Bytes)
}

// handlePutBackground stores the uploaded picture and switches the page to it.
//
// The body is the file itself rather than a multipart form: there is exactly
// one field, and a raw body is what fetch sends when handed a File.
func (s *Server) handlePutBackground(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, maxBackgroundBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("the image may be at most %d MB", maxBackgroundBytes>>20))
			return
		}
		writeError(w, http.StatusBadRequest, "the image could not be read")
		return
	}

	mime, err := checkImage(raw)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	sum := sha256.Sum256(raw)
	bg := store.Background{Mime: mime, Bytes: raw, ETag: hex.EncodeToString(sum[:])}
	if err := s.store.SaveBackground(r.Context(), user.ID, bg); err != nil {
		s.writeStoreError(w, err, "saving background")
		return
	}

	// Uploading a picture means wanting to see it: the page switches to it
	// rather than leaving the choice in a second place the user has to find.
	// In one transaction, so a setting changed in the dialog at the same moment
	// is not overwritten by a copy read before it landed.
	settings, err := s.store.UpdateSettings(r.Context(), user.ID, func(cur *store.Settings) error {
		cur.Pattern = "image"
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version":  bg.ETag,
		"settings": settings,
	})
}

// handleDeleteBackground removes the picture and puts the page back on a plain
// surface, so the board is never left pointing at something that is gone.
func (s *Server) handleDeleteBackground(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.DeleteBackground(r.Context(), user.ID); err != nil {
		s.writeStoreError(w, err, "deleting background")
		return
	}
	// Reading the pattern and putting it back is the same read-modify-write the
	// upload does, and needs the same transaction around it.
	settings, err := s.store.UpdateSettings(r.Context(), user.ID, func(cur *store.Settings) error {
		if cur.Pattern == "image" {
			cur.Pattern = "none"
		}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": "", "settings": settings})
}

// checkImage decides whether the bytes are an image this server will serve, and
// returns the media type to serve it as.
//
// DecodeConfig reads the header only: it is what gives the format and the
// dimensions without decoding a single pixel.
func checkImage(raw []byte) (string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("the file is not a jpeg or png image")
	}
	var mime string
	switch format {
	case "jpeg":
		mime = "image/jpeg"
	case "png":
		mime = "image/png"
	default:
		return "", fmt.Errorf("only jpeg and png are supported, not %s", format)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return "", fmt.Errorf("the image has no area")
	}
	if cfg.Width > maxBackgroundSide || cfg.Height > maxBackgroundSide {
		return "", fmt.Errorf("the image may be at most %d pixels per edge", maxBackgroundSide)
	}
	if cfg.Width*cfg.Height > maxBackgroundPixels {
		return "", fmt.Errorf("the image has too many pixels (at most %d million)",
			maxBackgroundPixels/1_000_000)
	}
	return mime, nil
}
