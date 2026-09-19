package store

import (
	"context"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// A soft-deleted category leaves its habits alone; they only look uncategorised
// until it comes back.
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
