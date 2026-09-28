package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// maxBodyBytes is the maximum size of a JSON request body.
const maxBodyBytes = 64 << 10

// problemBody is the body of an error response, a problem details object (RFC
// 9457) with two extension members: Code identifies the problem and stays
// stable when the wording changes, Params holds the values of its message.
// The client translates by Code and fills in Params; Detail is the English
// message.
type problemBody struct {
	Title  string         `json:"title"`
	Status int            `json:"status"`
	Code   string         `json:"code"`
	Detail string         `json:"detail"`
	Params map[string]any `json:"params,omitempty"`
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

// writeError writes an error response with the problem code and the English
// message detail.
func writeError(w http.ResponseWriter, status int, code, detail string) {
	writeProblemBody(w, problemBody{Status: status, Code: code, Detail: detail})
}

// writeProblem writes an error response for err, with its code and parameters
// if err is a *domain.Problem.
func writeProblem(w http.ResponseWriter, status int, err error) {
	var p *domain.Problem
	if !errors.As(err, &p) {
		writeError(w, status, "error", err.Error())
		return
	}
	writeProblemBody(w, problemBody{Status: status, Code: p.Code, Detail: p.Message(), Params: p.Params})
}

func writeProblemBody(w http.ResponseWriter, body problemBody) {
	body.Title = http.StatusText(body.Status)
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(body.Status)
	if err := json.NewEncoder(w).Encode(body); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		slog.Error("writing response failed", "error", err)
	}
}

// notFoundJSON answers unknown API paths with 404.
func notFoundJSON(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "unknown_endpoint", "Unknown endpoint")
}

// decodeJSON decodes the request body into dst and writes an error response if
// that fails. Unknown fields are rejected. Requiring Content-Type
// application/json forces a CORS preflight and thus protects against CSRF.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONLimit(w, r, dst, maxBodyBytes)
}

// decodeJSONLimit is decodeJSON for bodies of up to limit bytes.
func decodeJSONLimit(w http.ResponseWriter, r *http.Request, dst any, limit int64) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type",
			"Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body: "+err.Error())
		return false
	}
	if dec.More() {
		writeError(w, http.StatusBadRequest, "invalid_body", "Request body contains more than one JSON document")
		return false
	}
	return true
}

// writeStoreError writes an error response for err: 404 for store.ErrNotFound,
// 422 for validation errors and 500 otherwise.
func (s *Server) writeStoreError(w http.ResponseWriter, err error, context string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Not found")
	case errors.Is(err, domain.ErrValidation):
		writeProblem(w, http.StatusUnprocessableEntity, err)
	default:
		s.log.Error(context, "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
	}
}
