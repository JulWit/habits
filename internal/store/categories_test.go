package store

import (
	"context"
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// Soft-deleting a category keeps the category ID of its habits.
func TestCategorySoftDeleteLeavesHabitsAssigned(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	c := domain.Category{Name: "Sport"}
	if err := st.CreateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = c.ID
	h = mustCreateHabit(t, st, "alice", h)

	if err := st.SoftDeleteCategory(ctx, "alice", c.ID); err != nil {
		t.Fatalf("SoftDeleteCategory: %v", err)
	}
	if cats, _ := st.ListCategories(ctx, "alice"); len(cats) != 0 {
		t.Error("the deleted category is still listed")
	}
	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.CategoryID != c.ID {
		t.Errorf("categoryId = %q — the assignment must stay", after.CategoryID)
	}

	if err := st.RestoreCategory(ctx, "alice", c.ID); err != nil {
		t.Fatalf("RestoreCategory: %v", err)
	}
	if cats, _ := st.ListCategories(ctx, "alice"); len(cats) != 1 {
		t.Error("the category did not come back")
	}
}

// A category icon is stored and read back; unknown icons are rejected.
func TestCategoryIcon(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	c := domain.Category{Name: "Sport", Icon: "dumbbell"}
	if err := st.CreateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	got, err := st.GetCategory(ctx, "alice", c.ID)
	if err != nil {
		t.Fatalf("GetCategory: %v", err)
	}
	if got.Icon != "dumbbell" {
		t.Errorf("icon = %q after create, want dumbbell", got.Icon)
	}

	got.Icon = ""
	if err := st.UpdateCategory(ctx, "alice", &got); err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}
	if again, _ := st.GetCategory(ctx, "alice", c.ID); again.Icon != "" {
		t.Errorf("icon = %q after removing it, want empty", again.Icon)
	}

	got.Icon = "nope"
	if err := st.UpdateCategory(ctx, "alice", &got); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown icon: err = %v, want ErrValidation", err)
	}
}

// ShowProgress is stored in both states.
func TestCategoryShowProgress(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	c := domain.Category{Name: "Sport", ShowProgress: true}
	if err := st.CreateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if got, _ := st.GetCategory(ctx, "alice", c.ID); !got.ShowProgress {
		t.Error("showProgress = false after creating it on")
	}

	c.ShowProgress = false
	if err := st.UpdateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}
	if got, _ := st.GetCategory(ctx, "alice", c.ID); got.ShowProgress {
		t.Error("showProgress = true after switching it off")
	}
}

// A category colour is stored in lower case, can be reset and must be a hex
// value.
func TestCategoryColor(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	c := domain.Category{Name: "Sport", Color: "#16A34A"}
	if err := st.CreateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if got, _ := st.GetCategory(ctx, "alice", c.ID); got.Color != "#16a34a" {
		t.Errorf("color = %q, want #16a34a", got.Color)
	}

	c.Color = ""
	if err := st.UpdateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}
	if got, _ := st.GetCategory(ctx, "alice", c.ID); got.Color != "" {
		t.Errorf("color = %q after clearing it, want empty", got.Color)
	}

	c.Color = "green"
	if err := st.UpdateCategory(ctx, "alice", &c); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("colour name: err = %v, want ErrValidation", err)
	}
}
