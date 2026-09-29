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
	if err := json.Unmarshal(mustDo(t, src, "POST", "/api/categories",
		`{"name":"Health","icon":"heart","color":"red","showProgress":true}`, http.StatusCreated), &cat); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/categories): %v", err)
	}
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
		t.Fatalf("GET /api/export: status %d, want 200 (%s)", w.Code, w.Body)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Errorf("Content-Disposition = %q, want an attachment", cd)
	}
	file := w.Body.String()
	for _, leak := range []string{"stats", "streak"} {
		if strings.Contains(file, leak) {
			t.Errorf("export contains %q: %s", leak, file)
		}
	}

	dst := newTestServer(t)
	var result importResult
	if err := json.Unmarshal(mustDo(t, dst, "POST", "/api/import", file, http.StatusOK), &result); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/import): %v", err)
	}
	if result != (importResult{Habits: 2, Categories: 1}) {
		t.Errorf("import result = %+v, want 2 habits and 1 category", result)
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
	if err := json.Unmarshal(mustDo(t, dst, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Categories) != 1 || len(state.Habits) != 2 {
		t.Fatalf("imported %d categories, %d habits; want 1, 2", len(state.Categories), len(state.Habits))
	}
	c := state.Categories[0]
	if c.Name != "Health" || c.Icon != "heart" || c.Color != "red" || !c.ShowProgress {
		t.Errorf("category = %+v, want Health with heart, red and its progress shown", c)
	}
	got := state.Habits[0]
	measured := got.Name == "Water" && got.Kind == "count" && got.Unit == "glasses" && got.StepValue == 20
	shown := got.Color == "sky" && got.Icon == "droplet" && got.CategoryID == c.ID && got.ArchivedAt == nil
	if !measured || !shown {
		t.Errorf("habit = %+v, want Water as exported", got)
	}
	if s := got.Schedules; len(s) != 1 || s[0].TargetValue != 80 || s[0].Frequency.Kind != "daily" {
		t.Errorf("schedules = %+v, want one daily with the target 80", s)
	}
	if got.Entries[today.String()] != 30 {
		t.Errorf("entries = %v, want 30 today", got.Entries)
	}
	if i := yesterday.DaysSince(got.DaysFrom); got.Days[i] != byte(domain.StatusSkipped) {
		t.Errorf("yesterday = %c, want skipped", got.Days[i])
	}
	if read := state.Habits[1]; read.Name != "Read" || read.ArchivedAt == nil {
		t.Errorf("habit = %+v, want Read, archived", read)
	}

	// A second import finds everything in place.
	if err := json.Unmarshal(mustDo(t, dst, "POST", "/api/import", file, http.StatusOK), &result); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/import): %v", err)
	}
	if result != (importResult{Skipped: 2}) {
		t.Errorf("second import = %+v, want both habits skipped", result)
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
		t.Fatalf("POST /api/import: status %d, want 422 (%s)", w.Code, w.Body)
	}
	var problem problemBody
	if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/import): %v (%s)", err, w.Body)
	}
	if problem.Code != "unknown_frequency" || problem.Params["habit"] != "Swim" {
		t.Errorf("problem = %+v, want unknown_frequency naming Swim", problem)
	}

	var state struct {
		Categories []any
		Habits     []any
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Categories) != 0 || len(state.Habits) != 0 {
		t.Errorf("a failed import saved %d categories, %d habits; want none", len(state.Categories), len(state.Habits))
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
			t.Errorf("import %s: status %d (%s), want 422 import_format", file, w.Code, w.Body)
		}
	}
}

// Habits join an existing category of the same name instead of a copy, and
// the import is one undo step.
func TestImportReusesCategoriesByName(t *testing.T) {
	h := newTestServer(t)
	var cat struct{ ID string }
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated), &cat); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/categories): %v", err)
	}
	file := `{"format":"habits","version":2,"categories":[{"key":"k","name":" sport "}],"habits":[
		{"name":"Run","kind":"check","category":"k","color":"red","createdAt":"2026-01-01T00:00:00Z",
		 "schedules":[{"from":"2026-01-01","targetValue":1,"frequency":{"kind":"daily"}}]}]}`
	w := do(t, h, "POST", "/api/import", file, "application/json")
	var result importResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/import): %v (%s)", err, w.Body)
	}
	if w.Code != http.StatusOK || result != (importResult{Habits: 1}) {
		t.Errorf("import: status %d, %+v; want 200, 1 habit", w.Code, result)
	}
	var state struct {
		Habits []struct{ CategoryID string }
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Habits) != 1 || state.Habits[0].CategoryID != cat.ID {
		t.Errorf("habits = %+v, want category %s", state.Habits, cat.ID)
	}

	mustDo(t, h, "POST", "/api/undo", `{"id":`+w.Header().Get("Change-Id")+`}`, http.StatusOK)
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Habits) != 0 {
		t.Errorf("%d habits left after undoing the import, want 0", len(state.Habits))
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
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
	}
	if len(state.Categories) != 0 || len(state.Habits) != 0 || state.Settings.Theme != "system" {
		t.Errorf("after deleting: %d categories, %d habits, theme %q; want 0, 0, system",
			len(state.Categories), len(state.Habits), state.Settings.Theme)
	}
	// The app keeps working afterwards.
	mustDo(t, h, "POST", "/api/habits",
		`{"name":"Run","kind":"check","frequency":{"kind":"daily"}}`, http.StatusCreated)
}
