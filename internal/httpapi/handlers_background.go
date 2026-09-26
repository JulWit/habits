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

	// Image formats accepted by checkImage.
	_ "image/jpeg"
	_ "image/png"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// maxBackgroundBytes is the maximum file size of a background image.
const maxBackgroundBytes = 12 << 20 // 12 MiB

// Maximum dimensions of a background image.
const (
	maxBackgroundSide   = 8000
	maxBackgroundPixels = 40_000_000
)

// handleGetBackground serves the user's background image, or 404 if there is
// none.
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
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Content-Type", bg.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(bg.Bytes)))
	w.Write(bg.Bytes)
}

// handlePutBackground stores the image in the request body (not multipart) as
// the user's background and sets the pattern to "image".
func (s *Server) handlePutBackground(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, maxBackgroundBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge,
				domain.Invalid("the image may be at most {max} MB", "max", maxBackgroundBytes>>20))
			return
		}
		writeError(w, http.StatusBadRequest, "the image could not be read")
		return
	}

	mime, err := checkImage(raw)
	if err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, err)
		return
	}

	sum := sha256.Sum256(raw)
	bg := store.Background{Mime: mime, Bytes: raw, ETag: hex.EncodeToString(sum[:])}
	if err := s.store.SaveBackground(r.Context(), user.ID, bg); err != nil {
		s.writeStoreError(w, err, "saving background")
		return
	}

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

// handleDeleteBackground removes the user's background image and resets the
// pattern "image" to "none".
func (s *Server) handleDeleteBackground(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.DeleteBackground(r.Context(), user.ID); err != nil {
		s.writeStoreError(w, err, "deleting background")
		return
	}
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

// checkImage checks that raw is a JPEG or PNG image within the size limits and
// returns its MIME type. Only the image header is decoded.
func checkImage(raw []byte) (string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return "", domain.Invalid("the file is not a jpeg or png image")
	}
	var mime string
	switch format {
	case "jpeg":
		mime = "image/jpeg"
	case "png":
		mime = "image/png"
	default:
		return "", domain.Invalid("only jpeg and png are supported, not {format}", "format", format)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return "", domain.Invalid("the image has no area")
	}
	if cfg.Width > maxBackgroundSide || cfg.Height > maxBackgroundSide {
		return "", domain.Invalid("the image may be at most {max} pixels per edge", "max", maxBackgroundSide)
	}
	if cfg.Width*cfg.Height > maxBackgroundPixels {
		return "", domain.Invalid("the image has too many pixels (at most {max} million)",
			"max", maxBackgroundPixels/1_000_000)
	}
	return mime, nil
}
