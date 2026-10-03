package httpapi

import (
	"encoding/json"
	"errors"
	"io"
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

// writeJSON writes payload as JSON with the given status.
func (s *server) writeJSON(w http.ResponseWriter, status int, payload any) {
	s.writeBody(w, "application/json; charset=utf-8", status, payload)
}

// writeBody writes payload encoded as JSON with the given content type and
// status; a nil payload writes no body. API responses are not cached.
func (s *server) writeBody(w http.ResponseWriter, contentType string, status int, payload any) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		s.log.Error("writing response failed", "error", err)
	}
}

// writeError writes an error response with the problem code and the English
// message detail.
func (s *server) writeError(w http.ResponseWriter, status int, code, detail string) {
	s.writeProblemBody(w, problemBody{Status: status, Code: code, Detail: detail})
}

// writeProblem writes an error response for err, with its code and parameters
// if err is a *domain.Problem.
func (s *server) writeProblem(w http.ResponseWriter, status int, err error) {
	p, ok := errors.AsType[*domain.Problem](err)
	if !ok {
		s.writeError(w, status, "error", err.Error())
		return
	}
	s.writeProblemBody(w, problemBody{Status: status, Code: p.Code, Detail: p.Message(), Params: p.Params})
}

// writeProblemBody writes body as a problem details response, titled after
// its status.
func (s *server) writeProblemBody(w http.ResponseWriter, body problemBody) {
	body.Title = http.StatusText(body.Status)
	s.writeBody(w, "application/problem+json", body.Status, body)
}

// notFoundJSON answers unknown API paths with 404.
func (s *server) notFoundJSON(w http.ResponseWriter, r *http.Request) {
	s.writeError(w, http.StatusNotFound, "unknown_endpoint", "Unknown endpoint")
}

// decodeJSON decodes the request body into dst and writes an error response if
// that fails. Unknown fields are rejected. Requiring Content-Type
// application/json forces a CORS preflight and thus protects against CSRF.
func (s *server) decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	return s.decodeJSONLimit(w, r, dst, maxBodyBytes)
}

// decodeJSONLimit is decodeJSON for bodies of up to limit bytes.
func (s *server) decodeJSONLimit(w http.ResponseWriter, r *http.Request, dst any, limit int64) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		s.writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type",
			"Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body: "+err.Error())
		return false
	}
	if dec.More() {
		s.writeError(w, http.StatusBadRequest, "invalid_body", "Request body contains more than one JSON document")
		return false
	}
	return true
}

// writeStoreError writes an error response for err of the request r: 404 for
// store.ErrNotFound, 422 for validation errors and 500 otherwise, which is
// logged with the request's ID and user.
func (s *server) writeStoreError(w http.ResponseWriter, r *http.Request, err error, action string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.writeError(w, http.StatusNotFound, "not_found", "Not found")
	case errors.Is(err, domain.ErrValidation):
		s.writeProblem(w, http.StatusUnprocessableEntity, err)
	default:
		s.logFor(r.Context()).Error(action, "error", err)
		s.writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
	}
}
