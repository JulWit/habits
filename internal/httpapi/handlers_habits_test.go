package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// The state response contains the kind descriptors.
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
	if len(got.Colors) == 0 {
		t.Error("colors is empty")
	}
}

// Changing the kind of a habit with entries converts its history: values keep
// their number in the new unit, and the step falls back to the new kind's.
func TestKindChangeConvertsTheHistory(t *testing.T) {
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
	day := domain.Today(time.UTC).AddDays(-1).String()
	if w := do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/"+day,
		`{"value":5200}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("entry: %d (%s)", w.Code, w.Body)
	}

	w = do(t, h, "PATCH", "/api/habits/"+created.ID,
		`{"kind":"time","targetValue":300}`, "application/json")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d (%s)", w.Code, w.Body)
	}
	var view struct {
		StepValue int                 `json:"stepValue"`
		Unit      string              `json:"unit"`
		Entries   map[string]int      `json:"entries"`
		Schedules []domain.Schedule   `json:"schedules"`
		Stats     struct{ Total int } `json:"stats"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	// 5.2 km become 5.2 minutes. The habit was created today, so the new
	// target replaces today's schedule (domain tests cover older ones).
	if view.Entries[day] != 52 {
		t.Errorf("entry = %d, want 52 (5.2 minutes)", view.Entries[day])
	}
	if len(view.Schedules) != 1 || view.Schedules[0].TargetValue != 300 {
		t.Errorf("schedules = %+v, want one with 30 minutes", view.Schedules)
	}
	if view.StepValue != domain.KindTime.Step() || view.Unit != "min" {
		t.Errorf("step %d, unit %q; want the time defaults", view.StepValue, view.Unit)
	}
}

// Entries are judged by the schedule of their day: after a change of
// frequency, an old day stays writable if it was due back then.
func TestEntriesFollowTheScheduleOfTheirDay(t *testing.T) {
	h := newTestServer(t)
	today := domain.Today(time.UTC)
	iso := func(d domain.Date) string { return d.String() }
	todayOnly := 1 << ((int(today.Weekday()) + 6) % 7)

	w := do(t, h, "POST", "/api/habits",
		`{"name":"Reading","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v (%s)", err, w.Body)
	}
	path := "/api/habits/" + created.ID

	// Daily until yesterday, only on today's weekday from today on.
	history := fmt.Sprintf(`{"schedules":[
		{"from":%q,"targetValue":1,"frequency":{"kind":"daily"}},
		{"from":%q,"targetValue":1,"frequency":{"kind":"weekdays","weekdays":%d}}]}`,
		iso(today.AddDays(-30)), iso(today), todayOnly)
	if w := do(t, h, "PATCH", path, history, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("setting schedules: %d (%s)", w.Code, w.Body)
	}

	yesterday := path + "/entries/" + iso(today.AddDays(-1))
	if w := do(t, h, "PUT", yesterday, `{"value":1}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("yesterday was due daily: status %d (%s)", w.Code, w.Body)
	}
	tomorrow := path + "/entries/" + iso(today.AddDays(1))
	if w := do(t, h, "PUT", tomorrow, `{"value":1}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("tomorrow is not due: status %d, want 422", w.Code)
	}

	// Applied retroactively, the weekday schedule covers yesterday as well.
	body := fmt.Sprintf(`{"frequency":{"kind":"weekdays","weekdays":%d},"retroactive":true}`, todayOnly)
	w = do(t, h, "PATCH", path, body, "application/json")
	if w.Code != http.StatusOK {
		t.Fatalf("retroactive change: %d (%s)", w.Code, w.Body)
	}
	var view struct {
		Schedules []domain.Schedule `json:"schedules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if len(view.Schedules) != 1 || view.Schedules[0].From != today.AddDays(-30) {
		t.Errorf("schedules = %+v, want one from the first day", view.Schedules)
	}
	if w := do(t, h, "PUT", yesterday, `{"value":1}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("yesterday is no longer due: status %d, want 422", w.Code)
	}
}

// Schedules cannot be combined with a target or frequency.
func TestSchedulesExcludeTargetAndFrequency(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Reading","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	body := `{"targetValue":1,"schedules":[{"from":"2026-01-01","targetValue":1,"frequency":{"kind":"daily"}}]}`
	if w := do(t, h, "PATCH", "/api/habits/"+created.ID, body, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("status %d, want 422 (%s)", w.Code, w.Body)
	}
}

// Every habit carries its due days, computed by the server, up to a year
// ahead.
func TestStateCarriesTheDueDays(t *testing.T) {
	h := newTestServer(t)
	today := domain.Today(time.UTC)
	todayOnly := 1 << ((int(today.Weekday()) + 6) % 7)
	body := fmt.Sprintf(`{"name":"Laundry","kind":"check","frequency":{"kind":"weekdays","weekdays":%d}}`, todayOnly)
	if w := do(t, h, "POST", "/api/habits", body, "application/json"); w.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", w.Code, w.Body)
	}

	w := do(t, h, "GET", "/api/state", "", "")
	var got struct {
		Habits []struct {
			DueFrom domain.Date `json:"dueFrom"`
			Due     string      `json:"due"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got.Habits) != 1 {
		t.Fatalf("reading response: %v (%s)", err, w.Body)
	}
	v := got.Habits[0]
	if want := today.AddDays(EntryHorizonDays).DaysSince(v.DueFrom) + 1; len(v.Due) != want {
		t.Fatalf("%d due days, want %d", len(v.Due), want)
	}
	i := today.DaysSince(v.DueFrom)
	if v.Due[i:i+8] != "10000001" {
		t.Errorf("due from today = %q, want weekly", v.Due[i:i+8])
	}
}

// The completion rate covers the days of the rateWindow setting, and a full
// view has due days from 1 January of the history's first year.
func TestRateWindowAndYearsOfTheHistory(t *testing.T) {
	h := newTestServer(t)
	id := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	// An entry from two years ago starts the history then.
	today := time.Now().UTC()
	old := today.AddDate(-2, 0, 0)
	mustDo(t, h, "PUT", "/api/habits/"+id+"/entries/"+old.Format("2006-01-02"), `{"value":1}`, http.StatusOK)

	expected := func() int {
		var view struct {
			Stats   domain.Stats `json:"stats"`
			DueFrom string       `json:"dueFrom"`
		}
		if err := json.Unmarshal(mustDo(t, h, "GET", "/api/habits/"+id, "", http.StatusOK), &view); err != nil {
			t.Fatal(err)
		}
		if want := fmt.Sprintf("%d-01-01", old.Year()); view.DueFrom != want {
			t.Errorf("dueFrom = %s, want %s", view.DueFrom, want)
		}
		return view.Stats.Expected
	}
	if n := expected(); n != 30 {
		t.Errorf("default window: %d days expected, want 30", n)
	}
	mustDo(t, h, "PATCH", "/api/settings", `{"rateWindow":"all"}`, http.StatusOK)
	if n := expected(); n < 700 {
		t.Errorf("whole history: %d days expected, want about two years", n)
	}
	if w := do(t, h, "PATCH", "/api/settings", `{"rateWindow":"12"}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("an unknown window: status %d, want 422", w.Code)
	}
}
