package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// The regression guard for the unbounded entry value: the API is reachable
// without the client that used to be the only thing enforcing the ceiling.
func TestSetEntryBoundsTheValue(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))
	day := day(2026, time.September, 18)

	for _, bad := range []int{-1, domain.KindDistance.MaxTarget() + 1, 1 << 40} {
		if _, err := st.SetEntry(ctx, "alice", h.ID, day, bad); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("SetEntry(%d) = %v, want ErrValidation", bad, err)
		}
	}
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, domain.KindDistance.MaxTarget()); err != nil {
		t.Errorf("the maximum itself must be allowed: %v", err)
	}
}

// Undo leans entirely on the returned previous value, and a zero clears the row
// rather than storing a zero.
func TestSetEntryReturnsThePreviousValueAndStaysSparse(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 30); err != nil || prev != 0 {
		t.Fatalf("first write: prev = %d, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 50); err != nil || prev != 30 {
		t.Fatalf("second write: prev = %d, want 30, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 0); err != nil || prev != 50 {
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
