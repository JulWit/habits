package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/JulWit/habits/internal/store"
)

// The client needs these to read a stored value, which is why they are sent
// rather than mirrored in JavaScript.
func TestStateCarriesTheKindDescriptors(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/api/state", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d (%s)", w.Code, w.Body)
	}

	var got struct {
		Colors []string `json:"colors"`
		Kinds  map[string]struct {
			Scale int    `json:"scale"`
			Step  int    `json:"step"`
			Max   int    `json:"max"`
			Unit  string `json:"unit"`
		} `json:"kinds"`
		BlurAtFull int `json:"blurAtFull"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	for _, kind := range []string{"check", "count", "time", "distance"} {
		if _, ok := got.Kinds[kind]; !ok {
			t.Errorf("kinds does not contain %q", kind)
		}
	}
	if got.Kinds["distance"].Scale != 1000 || got.Kinds["distance"].Max != 200000 {
		t.Errorf("distance = %+v", got.Kinds["distance"])
	}
	if got.Kinds["time"].Unit != "min" {
		t.Errorf("time.unit = %q, want min", got.Kinds["time"].Unit)
	}
	if got.BlurAtFull != store.BackgroundBlurAtFull {
		t.Errorf("blurAtFull = %d, want %d", got.BlurAtFull, store.BackgroundBlurAtFull)
	}
	if len(got.Colors) == 0 {
		t.Error("colors is empty")
	}
}

// Changing the kind of a habit that has a history would silently reinterpret
// every one of its days, so it is refused — and the refusal says why, in the
// words the editor uses for the type.
func TestKindChangeWithHistoryIsRefusedReadably(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Running","kind":"distance","targetValue":5000,"frequency":{"kind":"daily"}}`,
		"application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if w := do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/2026-09-18",
		`{"value":5200}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("entry: %d (%s)", w.Code, w.Body)
	}

	w = do(t, h, "PATCH", "/api/habits/"+created.ID,
		`{"kind":"count","targetValue":80}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	for _, want := range []string{"Count", "1 day is already recorded"} {
		if !strings.Contains(body.Error, want) {
			t.Errorf("message %q does not mention %q", body.Error, want)
		}
	}
	if strings.Contains(body.Error, `"count"`) {
		t.Errorf("message shows the raw key: %q", body.Error)
	}

	// A second day switches the sentence to its plural form, which is the half
	// a reader sees most often and the half a naive "%d days" would get right
	// by accident.
	if w := do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/2026-09-17",
		`{"value":4800}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("second entry: %d (%s)", w.Code, w.Body)
	}
	w = do(t, h, "PATCH", "/api/habits/"+created.ID,
		`{"kind":"count","targetValue":80}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if !strings.Contains(body.Error, "2 days are already recorded") {
		t.Errorf("message %q does not use the plural form", body.Error)
	}
}
