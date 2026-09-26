package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// An out-of-range value is the client's mistake, not the server's: 422, and a
// message rather than "Interner Serverfehler".
func TestBadSettingsAnswer422(t *testing.T) {
	h := newTestServer(t)
	for _, body := range []string{
		`{"theme":"neon"}`,
		`{"font":"comic-sans"}`,
		`{"overviewDays":999}`,
		`{"surfaceOpacity":0}`,
		`{"bandColor":"#123456"}`,
	} {
		w := do(t, h, "PATCH", "/api/settings", body, "application/json")
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422", body, w.Code)
		}
		if strings.Contains(w.Body.String(), "Interner Serverfehler") {
			t.Errorf("%s: reported as a server error: %s", body, w.Body)
		}
	}
	// An unknown field is a typo in the client, and says so.
	if w := do(t, h, "PATCH", "/api/settings", `{"thme":"dark"}`, "application/json"); w.Code != http.StatusBadRequest {
		t.Errorf("unknown field: status %d, want 400", w.Code)
	}
}

// A day beyond the per-kind ceiling is refused with a reason, not a 500.
func TestEntryValueIsBounded(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Running","kind":"distance","targetValue":5000,"frequency":{"kind":"daily"}}`,
		"application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("creating habit: %d (%s)", w.Code, w.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}

	path := "/api/habits/" + created.ID + "/entries/2026-09-18"
	if w := do(t, h, "PUT", path, `{"value":999999999}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("value too large: status %d, want 422 (%s)", w.Code, w.Body)
	}
	if w := do(t, h, "PUT", path, `{"value":-5}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("negative value: status %d, want 422", w.Code)
	}
	if w := do(t, h, "PUT", path, `{"value":5000}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("valid value: status %d, want 200 (%s)", w.Code, w.Body)
	}
	// Beyond the horizon is a different rejection, and also not a 500.
	far := "/api/habits/" + created.ID + "/entries/2099-01-01"
	if w := do(t, h, "PUT", far, `{"value":1000}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("date beyond the horizon: status %d, want 422", w.Code)
	}
	// So is a day before the floor; clearing one is still allowed, so an entry
	// stored before the floor existed can be removed.
	old := "/api/habits/" + created.ID + "/entries/1999-12-31"
	if w := do(t, h, "PUT", old, `{"value":1000}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("date before the floor: status %d, want 422", w.Code)
	}
	if w := do(t, h, "PUT", old, `{"value":0}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("clearing before the floor: status %d, want 200 (%s)", w.Code, w.Body)
	}
	first := "/api/habits/" + created.ID + "/entries/2000-01-01"
	if w := do(t, h, "PUT", first, `{"value":1000}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("the floor itself: status %d, want 200 (%s)", w.Code, w.Body)
	}
}

// A habit with chosen weekdays takes no entry on any other day, but a leftover
// entry there can still be cleared.
func TestEntryOnUnscheduledWeekdayIsRefused(t *testing.T) {
	h := newTestServer(t)
	// Monday and Friday.
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Gym","kind":"check","frequency":{"kind":"weekdays","weekdays":17}}`,
		"application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("creating habit: %d (%s)", w.Code, w.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}

	base := "/api/habits/" + created.ID + "/entries/"
	// 2026-09-14 is a Monday, 2026-09-15 a Tuesday.
	if w := do(t, h, "PUT", base+"2026-09-14", `{"value":1}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("scheduled day: status %d, want 200 (%s)", w.Code, w.Body)
	}
	if w := do(t, h, "PUT", base+"2026-09-15", `{"value":1}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("unscheduled day: status %d, want 422 (%s)", w.Code, w.Body)
	}
	if w := do(t, h, "PUT", base+"2026-09-15", `{"value":0}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("clearing an unscheduled day: status %d, want 200 (%s)", w.Code, w.Body)
	}
}

// A custom-interval habit takes no entry on the days in between either.
func TestEntryBetweenCustomIntervalIsRefused(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Run","kind":"check","frequency":{"kind":"custom_interval","intervalDays":3,"anchorDate":"2026-09-14"}}`,
		"application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("creating habit: %d (%s)", w.Code, w.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}

	base := "/api/habits/" + created.ID + "/entries/"
	for _, c := range []struct {
		date string
		want int
	}{
		{"2026-09-14", http.StatusOK},
		{"2026-09-15", http.StatusUnprocessableEntity},
		{"2026-09-16", http.StatusUnprocessableEntity},
		{"2026-09-17", http.StatusOK},
	} {
		if w := do(t, h, "PUT", base+c.date, `{"value":1}`, "application/json"); w.Code != c.want {
			t.Errorf("%s: status %d, want %d (%s)", c.date, w.Code, c.want, w.Body)
		}
	}
	if w := do(t, h, "PUT", base+"2026-09-15", `{"value":0}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("clearing a day in between: status %d, want 200 (%s)", w.Code, w.Body)
	}
}

// A write answers with the habit's new timestamp, so the detail view can show
// the last change without reloading the habit.
func TestEntryAnswersWithUpdatedAt(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("creating habit: %d (%s)", w.Code, w.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}

	w = do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/2026-09-18", `{"value":1}`, "application/json")
	if w.Code != http.StatusOK {
		t.Fatalf("setting entry: %d (%s)", w.Code, w.Body)
	}
	var answer struct {
		UpdatedAt time.Time `json:"updatedAt"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &answer); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	w = do(t, h, "GET", "/api/habits/"+created.ID, "", "")
	var stored struct {
		UpdatedAt time.Time `json:"updatedAt"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &stored); err != nil {
		t.Fatalf("reading habit: %v", err)
	}
	if answer.UpdatedAt.IsZero() || !answer.UpdatedAt.Equal(stored.UpdatedAt) {
		t.Errorf("updatedAt = %v, want the stored %v", answer.UpdatedAt, stored.UpdatedAt)
	}
}
