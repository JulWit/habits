package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// mustDo sends a request with a JSON body and fails the test unless the status
// is want.
func mustDo(t *testing.T, h http.Handler, method, path, body string, want int) []byte {
	t.Helper()
	w := do(t, h, method, path, body, "application/json")
	if w.Code != want {
		t.Fatalf("%s %s: status %d, want %d (%s)", method, path, w.Code, want, w.Body)
	}
	return w.Body.Bytes()
}

// An export holds the habits with their settings and categories, but no
// entries or statistics; importing it elsewhere sets up the same habits.
func TestExportAndImportCarryTheSettings(t *testing.T) {
	src := newTestServer(t)
	var cat struct{ ID string }
	json.Unmarshal(mustDo(t, src, "POST", "/api/categories",
		`{"name":"Health","icon":"heart","color":"red","showProgress":true}`, http.StatusCreated), &cat)
	var water struct{ ID string }
	json.Unmarshal(mustDo(t, src, "POST", "/api/habits",
		`{"name":"Water","kind":"count","unit":"glasses","stepValue":20,"targetValue":80,"color":"sky","icon":"droplet",
		  "categoryId":"`+cat.ID+`","frequency":{"kind":"weekdays","weekdays":5}}`, http.StatusCreated), &water)
	mustDo(t, src, "POST", "/api/habits",
		`{"name":"Read","kind":"time","targetValue":200,"frequency":{"kind":"daily"},"archived":true}`, http.StatusCreated)
	mustDo(t, src, "PUT", "/api/habits/"+water.ID+"/entries/2026-01-05", `{"value":30}`, http.StatusOK)

	w := do(t, src, "GET", "/api/export", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("export: %d (%s)", w.Code, w.Body)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	file := w.Body.String()
	for _, leak := range []string{"entries", "stats", "streak", "2026-01-05"} {
		if strings.Contains(file, leak) {
			t.Errorf("export contains %q: %s", leak, file)
		}
	}

	dst := newTestServer(t)
	var result importResult
	json.Unmarshal(mustDo(t, dst, "POST", "/api/import", file, http.StatusOK), &result)
	if result != (importResult{Habits: 2, Categories: 1}) {
		t.Errorf("result = %+v", result)
	}

	var state struct {
		Categories []struct {
			ID, Name, Icon, Color string
			ShowProgress          bool
		}
		Habits []struct {
			Name, Kind, Unit, Color, Icon, CategoryID string
			StepValue                                 int
			ArchivedAt                                *string
			Schedules                                 []struct {
				TargetValue int
				Frequency   struct {
					Kind     string
					Weekdays int
				}
			}
			Entries map[string]int
		}
	}
	json.Unmarshal(mustDo(t, dst, "GET", "/api/state?archived=1", "", http.StatusOK), &state)
	if len(state.Categories) != 1 || len(state.Habits) != 2 {
		t.Fatalf("imported %d categories, %d habits", len(state.Categories), len(state.Habits))
	}
	c := state.Categories[0]
	if c.Name != "Health" || c.Icon != "heart" || c.Color != "red" || !c.ShowProgress {
		t.Errorf("category = %+v", c)
	}
	got := state.Habits[0]
	if got.Name != "Water" || got.Kind != "count" || got.Unit != "glasses" || got.StepValue != 20 ||
		got.Color != "sky" || got.Icon != "droplet" || got.CategoryID != c.ID || got.ArchivedAt != nil {
		t.Errorf("habit = %+v", got)
	}
	if s := got.Schedules; len(s) != 1 || s[0].TargetValue != 80 ||
		s[0].Frequency.Kind != "weekdays" || s[0].Frequency.Weekdays != 5 {
		t.Errorf("schedules = %+v", s)
	}
	if len(got.Entries) != 0 {
		t.Errorf("entries were imported: %v", got.Entries)
	}
	if read := state.Habits[1]; read.Name != "Read" || read.ArchivedAt == nil {
		t.Errorf("archived habit = %+v", read)
	}

	// A second import finds everything in place.
	json.Unmarshal(mustDo(t, dst, "POST", "/api/import", file, http.StatusOK), &result)
	if result != (importResult{Skipped: 2}) {
		t.Errorf("second import = %+v", result)
	}
}

// An invalid habit fails the whole import and is named in the problem.
func TestImportIsAllOrNothing(t *testing.T) {
	h := newTestServer(t)
	file := `{"format":"habits","version":1,"categories":[{"key":"k","name":"Sport"}],"habits":[
		{"name":"Run","kind":"distance","targetValue":5000,"category":"k","frequency":{"kind":"daily"}},
		{"name":"Swim","kind":"check","frequency":{"kind":"sometimes"}}]}`
	w := do(t, h, "POST", "/api/import", file, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d (%s)", w.Code, w.Body)
	}
	var problem problemBody
	json.Unmarshal(w.Body.Bytes(), &problem)
	if problem.Code != "unknown_frequency" || problem.Params["habit"] != "Swim" {
		t.Errorf("problem = %+v", problem)
	}

	var state struct {
		Categories []any
		Habits     []any
	}
	json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Categories) != 0 || len(state.Habits) != 0 {
		t.Errorf("a failed import saved %d categories, %d habits", len(state.Categories), len(state.Habits))
	}
}

// Files of another format or version are refused.
func TestImportChecksTheFormat(t *testing.T) {
	h := newTestServer(t)
	for _, file := range []string{
		`{"format":"other","version":1,"categories":[],"habits":[]}`,
		`{"format":"habits","version":2,"categories":[],"habits":[]}`,
	} {
		w := do(t, h, "POST", "/api/import", file, "application/json")
		if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "import_format") {
			t.Errorf("%s: %d (%s)", file, w.Code, w.Body)
		}
	}
}

// Habits join an existing category of the same name instead of a copy.
func TestImportReusesCategoriesByName(t *testing.T) {
	h := newTestServer(t)
	var cat struct{ ID string }
	json.Unmarshal(mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated), &cat)
	file := `{"format":"habits","version":1,"categories":[{"key":"k","name":" sport "}],"habits":[
		{"name":"Run","kind":"check","category":"k","frequency":{"kind":"daily"}}]}`
	var result importResult
	json.Unmarshal(mustDo(t, h, "POST", "/api/import", file, http.StatusOK), &result)
	if result != (importResult{Habits: 1}) {
		t.Errorf("result = %+v", result)
	}
	var state struct {
		Habits []struct{ CategoryID string }
	}
	json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Habits) != 1 || state.Habits[0].CategoryID != cat.ID {
		t.Errorf("habits = %+v, want category %s", state.Habits, cat.ID)
	}
}
