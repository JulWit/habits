package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// undo undoes the step id (0 for the latest) of user and returns the error.
func undo(st *Store, user string, id int64) error {
	_, err := st.Undo(context.Background(), user, id)
	return err
}

// redo redoes the step id (0 for the one undone last) of user and returns the
// error.
func redo(st *Store, user string, id int64) error {
	_, err := st.Redo(context.Background(), user, id)
	return err
}

// mustUndo undoes the step id of user and fails the test if that fails.
func mustUndo(t *testing.T, st *Store, user string, id int64) Step {
	t.Helper()
	step, err := st.Undo(context.Background(), user, id)
	if err != nil {
		t.Fatalf("Undo(%d): %v", id, err)
	}
	return step
}

// mustRedo redoes the step id of user and fails the test if that fails.
func mustRedo(t *testing.T, st *Store, user string, id int64) Step {
	t.Helper()
	step, err := st.Redo(context.Background(), user, id)
	if err != nil {
		t.Fatalf("Redo(%d): %v", id, err)
	}
	return step
}

// Undo writes a day's previous entry back, redo the new one; the step keeps
// its label.
func TestUndoAndRedoAnEntry(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	d := day(2026, time.September, 18)
	setEntry(t, st, "alice", h, d, domain.Entry{Value: 30})
	id := setEntry(t, st, "alice", h, d, domain.Entry{Value: 50})
	if id == 0 {
		t.Fatal("no undo step recorded")
	}

	step := mustUndo(t, st, "alice", 0)
	if step.ID != id || step.Template != "{name} — {date}" || step.Params["date"] != d.String() {
		t.Errorf("undone step = %+v", step)
	}
	if got := entriesOf(t, st, "alice", h.ID)[d].Value; got != 30 {
		t.Errorf("after undo: %d, want 30", got)
	}
	mustRedo(t, st, "alice", 0)
	if got := entriesOf(t, st, "alice", h.ID)[d].Value; got != 50 {
		t.Errorf("after redo: %d, want 50", got)
	}
	// Undo and redo again, as a step can be turned any number of times.
	mustUndo(t, st, "alice", id)
	mustRedo(t, st, "alice", id)
	if got := entriesOf(t, st, "alice", h.ID)[d].Value; got != 50 {
		t.Errorf("after the second redo: %d, want 50", got)
	}
}

// Undoing the deletion of a habit brings it back with its schedules and
// entries.
func TestUndoDeleteHabitRestoresItsHistory(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	daily := domain.Schedule{TargetValue: 100, Frequency: domain.Frequency{Kind: domain.FreqDaily}}
	if err := h.Reschedule(daily, day(2026, time.March, 1), false); err != nil {
		t.Fatal(err)
	}
	update(t, st, "alice", func(tx *Tx) error { return tx.SaveHabit(t.Context(), &h) })
	d := day(2026, time.September, 18)
	setEntry(t, st, "alice", h, d, domain.Entry{Value: 30})

	id := update(t, st, "alice", func(tx *Tx) error {
		tx.Record(`"{name}" deleted`, "name", h.Name)
		return tx.DeleteHabit(t.Context(), h.ID)
	})
	mustUndo(t, st, "alice", id)
	back := habitOf(t, st, "alice", h.ID)
	if len(back.Schedules) != 2 || back.Name != h.Name || back.Position != h.Position {
		t.Errorf("restored habit = %+v", back)
	}
	if got := entriesOf(t, st, "alice", h.ID)[d].Value; got != 30 {
		t.Errorf("restored entry = %d, want 30", got)
	}

	mustRedo(t, st, "alice", id)
	if habits := habitIDs(t, st, "alice"); len(habits) != 0 {
		t.Errorf("habits after redo = %v, want none", habits)
	}
}

// Undoing the creation of a habit removes it with the entries recorded
// since, and redoing it brings those back as well.
func TestUndoCreateHabitKeepsLaterEntriesForRedo(t *testing.T) {
	st := openTestStore(t)
	h := countHabit(domain.KindCheck, 1)
	created := update(t, st, "alice", func(tx *Tx) error {
		tx.Record(`"{name}" created`, "name", h.Name)
		return tx.CreateHabit(t.Context(), &h)
	})
	d := day(2026, time.September, 18)
	setEntry(t, st, "alice", h, d, domain.Entry{Value: 1})

	mustUndo(t, st, "alice", created)
	if habits := habitIDs(t, st, "alice"); len(habits) != 0 {
		t.Fatalf("habits after undo = %v, want none", habits)
	}
	mustRedo(t, st, "alice", created)
	if got := entriesOf(t, st, "alice", h.ID)[d].Value; got != 1 {
		t.Errorf("entry after redo = %d, want 1", got)
	}
}

// Undoing the deletion of a category puts its habits back into it.
func TestUndoDeleteCategoryPutsItsHabitsBack(t *testing.T) {
	st := openTestStore(t)
	c := createCategory(t, st, "alice", domain.Category{Name: "Sport"})
	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = c.ID
	h = mustCreateHabit(t, st, "alice", h)

	id := update(t, st, "alice", func(tx *Tx) error {
		tx.Record(`Category "{name}" deleted`, "name", c.Name)
		return tx.DeleteCategory(t.Context(), c.ID)
	})
	mustUndo(t, st, "alice", id)
	if got := categoryOf(t, st, "alice", c.ID); got.Name != "Sport" {
		t.Errorf("category = %+v", got)
	}
	if got := habitOf(t, st, "alice", h.ID).CategoryID; got != c.ID {
		t.Errorf("habit's category = %q, want %q", got, c.ID)
	}
}

