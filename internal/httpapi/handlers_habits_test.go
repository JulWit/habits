package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

	// Daily until yesterday, only on today's weekday from today on: a history
	// only an import can bring, as a change starts today.
	file := fmt.Sprintf(`{"format":"habits","version":2,"categories":[],"habits":[
		{"name":"Reading","kind":"check","color":"blue","createdAt":"%sT08:00:00Z","schedules":[
			{"from":%q,"targetValue":1,"frequency":{"kind":"daily"}},
			{"from":%q,"targetValue":1,"frequency":{"kind":"weekdays","weekdays":%d}}]}]}`,
		iso(today.AddDays(-30)), iso(today.AddDays(-30)), iso(today), todayOnly)
	mustDo(t, h, "POST", "/api/import", file, http.StatusOK)
	var state struct {
		Habits []struct {
			ID string `json:"id"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil || len(state.Habits) != 1 {
		t.Fatalf("state: %v, %+v", err, state)
	}
	path := "/api/habits/" + state.Habits[0].ID
	var w *httptest.ResponseRecorder

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

// Every habit carries the status of its days, computed by the server, up to a year
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
			DaysFrom domain.Date `json:"daysFrom"`
			Days     string      `json:"days"`
		} `json:"habits"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got.Habits) != 1 {
		t.Fatalf("reading response: %v (%s)", err, w.Body)
	}
	v := got.Habits[0]
	if want := today.AddDays(domain.EntryHorizonDays).DaysSince(v.DaysFrom) + 1; len(v.Days) != want {
		t.Fatalf("%d due days, want %d", len(v.Days), want)
	}
	i := today.DaysSince(v.DaysFrom)
	if v.Days[i:i+8] != "o------o" {
		t.Errorf("due from today = %q, want weekly", v.Days[i:i+8])
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
			Stats    domain.Stats `json:"stats"`
			DaysFrom string       `json:"daysFrom"`
		}
		if err := json.Unmarshal(mustDo(t, h, "GET", "/api/habits/"+id, "", http.StatusOK), &view); err != nil {
			t.Fatal(err)
		}
		if want := fmt.Sprintf("%d-01-01", old.Year()); view.DaysFrom != want {
			t.Errorf("dueFrom = %s, want %s", view.DaysFrom, want)
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
