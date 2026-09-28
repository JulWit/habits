package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Invalid settings are answered with 422.
func TestBadSettingsAnswer422(t *testing.T) {
	h := newTestServer(t)
	for _, body := range []string{
		`{"theme":"neon"}`,
		`{"font":"comic-sans"}`,
		`{"overviewDays":999}`,
		`{"bandOpacity":101}`,
		`{"pattern":"image"}`,
		`{"bandColor":"#123456"}`,
		`{"bandColor":"purple"}`,
	} {
		w := do(t, h, "PATCH", "/api/settings", body, "application/json")
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422", body, w.Code)
		}
		if strings.Contains(w.Body.String(), "Interner Serverfehler") {
			t.Errorf("%s: reported as a server error: %s", body, w.Body)
		}
	}
	// Unknown fields are answered with 400.
	if w := do(t, h, "PATCH", "/api/settings", `{"thme":"dark"}`, "application/json"); w.Code != http.StatusBadRequest {
		t.Errorf("unknown field: status %d, want 400", w.Code)
	}
}

// Values above the kind's maximum are answered with 422.
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
	// Dates beyond the horizon are answered with 422.
	far := "/api/habits/" + created.ID + "/entries/2099-01-01"
	if w := do(t, h, "PUT", far, `{"value":1000}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("date beyond the horizon: status %d, want 422", w.Code)
	}
	// Dates before EarliestEntry are answered with 422, but may be cleared.
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

// Weekday habits reject values on other days, but allow clearing them.
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

// The response contains the habit's new updatedAt.
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

// A write with expect only happens while the stored value is still the
// expected one; otherwise it is answered with 409 and the current value.
func TestConditionalEntryWrite(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Water","kind":"count","targetValue":80,"frequency":{"kind":"daily"}}`,
		"application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	path := "/api/habits/" + created.ID + "/entries/" + time.Now().UTC().Format("2006-01-02")

	if w := do(t, h, "PUT", path, `{"value":30,"expect":{}}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("first write: %d (%s)", w.Code, w.Body)
	}
	w = do(t, h, "PUT", path, `{"value":0,"expect":{"value":50}}`, "application/json")
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409 (%s)", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), `"code":"entry_changed"`) ||
		!strings.Contains(w.Body.String(), `"current":30`) {
		t.Errorf("body = %s", w.Body)
	}
}

// A skip is sent with the habit and keeps the streak, and a value ends it.
// The answer carries the entry before and after.
func TestSkipReachesTheState(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	today := time.Now()
	path := func(daysAgo int) string {
		return "/api/habits/" + created.ID + "/entries/" + today.AddDate(0, 0, -daysAgo).Format("2006-01-02")
	}
	mustDo(t, h, "PUT", path(2), `{"value":1}`, http.StatusOK)
	answer := mustDo(t, h, "PUT", path(1), `{"skipped":true}`, http.StatusOK)
	var skipped struct {
		Value    int          `json:"value"`
		Skipped  bool         `json:"skipped"`
		Previous domain.Entry `json:"previous"`
		Stats    domain.Stats `json:"stats"`
	}
	if err := json.Unmarshal(answer, &skipped); err != nil {
		t.Fatal(err)
	}
	if !skipped.Skipped || skipped.Value != 0 || !skipped.Previous.IsZero() {
		t.Errorf("answer = %+v", skipped)
	}
	mustDo(t, h, "PUT", path(0), `{"value":1}`, http.StatusOK)

	var state struct {
		Habits []struct {
			Skipped map[string]bool `json:"skipped"`
			Stats   domain.Stats    `json:"stats"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatal(err)
	}
	got := state.Habits[0]
	yesterday := today.AddDate(0, 0, -1).Format("2006-01-02")
	if !got.Skipped[yesterday] {
		t.Errorf("skipped = %v", got.Skipped)
	}
	if got.Stats.CurrentStreak != 2 {
		t.Errorf("streak = %d, want 2 across the skipped day", got.Stats.CurrentStreak)
	}

	// A value ends the skip.
	answer = mustDo(t, h, "PUT", path(1), `{"value":1}`, http.StatusOK)
	if err := json.Unmarshal(answer, &skipped); err != nil {
		t.Fatal(err)
	}
	if skipped.Skipped || skipped.Value != 1 {
		t.Errorf("after a value: %+v", skipped)
	}

	// Notes are gone: the field is unknown.
	if w := do(t, h, "PUT", path(1), `{"note":"ill"}`, "application/json"); w.Code != http.StatusBadRequest {
		t.Errorf("a note: status %d, want 400", w.Code)
	}
}

// A skip needs a due day, like a value; removing does not.
func TestSkipNeedsADueDay(t *testing.T) {
	h := newTestServer(t)
	// Due on Mondays only.
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Plan","kind":"check","frequency":{"kind":"weekdays","weekdays":1}}`, "application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	// 2026-09-15 is a Tuesday.
	path := "/api/habits/" + created.ID + "/entries/2026-09-15"
	if w := do(t, h, "PUT", path, `{"skipped":true}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("status %d, want 422", w.Code)
	}
	mustDo(t, h, "PUT", path, `{"skipped":false}`, http.StatusOK)
}
