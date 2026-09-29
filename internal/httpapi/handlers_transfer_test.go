package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
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

// An export holds the habits with their settings, schedules and entries, and
// the categories, but no statistics; importing it elsewhere restores them.
func TestExportAndImportRestoreTheHistory(t *testing.T) {
	src := newTestServer(t)
	var cat struct{ ID string }
	json.Unmarshal(mustDo(t, src, "POST", "/api/categories",
		`{"name":"Health","icon":"heart","color":"red","showProgress":true}`, http.StatusCreated), &cat)
	water := createHabit(t, src, `{"name":"Water","kind":"count","unit":"glasses","stepValue":20,"targetValue":80,
		"color":"sky","icon":"droplet","categoryId":"`+cat.ID+`","frequency":{"kind":"daily"}}`)
	read := createHabit(t, src, `{"name":"Read","kind":"time","targetValue":200,"frequency":{"kind":"daily"}}`)
	mustDo(t, src, "PATCH", "/api/habits/"+read, `{"archived":true}`, http.StatusOK)
	today := domain.Today(time.UTC)
	yesterday := today.AddDays(-1)
	mustDo(t, src, "PUT", "/api/habits/"+water+"/entries/"+today.String(), `{"value":30}`, http.StatusOK)
	mustDo(t, src, "PUT", "/api/habits/"+water+"/entries/"+yesterday.String(), `{"skipped":true}`, http.StatusOK)

	w := do(t, src, "GET", "/api/export", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("export: %d (%s)", w.Code, w.Body)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	file := w.Body.String()
	for _, leak := range []string{"stats", "streak"} {
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
				Frequency   struct{ Kind string }
			}
			Entries  map[string]int
			DaysFrom domain.Date
			Days     string
		}
	}
	json.Unmarshal(mustDo(t, dst, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Categories) != 1 || len(state.Habits) != 2 {
		t.Fatalf("imported %d categories, %d habits", len(state.Categories), len(state.Habits))
	}
	c := state.Categories[0]
	if c.Name != "Health" || c.Icon != "heart" || c.Color != "red" || !c.ShowProgress {
		t.Errorf("category = %+v", c)
	}
	got := state.Habits[0]
	measured := got.Name == "Water" && got.Kind == "count" && got.Unit == "glasses" && got.StepValue == 20
	shown := got.Color == "sky" && got.Icon == "droplet" && got.CategoryID == c.ID && got.ArchivedAt == nil
	if !measured || !shown {
		t.Errorf("habit = %+v", got)
	}
	if s := got.Schedules; len(s) != 1 || s[0].TargetValue != 80 || s[0].Frequency.Kind != "daily" {
		t.Errorf("schedules = %+v", s)
	}
	if got.Entries[today.String()] != 30 {
		t.Errorf("entries = %v, want 30 today", got.Entries)
	}
	if i := yesterday.DaysSince(got.DaysFrom); got.Days[i] != byte(domain.StatusSkipped) {
		t.Errorf("yesterday = %c, want skipped", got.Days[i])
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
	file := `{"format":"habits","version":2,"categories":[{"key":"k","name":"Sport"}],"habits":[
		{"name":"Run","kind":"distance","category":"k","color":"red","createdAt":"2026-01-01T00:00:00Z",
		 "schedules":[{"from":"2026-01-01","targetValue":5000,"frequency":{"kind":"daily"}}]},
		{"name":"Swim","kind":"check","color":"blue","createdAt":"2026-01-01T00:00:00Z",
		 "schedules":[{"from":"2026-01-01","targetValue":1,"frequency":{"kind":"sometimes"}}]}]}`
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
		`{"format":"other","version":2,"categories":[],"habits":[]}`,
		`{"format":"habits","version":1,"categories":[],"habits":[]}`,
	} {
		w := do(t, h, "POST", "/api/import", file, "application/json")
		if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "import_format") {
			t.Errorf("%s: %d (%s)", file, w.Code, w.Body)
		}
	}
}

// Habits join an existing category of the same name instead of a copy, and
// the import is one undo step.
func TestImportReusesCategoriesByName(t *testing.T) {
	h := newTestServer(t)
	var cat struct{ ID string }
	json.Unmarshal(mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated), &cat)
	file := `{"format":"habits","version":2,"categories":[{"key":"k","name":" sport "}],"habits":[
		{"name":"Run","kind":"check","category":"k","color":"red","createdAt":"2026-01-01T00:00:00Z",
		 "schedules":[{"from":"2026-01-01","targetValue":1,"frequency":{"kind":"daily"}}]}]}`
	w := do(t, h, "POST", "/api/import", file, "application/json")
	var result importResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != http.StatusOK || result != (importResult{Habits: 1}) {
		t.Errorf("import: %d, %+v", w.Code, result)
	}
	var state struct {
		Habits []struct{ CategoryID string }
	}
	json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Habits) != 1 || state.Habits[0].CategoryID != cat.ID {
		t.Errorf("habits = %+v, want category %s", state.Habits, cat.ID)
	}

	mustDo(t, h, "POST", "/api/undo", `{"id":`+w.Header().Get("Change-Id")+`}`, http.StatusOK)
	json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Habits) != 0 {
		t.Errorf("%d habits left after undoing the import", len(state.Habits))
	}
}

// Deleting the data leaves an empty board with the default settings.
func TestDeleteDataEmptiesTheBoard(t *testing.T) {
	h := newTestServer(t)
	mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated)
	mustDo(t, h, "POST", "/api/habits",
		`{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`, http.StatusCreated)
	mustDo(t, h, "PATCH", "/api/settings", `{"theme":"dark"}`, http.StatusOK)

	mustDo(t, h, "DELETE", "/api/data", "", http.StatusNoContent)

	var state struct {
		Categories []any
		Habits     []any
		Settings   struct{ Theme string }
	}
	json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state)
	if len(state.Categories) != 0 || len(state.Habits) != 0 || state.Settings.Theme != "system" {
		t.Errorf("after deleting: %d categories, %d habits, theme %q",
			len(state.Categories), len(state.Habits), state.Settings.Theme)
	}
	// The app keeps working afterwards.
	mustDo(t, h, "POST", "/api/habits",
		`{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`, http.StatusCreated)
}
