package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// A cross-site form can POST text/plain, urlencoded or multipart with no
// preflight, and any of those bodies can be valid JSON. Requiring the JSON
// content type is what forces a preflight, which same-origin policy then stops.
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

	// The real thing still works, with or without a charset parameter.
	for _, ct := range []string{"application/json", "application/json; charset=utf-8"} {
		if w := do(t, h, "POST", "/api/habits", habit, ct); w.Code != http.StatusCreated {
			t.Errorf("Content-Type %q: status %d, want 201 (%s)", ct, w.Code, w.Body)
		}
	}
}

// Validation messages are read by a person in a dialog, so the sentinel prefix
// the layers below use to classify the error must not travel with them.
func TestValidationMessagesReachTheUserPlain(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"   ","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if strings.Contains(body.Error, "validation error") {
		t.Errorf("message carries the sentinel prefix: %q", body.Error)
	}
	if body.Error != "name must not be empty" {
		t.Errorf("message = %q", body.Error)
	}
}

// A message with a number in it is sent as its template as well, since that is
// what the interface's dictionary is keyed by.
func TestValidationMessagesCarryTheirTemplate(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"`+strings.Repeat("x", 81)+`","kind":"check","frequency":{"kind":"daily"}}`,
		"application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Error   string         `json:"error"`
		Message string         `json:"message"`
		Params  map[string]any `json:"params"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if body.Error != "name is longer than 80 characters" {
		t.Errorf("error = %q", body.Error)
	}
	if body.Message != "name is longer than {max} characters" {
		t.Errorf("message = %q", body.Message)
	}
	if body.Params["max"] != float64(80) {
		t.Errorf("params = %v, want max 80", body.Params)
	}
}

func TestUnknownAPIPathAnswersJSON(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/api/gibtesnicht", "", "")
	if w.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want JSON", ct)
	}
}
