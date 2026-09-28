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
// and writing the previous entries back undoes it.
func TestSkipDaysAndUndo(t *testing.T) {
	h := newTestServer(t)
	read := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	createHabit(t, h, `{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`)
	old := createHabit(t, h, `{"name":"Old","kind":"check","frequency":{"kind":"daily"}}`)
	mustDo(t, h, "PATCH", "/api/habits/"+old, `{"archived":true}`, http.StatusOK)

	today := time.Now().UTC()
	day := func(n int) string { return today.AddDate(0, 0, n).Format("2006-01-02") }
	mustDo(t, h, "PUT", "/api/habits/"+read+"/entries/"+day(1), `{"value":1}`, http.StatusOK)

	body := fmt.Sprintf(`{"from":%q,"to":%q,"note":"Holiday"}`, day(1), day(3))
	var skipped struct {
		Changes []struct {
			HabitID  string       `json:"habitId"`
			Date     domain.Date  `json:"date"`
			Previous domain.Entry `json:"previous"`
			Entry    domain.Entry `json:"entry"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/skips", body, http.StatusOK), &skipped); err != nil {
		t.Fatal(err)
	}
	// Three days of Run, two of Read (one has a value), none of the archived.
	if len(skipped.Changes) != 5 {
		t.Fatalf("changes = %+v, want 5", skipped.Changes)
	}
	for _, c := range skipped.Changes {
		if c.HabitID == old || !c.Entry.Skipped || c.Entry.Note != "Holiday" {
			t.Errorf("change %+v", c)
		}
	}

	// Undo writes the previous entries back.
	var undo strings.Builder
	undo.WriteString(`{"changes":[`)
	for i, c := range skipped.Changes {
		if i > 0 {
			undo.WriteString(",")
		}
		expect, _ := json.Marshal(c.Entry)
		entry, _ := json.Marshal(c.Previous)
		fmt.Fprintf(&undo, `{"habitId":%q,"date":%q,"expect":%s,"entry":%s}`, c.HabitID, c.Date, expect, entry)
	}
	undo.WriteString(`]}`)
	answer := string(mustDo(t, h, "POST", "/api/entries", undo.String(), http.StatusOK))
	if !strings.Contains(answer, `"applied":5`) || !strings.Contains(answer, `"conflicts":0`) {
		t.Errorf("undo answer = %s", answer)
	}
	state := string(mustDo(t, h, "GET", "/api/state", "", http.StatusOK))
	if strings.Contains(state, "Holiday") {
		t.Error("the skipped days are still there after undo")
	}
}

// A range can be limited to some habits, and its bounds are checked.
func TestSkipDaysChecksItsInput(t *testing.T) {
	h := newTestServer(t)
	read := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	createHabit(t, h, `{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`)
	today := time.Now().UTC().Format("2006-01-02")

	answer := string(mustDo(t, h, "POST", "/api/skips",
		fmt.Sprintf(`{"from":%q,"to":%q,"habitIds":[%q]}`, today, today, read), http.StatusOK))
	if strings.Count(answer, `"habitId"`) != 1 {
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
