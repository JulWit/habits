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

// maxBodyBytes is the maximum size of a JSON request body.
const maxBodyBytes = 64 << 10

// errorBody is the JSON body of an error response.
type errorBody struct {
	// Error is the English message.
	Error string `json:"error"`
	// Message is the untranslated template of Error and Params its values
	// (see domain.Problem).
	Message string         `json:"message,omitempty"`
	Params  map[string]any `json:"params,omitempty"`
}

// writeJSON writes payload as JSON with the given status. API responses are
// not cached.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		slog.Error("writing response failed", "error", err)
	}
}

// writeError writes an error response with the message msg.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorBody{Error: msg})
}

// writeProblem writes an error response for err, including template and
// parameters if err is a *domain.Problem.
func writeProblem(w http.ResponseWriter, status int, err error) {
	var p *domain.Problem
	if !errors.As(err, &p) {
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, status, errorBody{Error: p.Message(), Message: p.Template, Params: p.Params})
}

// notFoundJSON answers unknown API paths with 404.
func notFoundJSON(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "Unknown endpoint")
}

// decodeJSON decodes the request body into dst and writes an error response if
// that fails. Unknown fields are rejected. Requiring Content-Type
// application/json forces a CORS preflight and thus protects against CSRF.
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

// writeStoreError writes an error response for err: 404 for store.ErrNotFound,
// 422 for validation errors and 500 otherwise.
func (s *Server) writeStoreError(w http.ResponseWriter, err error, context string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "Not found")
	case errors.Is(err, domain.ErrValidation):
		var p *domain.Problem
		if errors.As(err, &p) {
			writeProblem(w, http.StatusUnprocessableEntity, p)
			return
		}
		// Strip the "validation error: " prefix.
		msg := strings.TrimPrefix(err.Error(), domain.ErrValidation.Error()+": ")
		writeError(w, http.StatusUnprocessableEntity, msg)
	default:
		s.log.Error(context, "error", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
	}
}
