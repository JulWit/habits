package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// One user must never see, read or write another's rows.
func TestHabitsAreScopedToTheirUser(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	mine := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	if _, err := st.GetHabit(ctx, "someone-else", mine.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetHabit foreign: %v, want ErrNotFound", err)
	}
	if err := st.SoftDeleteHabit(ctx, "someone-else", mine.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("SoftDelete foreign: %v, want ErrNotFound", err)
	}
	if _, err := st.SetEntry(ctx, "someone-else", mine.ID, day(2026, time.September, 18), 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("SetEntry foreign: %v, want ErrNotFound", err)
	}
	habits, err := st.ListHabits(ctx, "someone-else", true)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(habits) != 0 {
		t.Errorf("foreign list contains %d habits", len(habits))
	}
}

// The guard against silently reinterpreting a history: 5000 metres are not
// 500 repetitions.
func TestKindCannotChangeOnceThereIsAHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))

	// No entries yet: correcting a freshly created habit stays possible.
	changed := h
	changed.Kind = domain.KindCount
	changed.TargetValue = 80
	if err := st.UpdateHabit(ctx, "alice", &changed); err != nil {
		t.Fatalf("kind change without history must be allowed: %v", err)
	}

	// Now give it a history and try again.
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.September, 18), 50); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}
	again := changed
	again.Kind = domain.KindTime
	err := st.UpdateHabit(ctx, "alice", &again)
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("kind change with history: %v, want ErrValidation", err)
	}

	// And the habit is untouched — the transaction rolled the whole thing back.
	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Kind != domain.KindCount {
		t.Errorf("kind = %q, want count — the failure must not have written anything", after.Kind)
	}
}

// Renaming, recolouring and rescheduling a habit that has a history is exactly
// what the guard must not block.
func TestEverythingButTheKindStaysEditable(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.September, 18), 50); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}

	h.Name = "Wasser trinken"
	h.Color = "#0284c7"
	h.TargetValue = 100
	h.StepValue = 20
	h.Frequency = domain.Frequency{Kind: domain.FreqTimesPerWeek, TimesPerWeek: 4}
	if err := st.UpdateHabit(ctx, "alice", &h); err != nil {
		t.Fatalf("UpdateHabit: %v", err)
	}

	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Name != "Wasser trinken" || after.TargetValue != 100 || after.StepValue != 20 {
		t.Errorf("changes did not arrive: %+v", after)
	}
	if after.Frequency.Kind != domain.FreqTimesPerWeek || after.Frequency.TimesPerWeek != 4 {
		t.Errorf("frequency did not arrive: %+v", after.Frequency)
	}
}

// A habit may not be filed under someone else's category, and not under one
// that does not exist.
func TestHabitCannotJoinAForeignCategory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	theirs := domain.Category{Name: "Sport"}
	if err := st.CreateCategory(ctx, "someone-else", &theirs); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = theirs.ID
	if err := st.CreateHabit(ctx, "alice", &h); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("foreign category: %v, want ErrValidation", err)
	}

	h.CategoryID = "does-not-exist"
	if err := st.CreateHabit(ctx, "alice", &h); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown category: %v, want ErrValidation", err)
	}
}

// Deleting is soft, so undo can bring the habit back with its history intact.
func TestSoftDeleteKeepsTheHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	day := day(2026, time.September, 18)
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, 1); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}

	if err := st.SoftDeleteHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("SoftDeleteHabit: %v", err)
	}
	if habits, _ := st.ListHabits(ctx, "alice", true); len(habits) != 0 {
		t.Error("a deleted habit must no longer be listed")
	}
	// Purging only takes what is past the window.
	if n, err := st.PurgeDeleted(ctx, 30*24*time.Hour); err != nil || n != 0 {
		t.Errorf("PurgeDeleted removed %d rows too early (err %v)", n, err)
	}

	if err := st.RestoreHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("RestoreHabit: %v", err)
	}
	entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("EntriesForHabit: %v", err)
	}
	if entries[day] != 1 {
		t.Errorf("the history did not come back: %+v", entries)
	}
}

// Past the retention window the row and its entries go for good.
func TestPurgeRemovesWhatIsPastTheWindow(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	if err := st.SoftDeleteHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("SoftDeleteHabit: %v", err)
	}

	// A negative window puts the cutoff in the future, so the row is past it
	// whatever the clock's resolution — on Windows two calls to time.Now() a
	// few statements apart can return the very same instant.
	n, err := st.PurgeDeleted(ctx, -time.Hour)
	if err != nil {
		t.Fatalf("PurgeDeleted: %v", err)
	}
	if n != 1 {
		t.Errorf("PurgeDeleted entfernte %d Zeilen, want 1", n)
	}
	if err := st.RestoreHabit(ctx, "alice", h.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("after the purge: %v, want ErrNotFound", err)
	}
}

// Reordering only touches the caller's own rows.
func TestReorderIgnoresForeignIDs(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	theirs := mustCreateHabit(t, st, "someone-else", countHabit(domain.KindCheck, 1))

	if err := st.ReorderHabits(ctx, "alice", []string{b.ID, theirs.ID, a.ID}); err != nil {
		t.Fatalf("ReorderHabits: %v", err)
	}
	habits, err := st.ListHabits(ctx, "alice", true)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(habits) != 2 || habits[0].ID != b.ID || habits[1].ID != a.ID {
		t.Errorf("order = %v", habits)
	}
	// The other user's habit kept its own position.
	if other, _ := st.ListHabits(ctx, "someone-else", true); len(other) != 1 {
		t.Error("the foreign list was touched")
	}
}
