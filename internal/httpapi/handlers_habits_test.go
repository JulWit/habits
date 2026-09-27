package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
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

// Changing the kind of a habit with entries is rejected with a readable
// message.
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

	// With a second entry the message uses the plural.
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
