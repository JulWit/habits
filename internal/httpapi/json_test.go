package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Mutating requests require Content-Type application/json (CSRF protection).
func TestMutationsRequireTheJSONContentType(t *testing.T) {
	h := newTestServer(t)
	habit := `{"name":"Reading","kind":"check","frequency":{"kind":"daily"}}`

	for _, ct := range []string{
		"text/plain",
		"text/plain;charset=UTF-8",
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=x",
		"", // no header at all
	} {
		w := do(t, h, "POST", "/api/habits", habit, ct)
		if w.Code != http.StatusUnsupportedMediaType {
			t.Errorf("Content-Type %q: status %d, want 415", ct, w.Code)
		}
	}

	// application/json is accepted with or without charset.
	for _, ct := range []string{"application/json", "application/json; charset=utf-8"} {
		if w := do(t, h, "POST", "/api/habits", habit, ct); w.Code != http.StatusCreated {
			t.Errorf("Content-Type %q: status %d, want 201 (%s)", ct, w.Code, w.Body)
		}
	}
}

// Validation messages do not contain the "validation error: " prefix.
func TestValidationMessagesReachTheUserPlain(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"   ","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if body.Detail != "name must not be empty" {
		t.Errorf("detail = %q, want %q", body.Detail, "name must not be empty")
	}
}

// Errors are problem details with a stable code and the parameters of their
// message, which the client translates.
func TestErrorsAreProblemDetailsWithACode(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"`+strings.Repeat("x", 81)+`","kind":"check","frequency":{"kind":"daily"}}`,
		"application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Title  string         `json:"title"`
		Status int            `json:"status"`
		Code   string         `json:"code"`
		Detail string         `json:"detail"`
		Params map[string]any `json:"params"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if body.Code != "name_too_long" || body.Status != 422 || body.Title != "Unprocessable Entity" {
		t.Errorf("code %q, status %d, title %q", body.Code, body.Status, body.Title)
	}
	if body.Detail != "name is longer than 80 characters" {
		t.Errorf("detail = %q, want %q", body.Detail, "name is longer than 80 characters")
	}
	if body.Params["max"] != float64(80) {
		t.Errorf("params = %v, want max 80", body.Params)
	}
}

// Unknown API paths are answered with a problem, and so is every other error.
func TestUnknownAPIPathAnswersAProblem(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/api/gibtesnicht", "", "")
	if w.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	if !strings.Contains(w.Body.String(), `"code":"unknown_endpoint"`) {
		t.Errorf("body = %s, want the code unknown_endpoint", w.Body)
	}
}
