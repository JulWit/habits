package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// maxBodyBytes caps request bodies. Habits are small; anything larger is either
// a bug or an attempt to make the server allocate.
const maxBodyBytes = 64 << 10

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// API responses describe mutable state; a cached one would show stale
	// check-marks after a back-navigation.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		// The status line is already sent, so this can only be logged. main
		// installs the application logger as the default, which is what lets a
		// package-level helper reach it without carrying a server around.
		slog.Error("writing response failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorBody{Error: msg})
}

func notFoundJSON(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "Unknown endpoint")
}

// decodeJSON reads a request body strictly: unknown fields are an error, so a
// typo in a client field name surfaces instead of being silently dropped.
//
// The content type is required, and required to be JSON. Without that check the
// endpoint would be reachable cross-site: a form can POST text/plain,
// urlencoded or multipart with no preflight, and a body in any of those can be
// valid JSON. Demanding application/json is what forces the browser to
// preflight the request, which the same-origin policy then refuses — the
// identity here comes from a proxy header behind a session cookie, so there is
// no token of our own doing that job.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType,
			"Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return false
	}
	if dec.More() {
		writeError(w, http.StatusBadRequest, "Request body contains more than one JSON document")
		return false
	}
	return true
}

// writeStoreError maps the layered error types onto status codes in one place,
// so handlers stay free of status-code branching.
func (s *Server) writeStoreError(w http.ResponseWriter, err error, context string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "Not found")
	case errors.Is(err, domain.ErrValidation):
		// The sentinel prefix is how the layers below say "this is the client's
		// mistake, not ours". It has done its job by the time we are here, and
		// "validation error: name must not be empty" is not a sentence to
		// show anyone — the status code already carries that meaning.
		msg := strings.TrimPrefix(err.Error(), domain.ErrValidation.Error()+": ")
		writeError(w, http.StatusUnprocessableEntity, msg)
	default:
		s.log.Error(context, "error", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
	}
}
