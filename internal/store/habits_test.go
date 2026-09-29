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

	err := st.View(ctx, "someone-else", func(tx *Tx) error {
		_, err := tx.Habit(t.Context(), mine.ID)
		return err
	})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Habit of another user: %v, want ErrNotFound", err)
	}
	_, err = st.Update(ctx, "someone-else", func(tx *Tx) error { return tx.DeleteHabit(t.Context(), mine.ID) })
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteHabit of another user: %v, want ErrNotFound", err)
	}
	_, err = st.Update(ctx, "someone-else", func(tx *Tx) error {
		h := mine
		h.Name = "Mine now"
		return tx.SaveHabit(t.Context(), &h)
	})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("SaveHabit of another user: %v, want ErrNotFound", err)
	}
	if theirs := read(t, st, "someone-else", func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context()) }); len(theirs) != 0 {
		t.Errorf("another user's list contains %d habits, want 0", len(theirs))
	}
	if entries := entriesOf(t, st, "someone-else", mine.ID); len(entries) != 0 {
		t.Errorf("another user reads %d entries, want 0", len(entries))
	}
}

// ReplaceEntries replaces the history of a habit, as after a change of kind.
func TestReplaceEntries(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))
	friday, saturday := day(2026, time.September, 18), day(2026, time.September, 19)
	for _, d := range []domain.Date{friday, saturday} {
		setEntry(t, st, "alice", h, d, domain.Entry{Value: 5200})
	}

	update(t, st, "alice", func(tx *Tx) error {
		h.Kind = domain.KindCheck
		if err := tx.SaveHabit(t.Context(), &h); err != nil {
			return err
		}
		return tx.ReplaceEntries(t.Context(), h, map[domain.Date]domain.Entry{friday: {Value: 1}})
	})
	entries := entriesOf(t, st, "alice", h.ID)
	if want := (domain.Entry{Value: 1}); len(entries) != 1 || entries[friday] != want {
		t.Errorf("entries = %v, want only Friday, ticked", entries)
	}
}

// SaveHabit stores every field and keeps the history.
func TestSaveHabitKeepsTheEntries(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 50})

	h.Name = "Wasser trinken"
	h.Color = "sky"
	h.StepValue = 20
	h.Schedules[0].TargetValue = 100
	h.Schedules[0].Frequency = domain.Frequency{Kind: domain.FreqTimesPerWeek, TimesPerWeek: 4}
	update(t, st, "alice", func(tx *Tx) error { return tx.SaveHabit(t.Context(), &h) })

	after := habitOf(t, st, "alice", h.ID)
	if after.Name != "Wasser trinken" || after.Current().TargetValue != 100 || after.StepValue != 20 {
		t.Errorf("habit = %+v, want the new name, target 100 and step 20", after)
	}
	if f := after.Current().Frequency; f.Kind != domain.FreqTimesPerWeek || f.TimesPerWeek != 4 {
		t.Errorf("frequency = %+v, want 4 times per week", f)
	}
	if entries := entriesOf(t, st, "alice", h.ID); len(entries) != 1 {
		t.Errorf("entries = %v, want the one kept", entries)
	}
}

// A new habit keeps a creation time already set, as an imported one does.
func TestCreateHabitKeepsASetCreationTime(t *testing.T) {
	st := openTestStore(t)
	h := countHabit(domain.KindCheck, 1)
	h.CreatedAt = time.Date(2024, 3, 1, 8, 0, 0, 0, time.UTC)
	h = mustCreateHabit(t, st, "alice", h)
	if got := habitOf(t, st, "alice", h.ID).CreatedAt; !got.Equal(h.CreatedAt) {
		t.Errorf("createdAt = %v, want %v", got, h.CreatedAt)
	}
}

// Week interval and week of month are stored and read back.
func TestNarrowedWeekdaysRoundTrip(t *testing.T) {
	st := openTestStore(t)
	for _, freq := range []domain.Frequency{
		{Kind: domain.FreqWeekdays, Weekdays: 1, WeekInterval: 4, AnchorDate: day(2026, time.September, 14)},
		{Kind: domain.FreqWeekdays, Weekdays: 1, WeekInterval: 1, WeekOfMonth: domain.LastWeekOfMonth},
	} {
		h := countHabit(domain.KindCheck, 1)
		h.Schedules[0].Frequency = freq
		h = mustCreateHabit(t, st, "alice", h)
		stored := habitOf(t, st, "alice", h.ID)
		if got := stored.Current().Frequency; got != freq {
			t.Errorf("frequency = %+v, want %+v", got, freq)
		}
	}
}

