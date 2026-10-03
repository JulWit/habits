package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// BenchmarkState measures GET /api/state for 30 habits with five years of
// daily entries each, imported in one file.
func BenchmarkState(b *testing.B) {
	h := newTestServer(b)
	importHistory(b, h, 30, 5)

	b.ResetTimer()
	for b.Loop() {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
		if w.Code != http.StatusOK {
			b.Fatalf("state: %d", w.Code)
		}
	}
}

// Budgets of TestLargeHistoryStaysFast: generous, several times what a CI
// runner needs, so they catch a slower algorithm rather than a slow machine.
const (
	stateBudget = 2 * time.Second
	entryBudget = 500 * time.Millisecond
)

// The statistics walk the whole history on every request. For 50 habits with
// ten years of daily entries, the state and a day's change, the most
// frequent requests, stay within their budgets. go test -short skips it.
func TestLargeHistoryStaysFast(t *testing.T) {
	if testing.Short() {
		t.Skip("skipped in -short mode")
	}
	h := newTestServer(t)
	importHistory(t, h, 50, 10)
	id := firstHabitID(t, h)
	entry := "/api/habits/" + id + "/entries/" + domain.Today(time.UTC).String()

	for _, req := range []struct {
		method, path, body string
		budget             time.Duration
	}{
		{"GET", "/api/state", "", stateBudget},
		{"PUT", entry, `{"value":30}`, entryBudget},
	} {
		took := medianDuration(3, func() {
			mustDo(t, h, req.method, req.path, req.body, http.StatusOK)
		})
		t.Logf("%s %s: %v", req.method, req.path, took)
		if took > req.budget {
			t.Errorf("%s %s took %v, more than its budget of %v", req.method, req.path, took, req.budget)
		}
	}
}

// importHistory imports habits count habits with daily entries on two of
// three days over the last years years.
func importHistory(t testing.TB, h http.Handler, habits, years int) {
	t.Helper()
	today := domain.Today(time.UTC)
	first := today.AddDays(-years * 365)
	var list []string
	for i := range habits {
		var entries []string
		for d := first; !d.After(today); d = d.AddDays(1) {
			if d.Day%3 != 0 {
				entries = append(entries, fmt.Sprintf("%q:%d", d.String(), 10+i))
			}
		}
		list = append(list, fmt.Sprintf(`{"name":"Habit %d","kind":"count","color":"red","createdAt":"%sT00:00:00Z",
			"schedules":[{"from":%q,"targetValue":20,"frequency":{"kind":"daily"}}],"entries":{%s}}`,
			i, first, first, strings.Join(entries, ",")))
	}
	file := `{"format":"habits","version":2,"categories":[],"habits":[` + strings.Join(list, ",") + `]}`
	req := httptest.NewRequest("POST", "/api/import", strings.NewReader(file))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("import: %d (%s)", w.Code, w.Body)
	}
}

// firstHabitID returns the ID of the user's first habit.
func firstHabitID(t *testing.T, h http.Handler) string {
	t.Helper()
	var state struct {
		Habits []struct {
			ID string `json:"id"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Habits) == 0 {
		t.Fatal("no habits")
	}
	return state.Habits[0].ID
}

// medianDuration runs fn n times and returns the median of its durations.
func medianDuration(n int, fn func()) time.Duration {
	durations := make([]time.Duration, n)
	for i := range durations {
		start := time.Now()
		fn()
		durations[i] = time.Since(start)
	}
	slices.Sort(durations)
	return durations[n/2]
}
