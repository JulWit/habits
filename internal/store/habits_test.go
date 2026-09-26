package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Users can only access their own habits.
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

// The kind of a habit with entries cannot be changed.
func TestKindCannotChangeOnceThereIsAHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))

	// Without entries, the kind can be changed.
	changed := h
	changed.Kind = domain.KindCount
	changed.TargetValue = 80
	if err := st.UpdateHabit(ctx, "alice", &changed); err != nil {
		t.Fatalf("kind change without history must be allowed: %v", err)
	}

	// With an entry, the change is rejected.
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.September, 18), 50); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}
	again := changed
	again.Kind = domain.KindTime
	err := st.UpdateHabit(ctx, "alice", &again)
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("kind change with history: %v, want ErrValidation", err)
	}

	// The habit is unchanged.
	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Kind != domain.KindCount {
		t.Errorf("kind = %q, want count — the failure must not have written anything", after.Kind)
	}
}

// All fields except the kind remain editable when a habit has entries.
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

// Week interval and week of month are stored and read back.
func TestNarrowedWeekdaysRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	for _, freq := range []domain.Frequency{
		{Kind: domain.FreqWeekdays, Weekdays: 1, WeekInterval: 4, AnchorDate: day(2026, time.September, 14)},
		{Kind: domain.FreqWeekdays, Weekdays: 1, WeekInterval: 1, WeekOfMonth: domain.LastWeekOfMonth},
	} {
		h := countHabit(domain.KindCheck, 1)
		h.Frequency = freq
		h = mustCreateHabit(t, st, "alice", h)
		after, err := st.GetHabit(ctx, "alice", h.ID)
		if err != nil {
			t.Fatalf("GetHabit: %v", err)
		}
		if after.Frequency != freq {
			t.Errorf("frequency = %+v, want %+v", after.Frequency, freq)
		}
	}
}

// A habit cannot be assigned to another user's or a non-existent category.
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

// A soft-deleted habit can be restored with its entries.
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
	// PurgeDeleted keeps habits deleted within the retention period.
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

// PurgeDeleted removes expired habits and their entries.
func TestPurgeRemovesWhatIsPastTheWindow(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	if err := st.SoftDeleteHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("SoftDeleteHabit: %v", err)
	}

	// A negative duration puts the cutoff in the future, independent of the
	// clock resolution.
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

// Reordering ignores other users' habits.
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
	// The other user's habit keeps its position.
	if other, _ := st.ListHabits(ctx, "someone-else", true); len(other) != 1 {
		t.Error("the foreign list was touched")
	}
}

// Habits missing from the new order follow the given ones in their previous
// order.
func TestReorderPlacesUnnamedHabitsAfterTheNamedOnes(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	c := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	if err := st.ReorderHabits(ctx, "alice", []string{c.ID}); err != nil {
		t.Fatalf("ReorderHabits: %v", err)
	}
	habits, err := st.ListHabits(ctx, "alice", true)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	want := []string{c.ID, a.ID, b.ID}
	for i, h := range habits {
		if h.ID != want[i] || h.Position != i {
			t.Errorf("habits[%d] = %s at %d, want %s at %d", i, h.ID, h.Position, want[i], i)
		}
	}
}

// An order containing a habit twice is rejected.
func TestReorderRefusesADuplicate(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	err := st.ReorderHabits(ctx, "alice", []string{b.ID, a.ID, b.ID})
	if !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("err = %v, want a validation error", err)
	}
	habits, _ := st.ListHabits(ctx, "alice", true)
	if habits[0].ID != a.ID || habits[1].ID != b.ID {
		t.Error("a refused order was applied anyway")
	}
}

// Reordering does not change updated_at.
func TestReorderKeepsUpdatedAt(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	before, err := st.GetHabit(ctx, "alice", a.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}

	if err := st.ReorderHabits(ctx, "alice", []string{b.ID, a.ID}); err != nil {
		t.Fatalf("ReorderHabits: %v", err)
	}
	after, err := st.GetHabit(ctx, "alice", a.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Position != 1 {
		t.Errorf("position = %d, want 1", after.Position)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Errorf("updatedAt = %v, want the untouched %v", after.UpdatedAt, before.UpdatedAt)
	}
}
