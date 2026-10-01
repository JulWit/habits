package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/JulWit/habits/internal/store"
)

// New categories have progress off; a PATCH without showProgress keeps it.
func TestCategoryProgressIsOffUntilSwitchedOn(t *testing.T) {
	h := newTestServer(t)

	w := do(t, h, "POST", "/api/categories", `{"name":"Sport"}`, "application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /api/categories: status %d, want 201 (%s)", w.Code, w.Body)
	}
	var c struct {
		ID           string `json:"id"`
		ShowProgress bool   `json:"showProgress"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if c.ShowProgress {
		t.Error("a new category shows its progress, want off")
	}

	w = do(t, h, "PATCH", "/api/categories/"+c.ID, `{"showProgress":true}`, "application/json")
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH /api/categories/{id}: status %d, want 200 (%s)", w.Code, w.Body)
	}
	w = do(t, h, "PATCH", "/api/categories/"+c.ID, `{"name":"Bewegung"}`, "application/json")
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if !c.ShowProgress {
		t.Error("a rename switched the progress off again")
	}
}

// Deleting a category answers with its undo step, labelled with the number
// of habits it kept.
func TestDeleteCategoryAnswersWithTheStep(t *testing.T) {
	h := newTestServer(t)
	var c struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(mustDo(t, h, "POST", "/api/categories", `{"name":"Sport"}`, http.StatusCreated), &c); err != nil {
		t.Fatalf("json.Unmarshal(POST /api/categories): %v", err)
	}
	for _, name := range []string{"Run", "Swim"} {
		createHabit(t, h, `{"name":"`+name+`","kind":"check","categoryId":"`+c.ID+`","frequency":{"kind":"daily"}}`)
	}

	w := do(t, h, "DELETE", "/api/categories/"+c.ID, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE /api/categories/{id}: status %d, want 200 (%s)", w.Code, w.Body)
	}
	var step store.Step
	if err := json.Unmarshal(w.Body.Bytes(), &step); err != nil {
		t.Fatalf("json.Unmarshal(DELETE /api/categories/{id}): %v", err)
	}
	if fmt.Sprint(step.ID) != w.Header().Get("Change-Id") {
		t.Errorf("step %d, want the Change-Id %s", step.ID, w.Header().Get("Change-Id"))
	}
	if step.Template != `Category "{name}" deleted — {n} habits kept` ||
		step.Params["name"] != "Sport" || step.Params["n"] != 2.0 {
		t.Errorf("step = %+v, want Sport with 2 habits kept", step)
	}
}
