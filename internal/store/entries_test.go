package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// SetEntries rejects values above the kind's maximum.
func TestSetEntriesBoundsTheValue(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))
	d := day(2026, time.September, 18)
	write := func(value int) error {
		_, err := st.Update(context.Background(), "alice", func(tx *Tx) error {
			return tx.SetEntries(t.Context(), h, map[domain.Date]domain.Entry{d: {Value: value}})
		})
		return err
	}

	for _, bad := range []int{-1, domain.KindDistance.MaxTarget() + 1, 1 << 40} {
		if err := write(bad); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("value %d: %v, want ErrValidation", bad, err)
		}
	}
	if err := write(domain.KindDistance.MaxTarget()); err != nil {
		t.Errorf("the maximum itself must be allowed: %v", err)
	}
}

// A day with nothing recorded has no row.
func TestEntriesStaySparse(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	d := day(2026, time.September, 18)

	setEntry(t, st, "alice", h, d, domain.Entry{Value: 30})
	if got := read(t, st, "alice", func(tx *Tx) (map[domain.Date]domain.Entry, error) { return tx.HabitEntries(t.Context(), h.ID) })[d]; got.Value != 30 {
		t.Errorf("Entry = %+v, want 30", got)
	}
	setEntry(t, st, "alice", h, d, domain.Entry{})
	if n := queryInt(t, st, `SELECT COUNT(*) FROM entries`); n != 0 {
		t.Error("a day set to nothing must have no row, not a row holding 0")
	}
}

// A skip is stored with the entry; a skip with a value is refused.
func TestEntriesStoreSkips(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	d := day(2026, time.September, 18)

	setEntry(t, st, "alice", h, d, domain.Entry{Skipped: true})
	if got, want := entriesOf(t, st, "alice", h.ID)[d], (domain.Entry{Skipped: true}); got != want {
		t.Errorf("after the skip: %+v, want %+v", got, want)
	}
	_, err := st.Update(context.Background(), "alice", func(tx *Tx) error {
		return tx.SetEntries(t.Context(), h, map[domain.Date]domain.Entry{d: {Value: 5, Skipped: true}})
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("a skip with a value: %v, want a validation error", err)
	}
}

// Writing entries updates the habit's updated_at.
func TestSetEntriesTouchesTheHabit(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	// Far back, as the clock may not have moved on since the habit was created.
	if _, err := st.db.Exec(`UPDATE habits SET updated_at = '2000-01-01T00:00:00.000000000Z'`); err != nil {
		t.Fatalf("backdating updated_at: %v", err)
	}
	before := habitOf(t, st, "alice", h.ID).UpdatedAt
	setEntry(t, st, "alice", h, day(2026, time.September, 18), domain.Entry{Value: 1})
	if after := habitOf(t, st, "alice", h.ID).UpdatedAt; !after.After(before) {
		t.Errorf("updatedAt = %v, want later than %v", after, before)
	}
}
