package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// SetEntry rejects values above the kind's maximum.
func TestSetEntryBoundsTheValue(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))
	day := day(2026, time.September, 18)

	for _, bad := range []int{-1, domain.KindDistance.MaxTarget() + 1, 1 << 40} {
		if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(bad), nil); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("SetEntry(%d) = %v, want ErrValidation", bad, err)
		}
	}
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(domain.KindDistance.MaxTarget()), nil); err != nil {
		t.Errorf("the maximum itself must be allowed: %v", err)
	}
}

// SetEntry returns the previous entry; a day with nothing recorded has no
// row.
func TestSetEntryReturnsThePreviousEntryAndStaysSparse(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if prev, next, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(30), nil); err != nil || !prev.IsZero() || next.Value != 30 {
		t.Fatalf("first write: prev = %+v, next = %+v, err = %v", prev, next, err)
	}
	if prev, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(50), nil); err != nil || prev.Value != 30 {
		t.Fatalf("second write: prev = %+v, want 30, err = %v", prev, err)
	}
	if prev, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(0), nil); err != nil || prev.Value != 50 {
		t.Fatalf("delete: prev = %+v, want 50, err = %v", prev, err)
	}

	entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("EntriesForHabit: %v", err)
	}
	if _, present := entries[day]; present {
		t.Error("a day set to 0 must have no row, not a row holding 0")
	}
}

// A skip and a note are stored with the entry; a note keeps a day without a
// value, and a value ends a skip.
func TestSetEntryStoresSkipsAndNotes(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)
	stored := func() domain.Entry {
		t.Helper()
		entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
		if err != nil {
			t.Fatal(err)
		}
		return entries[day]
	}

	change := domain.EntryChange{Skipped: ptr(true), Note: ptr("  ill  ")}
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, change, nil); err != nil {
		t.Fatal(err)
	}
	if want := (domain.Entry{Skipped: true, Note: "ill"}); stored() != want {
		t.Errorf("after the skip: %+v, want %+v", stored(), want)
	}

	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(20), nil); err != nil {
		t.Fatal(err)
	}
	if want := (domain.Entry{Value: 20, Note: "ill"}); stored() != want {
		t.Errorf("after a value: %+v, want %+v", stored(), want)
	}

	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(0), nil); err != nil {
		t.Fatal(err)
	}
	if want := (domain.Entry{Note: "ill"}); stored() != want {
		t.Errorf("a note alone keeps the day: %+v, want %+v", stored(), want)
	}
}

// SetEntry with expect writes only while the stored entry is still the
// expected one.
func TestSetEntryWithExpectRefusesAChangedEntry(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(30), &domain.Entry{}); err != nil {
		t.Fatalf("expecting no entry: %v", err)
	}
	prev, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(0), &domain.Entry{Value: 20})
	if !errors.Is(err, ErrConflict) || prev.Value != 30 {
		t.Fatalf("got %+v, %v; want the stored 30 and ErrConflict", prev, err)
	}
	if got, _ := st.EntriesForHabit(ctx, "alice", h.ID); got[day].Value != 30 {
		t.Errorf("value = %d after a refused write, want 30", got[day].Value)
	}
	// A note changed meanwhile is a change too.
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, domain.EntryChange{Note: ptr("x")}, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(0), &domain.Entry{Value: 30}); !errors.Is(err, ErrConflict) {
		t.Errorf("expecting the old note: %v, want ErrConflict", err)
	}
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day, setValue(0), &domain.Entry{Value: 30, Note: "x"}); err != nil {
		t.Errorf("expecting the stored entry: %v", err)
	}
}

// WriteEntries applies the writes whose day still holds what they expect, and
// fails all of them for a foreign habit.
func TestWriteEntries(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	mon, tue := day(2026, time.September, 14), day(2026, time.September, 15)
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, tue, setValue(30), nil); err != nil {
		t.Fatal(err)
	}

	skip := domain.Entry{Skipped: true, Note: "holiday"}
	applied, err := st.WriteEntries(ctx, "alice", []EntryWrite{
		{HabitID: h.ID, Date: mon, Expect: domain.Entry{}, Entry: skip},
		// Tuesday holds 30 by now, so this one is left out.
		{HabitID: h.ID, Date: tue, Expect: domain.Entry{}, Entry: skip},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 1 || applied[0].Date != mon {
		t.Errorf("applied = %+v, want monday only", applied)
	}
	entries, _ := st.EntriesForHabit(ctx, "alice", h.ID)
	if entries[mon] != skip || entries[tue].Value != 30 {
		t.Errorf("entries = %+v", entries)
	}

	// Undo: back to nothing recorded.
	if _, err := st.WriteEntries(ctx, "alice", []EntryWrite{{HabitID: h.ID, Date: mon, Expect: skip}}); err != nil {
		t.Fatal(err)
	}
	if entries, _ := st.EntriesForHabit(ctx, "alice", h.ID); len(entries) != 1 {
		t.Errorf("after undo: %+v, want tuesday only", entries)
	}

	if _, err := st.WriteEntries(ctx, "mallory", []EntryWrite{{HabitID: h.ID, Date: mon, Entry: skip}}); !errors.Is(err, ErrNotFound) {
		t.Errorf("a foreign habit: %v, want ErrNotFound", err)
	}
	if _, err := st.WriteEntries(ctx, "alice", []EntryWrite{{HabitID: h.ID, Date: mon, Entry: domain.Entry{Value: 5, Skipped: true}}}); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("an invalid entry: %v, want a validation error", err)
	}
}
