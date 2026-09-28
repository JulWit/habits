package httpapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// BenchmarkState measures GET /api/state for 30 habits with five years of
// daily entries each, imported in one file.
func BenchmarkState(b *testing.B) {
	h := newTestServer(b)
	today := domain.Today(time.UTC)
	first := today.AddDays(-5 * 365)
	var habits []string
	for i := range 30 {
		var entries []string
		for d := first; !d.After(today); d = d.AddDays(1) {
			if d.Day%3 != 0 {
				entries = append(entries, fmt.Sprintf("%q:%d", d.String(), 10+i))
			}
		}
		habits = append(habits, fmt.Sprintf(`{"name":"Habit %d","kind":"count","color":"red","createdAt":"%sT00:00:00Z",
			"schedules":[{"from":%q,"targetValue":20,"frequency":{"kind":"daily"}}],"entries":{%s}}`,
			i, first, first, strings.Join(entries, ",")))
	}
	file := `{"format":"habits","version":2,"categories":[],"habits":[` + strings.Join(habits, ",") + `]}`
	req := httptest.NewRequest("POST", "/api/import", strings.NewReader(file))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		b.Fatalf("import: %d (%s)", w.Code, w.Body)
	}

	b.ResetTimer()
	for b.Loop() {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
		if w.Code != http.StatusOK {
			b.Fatalf("state: %d", w.Code)
		}
	}
}
