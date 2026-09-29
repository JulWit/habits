package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// A write announces its undo step in Change-Id; undo and redo turn it and
// answer with its label.
func TestUndoAndRedoOverHTTP(t *testing.T) {
	h := newTestServer(t)
	id := createHabit(t, h, `{"name":"Water","kind":"count","targetValue":80,"frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC).String()
	path := "/api/habits/" + id + "/entries/" + today

	w := do(t, h, "PUT", path, `{"value":30}`, "application/json")
	if w.Code != http.StatusOK || w.Header().Get("Change-Id") == "" {
		t.Fatalf("write: %d, Change-Id %q (%s)", w.Code, w.Header().Get("Change-Id"), w.Body)
	}
	step := w.Header().Get("Change-Id")

	var undone store.Step
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/undo", `{"id":`+step+`}`, http.StatusOK), &undone); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/undo): %v", err)
	}
	sameStep := fmt.Sprint(undone.ID) == step && undone.Template == "{name} — {date}"
	sameParams := undone.Params["name"] == "Water" && undone.Params["date"] == today
	if !sameStep || !sameParams {
		t.Errorf("undone step = %+v, want step %s for Water on %s", undone, step, today)
	}
	if value := entryValue(t, h, id, today); value != 0 {
		t.Errorf("value after undo = %d, want none", value)
	}

	mustDo(t, h, "POST", "/api/redo", `{}`, http.StatusOK)
	if value := entryValue(t, h, id, today); value != 30 {
		t.Errorf("value after redo = %d, want 30", value)
	}
}

// Undo answers 404 when there is nothing to undo and 409 for a step whose
// data was changed since.
func TestUndoErrorsOverHTTP(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/undo", `{}`, "application/json")
	if w.Code != http.StatusNotFound {
		t.Errorf("nothing to undo: %d, want 404 (%s)", w.Code, w.Body)
	}

	id := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	renamed := do(t, h, "PATCH", "/api/habits/"+id, `{"name":"Read more"}`, "application/json")
	mustDo(t, h, "PATCH", "/api/habits/"+id, `{"name":"Read a lot"}`, http.StatusOK)
	w = do(t, h, "POST", "/api/undo", `{"id":`+renamed.Header().Get("Change-Id")+`}`, "application/json")
	if w.Code != http.StatusConflict {
		t.Errorf("changed since: %d, want 409 (%s)", w.Code, w.Body)
	}
}

// Undoing the deletion of a habit brings it back with its entries.
func TestUndoDeleteHabitOverHTTP(t *testing.T) {
	h := newTestServer(t)
	id := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC).String()
	mustDo(t, h, "PUT", "/api/habits/"+id+"/entries/"+today, `{"value":1}`, http.StatusOK)

	w := do(t, h, "DELETE", "/api/habits/"+id, "", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("DELETE /api/habits/{id}: status %d, want 204 (%s)", w.Code, w.Body)
	}
	mustDo(t, h, "GET", "/api/habits/"+id, "", http.StatusNotFound)
	mustDo(t, h, "POST", "/api/undo", `{"id":`+w.Header().Get("Change-Id")+`}`, http.StatusOK)
	if value := entryValue(t, h, id, today); value != 1 {
		t.Errorf("value after undo = %d, want 1", value)
	}
}

// entryValue returns the value of a habit on date, from its full view.
func entryValue(t *testing.T, h http.Handler, id, date string) int {
	t.Helper()
	var view struct {
		Entries map[string]int `json:"entries"`
	}
	if err := json.Unmarshal(mustDo(t, h, "GET", "/api/habits/"+id, "", http.StatusOK), &view); err != nil {
		t.Fatalf("json.Unmarshal(GET /api/habits/{id}): %v", err)
	}
	return view.Entries[date]
}

// The state shows the statistics after every change, an undo included,
// although they are cached between requests.
func TestStateStatisticsFollowEveryChange(t *testing.T) {
	h := newTestServer(t)
	id := createHabit(t, h, `{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`)
	today := domain.Today(time.UTC).String()
	total := func() int {
		t.Helper()
		var state struct {
			Habits []struct {
				Stats domain.Stats `json:"stats"`
			} `json:"habits"`
		}
		if err := json.Unmarshal(mustDo(t, h, "GET", "/api/state", "", http.StatusOK), &state); err != nil {
			t.Fatalf("json.Unmarshal(GET /api/state): %v", err)
		}
		return state.Habits[0].Stats.Total
	}

	if n := total(); n != 0 {
		t.Fatalf("total = %d before any entry, want 0", n)
	}
	w := do(t, h, "PUT", "/api/habits/"+id+"/entries/"+today, `{"value":1}`, "application/json")
	if n := total(); n != 1 {
		t.Errorf("total = %d after an entry, want 1", n)
	}
	mustDo(t, h, "POST", "/api/undo", `{"id":`+w.Header().Get("Change-Id")+`}`, http.StatusOK)
	if n := total(); n != 0 {
		t.Errorf("total = %d after undo, want 0", n)
	}
}