// A step whose rows were changed since cannot be undone; it is dropped.
func TestUndoRefusesAChangeMadeSince(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	rename := func(name string) int64 {
		return update(t, st, "alice", func(tx *Tx) error {
			tx.Record(`"{name}" edited`, "name", h.Name)
			h.Name = name
			return tx.SaveHabit(t.Context(), &h)
		})
	}
	first := rename("Read")
	rename("Read more")

	if err := undo(st, "alice", first); !errors.Is(err, ErrConflict) {
		t.Fatalf("undo of the first rename: %v, want ErrConflict", err)
	}
	if got := habitOf(t, st, "alice", h.ID).Name; got != "Read more" {
		t.Errorf("name = %q, want the later one kept", got)
	}
	if err := undo(st, "alice", first); !errors.Is(err, ErrNotFound) {
		t.Errorf("undo of a dropped step: %v, want ErrNotFound", err)
	}
}

// A change of other columns of the same row does not stand in the way.
func TestUndoIgnoresOtherColumns(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	renamed := update(t, st, "alice", func(tx *Tx) error {
		tx.Record(`"{name}" edited`, "name", h.Name)
		h.Name = "Read"
		return tx.SaveHabit(t.Context(), &h)
	})
	update(t, st, "alice", func(tx *Tx) error {
		h.Color = "red"
		return tx.SaveHabit(t.Context(), &h)
	})
	// Entries touch the habit's updated_at, and reordering its position.
	setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 1})
	update(t, st, "alice", func(tx *Tx) error { return tx.ReorderHabits(t.Context(), []string{h.ID}) })

	mustUndo(t, st, "alice", renamed)
	if got := habitOf(t, st, "alice", h.ID); got.Name != "Test" || got.Color != "red" {
		t.Errorf("habit = %s in %s, want Test in red", got.Name, got.Color)
	}
}

// Undo without an ID takes the latest step, redo the one undone last, and a
// new step drops the undone ones.
func TestUndoOrderAndANewStepDropsRedo(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	a := setEntry(t, st, "alice", h, day(2026, time.September, 17), domain.Entry{Value: 10})
	b := setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 20})

	if got := mustUndo(t, st, "alice", 0).ID; got != b {
		t.Errorf("first undo took %d, want %d", got, b)
	}
	if got := mustUndo(t, st, "alice", 0).ID; got != a {
		t.Errorf("second undo took %d, want %d", got, a)
	}
	if got := mustRedo(t, st, "alice", 0).ID; got != a {
		t.Errorf("redo took %d, want %d, undone last", got, a)
	}

	c := setEntry(t, st, "alice", h, day(2026, time.September, 19), domain.Entry{Value: 30})
	if c <= b {
		t.Errorf("new step %d reuses the ID of a dropped one (%d)", c, b)
	}
	if err := redo(st, "alice", 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("redo after a new step: %v, want ErrNotFound", err)
	}
	if err := redo(st, "alice", b); !errors.Is(err, ErrNotFound) {
		t.Errorf("redo of a dropped step: %v, want ErrNotFound", err)
	}
}

// Steps belong to their user.
func TestUndoIsScopedToTheUser(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	id := setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 1})

	if err := undo(st, "mallory", id); !errors.Is(err, ErrNotFound) {
		t.Errorf("undo by another user: %v, want ErrNotFound", err)
	}
	if err := undo(st, "mallory", 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("undo of another user's latest: %v, want ErrNotFound", err)
	}
}

// An Update without Record keeps no step, nor does a recorded one that
// changes nothing.
func TestOnlyRecordedChangesAreSteps(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	if id := update(t, st, "alice", func(tx *Tx) error { return tx.ReorderHabits(t.Context(), []string{h.ID}) }); id != 0 {
		t.Errorf("reordering recorded step %d", id)
	}
	if id := update(t, st, "alice", func(tx *Tx) error {
		tx.Record(`"{name}" edited`, "name", h.Name)
		return tx.SaveHabit(t.Context(), &h)
	}); id != 0 {
		t.Errorf("saving an unchanged habit recorded step %d", id)
	}
	if err := undo(st, "alice", 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("undo: %v, want ErrNotFound", err)
	}
}

// Only the latest maxSteps steps are kept, and PurgeSteps removes expired
// ones.
func TestStepsAreLimited(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	d := day(2026, time.September, 18)
	for value := 1; value <= maxSteps+5; value++ {
		setEntry(t, st, "alice", h, d, domain.Entry{Value: value})
	}
	count := func() int {
		var n int
		st.db.QueryRow(`SELECT COUNT(*) FROM changes`).Scan(&n)
		return n
	}
	if n := count(); n != maxSteps {
		t.Errorf("%d steps kept, want %d", n, maxSteps)
	}

	// A negative duration puts the cutoff in the future, independent of the
	// clock resolution.
	if n, err := st.PurgeSteps(context.Background(), -time.Hour); err != nil || n != maxSteps {
		t.Errorf("PurgeSteps removed %d steps (err %v), want %d", n, err, maxSteps)
	}
	if n := count(); n != 0 {
		t.Errorf("%d steps left after purging", n)
	}
}
