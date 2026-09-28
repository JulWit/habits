package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// createHabit creates a habit from body and returns its ID.
func createHabit(t *testing.T, h http.Handler, body string) string {
	t.Helper()
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/habits", body, http.StatusCreated), &created); err != nil {
		t.Fatal(err)
	}
	return created.ID
}

// Skipping a range skips the due days without a value of all active habits,
// as one undo step.
func TestSkipDaysAndUndo(t *testing.T) {
	h := newTestServer(t)
	read := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	createHabit(t, h, `{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`)
	old := createHabit(t, h, `{"name":"Old","kind":"check","frequency":{"kind":"daily"}}`)
	w := do(t, h, "PUT", "/api/habits/"+old+"/archived", `{"archived":true}`, "application/json")
	if w.Code != http.StatusNoContent {
		t.Fatalf("archive: %d (%s)", w.Code, w.Body)
	}

	today := time.Now().UTC()
	day := func(n int) string { return today.AddDate(0, 0, n).Format("2006-01-02") }
	mustDo(t, h, "PUT", "/api/habits/"+read+"/entries/"+day(1), `{"value":1}`, http.StatusOK)

	body := fmt.Sprintf(`{"from":%q,"to":%q}`, day(1), day(3))
	w = do(t, h, "POST", "/api/skips", body, "application/json")
	// Three days of Run, two of Read (one has a value), none of the archived.
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"skipped":5`) {
		t.Fatalf("skip: %d (%s), want 5 days", w.Code, w.Body)
	}
	if skippedDays(t, h) != 5 {
		t.Errorf("%d skipped days in the state, want 5", skippedDays(t, h))
	}

	mustDo(t, h, "POST", "/api/undo", `{"id":`+w.Header().Get("Change-Id")+`}`, http.StatusOK)
	if n := skippedDays(t, h); n != 0 {
		t.Errorf("%d skipped days left after undo", n)
	}
}

// skippedDays counts the skipped days of all habits in the state.
func skippedDays(t *testing.T, h http.Handler) int {
	t.Helper()
	var state struct {
		Habits []struct {
			Days string `json:"days"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state?archived=1", "", http.StatusOK), &state); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, habit := range state.Habits {
		n += strings.Count(habit.Days, string(domain.StatusSkipped))
	}
	return n
}

// A range can be limited to some habits, and its bounds are checked.
func TestSkipDaysChecksItsInput(t *testing.T) {
	h := newTestServer(t)
	read := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	createHabit(t, h, `{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`)
	today := time.Now().UTC().Format("2006-01-02")

	answer := string(mustDo(t, h, "POST", "/api/skips",
		fmt.Sprintf(`{"from":%q,"to":%q,"habitIds":[%q]}`, today, today, read), http.StatusOK))
	if !strings.Contains(answer, `"skipped":1`) {
		t.Errorf("one habit, one day: %s", answer)
	}

	for body, code := range map[string]string{
		`{"from":"2026-09-10","to":"2026-09-01"}`:                     "skip_range_reversed",
		`{"from":"2020-01-01","to":"2026-01-01"}`:                     "skip_range_too_long",
		`{"from":"1999-12-30","to":"2000-01-02"}`:                     "entry_too_early",
		`{"from":"2026-09-01","to":"2026-09-02","habitIds":["nope"]}`: "not_found",
	} {
		w := do(t, h, "POST", "/api/skips", body, "application/json")
		if !strings.Contains(w.Body.String(), `"code":"`+code+`"`) {
			t.Errorf("%s: %d %s, want %s", body, w.Code, w.Body, code)
		}
	}
}
