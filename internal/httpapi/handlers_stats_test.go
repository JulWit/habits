package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// The day statistics count today's due and done habits.
func TestDaysCountTheHabitsOfEachDay(t *testing.T) {
	h := newTestServer(t)
	read := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	createHabit(t, h, `{"name":"Walk","kind":"check","frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC)
	mustDo(t, h, "PUT", "/api/habits/"+read+"/entries/"+today.String(), `{"value":1}`, http.StatusOK)

	var got daysResponse
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/days", "", http.StatusOK), &got); err != nil {
		t.Fatal(err)
	}
	first, last := yearRange(today.Year)
	if got.Year != today.Year || len(got.Totals) != last.DaysSince(first)+1 {
		t.Fatalf("year %d with %d days", got.Year, len(got.Totals))
	}
	if day := got.Totals[today.DaysSince(first)]; day.Due != 2 || day.Done != 1 {
		t.Errorf("today = %+v, want 1 of 2 done", day)
	}
	if got.Stats.Completed != 1 || got.Stats.Counted != 1 || got.Habits != 2 {
		t.Errorf("habits %d, stats = %+v", got.Habits, got.Stats)
	}
	if w := do(t, h, "GET", "/api/days?year=1999", "", ""); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("year before the earliest entry: status %d, want 422", w.Code)
	}
}

// The day statistics of a category cover its habits only.
func TestDaysOfACategoryCoverItsHabits(t *testing.T) {
	h := newTestServer(t)
	var c struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated), &c); err != nil {
		t.Fatal(err)
	}
	run := createHabit(t, h, fmt.Sprintf(`{"name":"Run","kind":"check","categoryId":%q,"frequency":{"kind":"daily"}}`, c.ID))
	createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC)
	mustDo(t, h, "PUT", "/api/habits/"+run+"/entries/"+today.String(), `{"value":1}`, http.StatusOK)

	var got daysResponse
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/days?category="+c.ID, "", http.StatusOK), &got); err != nil {
		t.Fatal(err)
	}
	if got.Habits != 1 || got.Stats.Counted != 1 || got.Stats.Perfect != 1 || got.Stats.CurrentStreak != 1 {
		t.Errorf("habits %d, stats = %+v", got.Habits, got.Stats)
	}
	if got.Expected != 1 || got.Achieved != 1 {
		t.Errorf("rate counts = %d of %d, want 1 of 1", got.Achieved, got.Expected)
	}
	mustDo(t, h, "GET", "/api/days?category=unknown", "", http.StatusNotFound)
}

// A habit's totals are summed per period of the year up to today.
func TestHabitTotals(t *testing.T) {
	h := newTestServer(t)
	id := createHabit(t, h, `{"name":"Water","kind":"count","targetValue":80,"frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC)
	mustDo(t, h, "PUT", "/api/habits/"+id+"/entries/"+today.String(), `{"value":30}`, http.StatusOK)

	var got domain.Totals
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/habits/"+id+"/totals?grain=month", "", http.StatusOK), &got); err != nil {
		t.Fatal(err)
	}
	if got.Total != 30 || len(got.Buckets) != int(today.Month) {
		t.Errorf("totals = %+v, want 30 in %d months", got, today.Month)
	}
	mustDo(t, h, "GET", "/api/habits/"+id+"/totals?grain=year", "", http.StatusBadRequest)
	mustDo(t, h, "GET", "/api/habits/unknown/totals", "", http.StatusNotFound)
}