// A habit cannot be assigned to another user's or a non-existent category.
func TestHabitCannotJoinAForeignCategory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	var theirs domain.Category
	update(t, st, "someone-else", func(tx *Tx) error {
		theirs = domain.Category{Name: "Sport"}
		return tx.CreateCategory(t.Context(), &theirs)
	})

	for _, id := range []string{theirs.ID, "does-not-exist"} {
		_, err := st.Update(ctx, "alice", func(tx *Tx) error {
			h := countHabit(domain.KindCheck, 1)
			h.CategoryID = id
			return tx.CreateHabit(t.Context(), &h)
		})
		if !errors.Is(err, domain.ErrValidation) {
			t.Errorf("category %q: %v, want ErrValidation", id, err)
		}
	}
}

// Deleting a habit removes its schedules and entries.
func TestDeleteHabitRemovesItsHistory(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 1})

	update(t, st, "alice", func(tx *Tx) error { return tx.DeleteHabit(t.Context(), h.ID) })
	for _, table := range []string{"habits", "habit_schedules", "entries"} {
		if n := queryInt(t, st, `SELECT COUNT(*) FROM `+table); n != 0 {
			t.Errorf("%s: %d rows left, want 0", table, n)
		}
	}
}

// habitIDs returns the IDs of the user's habits in display order.
func habitIDs(t *testing.T, st *Store, user string) []string {
	t.Helper()
	var ids []string
	for _, h := range read(t, st, user, func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context()) }) {
		ids = append(ids, h.ID)
	}
	return ids
}

// Reordering ignores other users' habits.
func TestReorderIgnoresForeignIDs(t *testing.T) {
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	theirs := mustCreateHabit(t, st, "someone-else", countHabit(domain.KindCheck, 1))

	update(t, st, "alice", func(tx *Tx) error { return tx.ReorderHabits(t.Context(), []string{b.ID, theirs.ID, a.ID}) })
	if got := habitIDs(t, st, "alice"); len(got) != 2 || got[0] != b.ID || got[1] != a.ID {
		t.Errorf("order = %v, want %v", got, []string{b.ID, a.ID})
	}
	if other := habitIDs(t, st, "someone-else"); len(other) != 1 {
		t.Error("the other user's list was touched")
	}
}

// Habits missing from the new order follow the given ones in their previous
// order.
func TestReorderPlacesUnnamedHabitsAfterTheNamedOnes(t *testing.T) {
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	c := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	update(t, st, "alice", func(tx *Tx) error { return tx.ReorderHabits(t.Context(), []string{c.ID}) })
	habits := read(t, st, "alice", func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context()) })
	want := []string{c.ID, a.ID, b.ID}
	for i, h := range habits {
		if h.ID != want[i] || h.Position != i {
			t.Errorf("habits[%d] = %s at %d, want %s at %d", i, h.ID, h.Position, want[i], i)
		}
	}
}

// An order containing a habit twice is rejected.
func TestReorderRefusesADuplicate(t *testing.T) {
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	_, err := st.Update(context.Background(), "alice", func(tx *Tx) error {
		return tx.ReorderHabits(t.Context(), []string{b.ID, a.ID, b.ID})
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("err = %v, want a validation error", err)
	}
	if got := habitIDs(t, st, "alice"); got[0] != a.ID || got[1] != b.ID {
		t.Error("a refused order was applied anyway")
	}
}

// Reordering does not change updated_at.
func TestReorderKeepsUpdatedAt(t *testing.T) {
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	before := habitOf(t, st, "alice", a.ID)

	update(t, st, "alice", func(tx *Tx) error { return tx.ReorderHabits(t.Context(), []string{b.ID, a.ID}) })
	after := habitOf(t, st, "alice", a.ID)
	if after.Position != 1 {
		t.Errorf("position = %d, want 1", after.Position)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Errorf("updatedAt = %v, want the untouched %v", after.UpdatedAt, before.UpdatedAt)
	}
}
