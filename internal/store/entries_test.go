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
		if _, err := st.SetEntry(ctx, "alice", h.ID, day, bad, nil); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("SetEntry(%d) = %v, want ErrValidation", bad, err)
		}
	}
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, domain.KindDistance.MaxTarget(), nil); err != nil {
		t.Errorf("the maximum itself must be allowed: %v", err)
	}
}

// SetEntry returns the previous value; a value of 0 deletes the entry.
func TestSetEntryReturnsThePreviousValueAndStaysSparse(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 30, nil); err != nil || prev != 0 {
		t.Fatalf("first write: prev = %d, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 50, nil); err != nil || prev != 30 {
		t.Fatalf("second write: prev = %d, want 30, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 0, nil); err != nil || prev != 50 {
		t.Fatalf("delete: prev = %d, want 50, err = %v", prev, err)
	}

	entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("EntriesForHabit: %v", err)
	}
	if _, present := entries[day]; present {
		t.Error("a day set to 0 must have no row, not a row holding 0")
	}
}

// SetEntry with expect writes only while the stored value is still the expected one.
func TestSetEntryWithExpectRefusesAChangedValue(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if _, err := st.SetEntry(ctx, "alice", h.ID, day, 30, ptr(0)); err != nil {
		t.Fatalf("expecting no entry: %v", err)
	}
	prev, err := st.SetEntry(ctx, "alice", h.ID, day, 0, ptr(20))
	if !errors.Is(err, ErrConflict) || prev != 30 {
		t.Fatalf("got %d, %v; want the stored 30 and ErrConflict", prev, err)
	}
	if got, _ := st.EntriesForHabit(ctx, "alice", h.ID); got[day] != 30 {
		t.Errorf("value = %d after a refused write, want 30", got[day])
	}
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, 0, ptr(30)); err != nil {
		t.Errorf("expecting the stored value: %v", err)
	}
}
