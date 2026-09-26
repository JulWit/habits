package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

// New categories have progress off; a PATCH without showProgress keeps it.
func TestCategoryProgressIsOffUntilSwitchedOn(t *testing.T) {
	h := newTestServer(t)

	w := do(t, h, "POST", "/api/categories", `{"name":"Sport"}`, "application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("create: status %d (%s)", w.Code, w.Body)
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
		t.Fatalf("switch on: status %d (%s)", w.Code, w.Body)
	}
	w = do(t, h, "PATCH", "/api/categories/"+c.ID, `{"name":"Bewegung"}`, "application/json")
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if !c.ShowProgress {
		t.Error("a rename switched the progress off again")
	}
}
