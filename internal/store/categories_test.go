package store

import (
	"context"
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// createCategory creates c for user.
func createCategory(t *testing.T, st *Store, user string, c domain.Category) domain.Category {
	t.Helper()
	update(t, st, user, func(tx *Tx) error { return tx.CreateCategory(&c) })
	return c
}

// categoryOf returns the category id of user.
func categoryOf(t *testing.T, st *Store, user, id string) domain.Category {
	t.Helper()
	return read(t, st, user, func(tx *Tx) (domain.Category, error) { return tx.Category(id) })
}

// saveCategory saves c for user and returns the error.
func saveCategory(st *Store, user string, c domain.Category) error {
	_, err := st.Update(context.Background(), user, func(tx *Tx) error { return tx.SaveCategory(&c) })
	return err
}

// Deleting a category leaves its habits without one.
func TestDeleteCategoryKeepsItsHabits(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport"})
	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = c.ID
	h = mustCreateHabit(t, st, "alice", h)

	update(t, st, "alice", func(tx *Tx) error { return tx.DeleteCategory(c.ID) })
	if cats := read(t, st, "alice", (*Tx).Categories); len(cats) != 0 {
		t.Error("the deleted category is still listed")
	}
	if got := habitOf(t, st, "alice", h.ID).CategoryID; got != "" {
		t.Errorf("categoryId = %q, want none", got)
	}
}

// A category icon is stored and read back; unknown icons are rejected.
func TestCategoryIcon(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport", Icon: "dumbbell"})
	if got := categoryOf(t, st, "alice", c.ID); got.Icon != "dumbbell" {
		t.Errorf("icon = %q after create, want dumbbell", got.Icon)
	}

	c.Icon = ""
	if err := saveCategory(st, "alice", c); err != nil {
		t.Fatalf("SaveCategory: %v", err)
	}
	if got := categoryOf(t, st, "alice", c.ID); got.Icon != "" {
		t.Errorf("icon = %q after removing it, want empty", got.Icon)
	}

	c.Icon = "nope"
	if err := saveCategory(st, "alice", c); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown icon: err = %v, want ErrValidation", err)
	}
}

// ShowProgress is stored in both states.
func TestCategoryShowProgress(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport", ShowProgress: true})
	if !categoryOf(t, st, "alice", c.ID).ShowProgress {
		t.Error("showProgress = false after creating it on")
	}

	c.ShowProgress = false
	if err := saveCategory(st, "alice", c); err != nil {
		t.Fatalf("SaveCategory: %v", err)
	}
	if categoryOf(t, st, "alice", c.ID).ShowProgress {
		t.Error("showProgress = true after switching it off")
	}
}

// A category colour is stored in lower case, can be reset and must be a
// palette name.
func TestCategoryColor(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport", Color: "Green"})
	if got := categoryOf(t, st, "alice", c.ID); got.Color != "green" {
		t.Errorf("color = %q, want green", got.Color)
	}

	c.Color = ""
	if err := saveCategory(st, "alice", c); err != nil {
		t.Fatalf("SaveCategory: %v", err)
	}
	if got := categoryOf(t, st, "alice", c.ID); got.Color != "" {
		t.Errorf("color = %q after clearing it, want empty", got.Color)
	}

	c.Color = "#16a34a"
	if err := saveCategory(st, "alice", c); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("hex value: err = %v, want ErrValidation", err)
	}
}

// Another user's category can be neither changed nor deleted.
func TestCategoriesAreScopedToTheirUser(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport"})
	c.Name = "Mine now"
	if err := saveCategory(st, "mallory", c); !errors.Is(err, ErrNotFound) {
		t.Errorf("SaveCategory of another user: %v, want ErrNotFound", err)
	}
	_, err := st.Update(context.Background(), "mallory", func(tx *Tx) error { return tx.DeleteCategory(c.ID) })
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteCategory of another user: %v, want ErrNotFound", err)
	}
	if got := categoryOf(t, st, "alice", c.ID); got.Name != "Sport" {
		t.Errorf("name = %q, want it unchanged", got.Name)
	}
}
