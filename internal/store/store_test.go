package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// openTestStore builds a real SQLite database in the test's temp directory and
// runs every migration against it. The driver is pure Go, so this needs no
// toolchain and no fixture file — and it means the migrations themselves are
// exercised on each run.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	st, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func mustCreateHabit(t *testing.T, st *Store, user string, h domain.Habit) domain.Habit {
	t.Helper()
	if err := st.CreateHabit(context.Background(), user, &h); err != nil {
		t.Fatalf("CreateHabit: %v", err)
	}
	return h
}

// day keeps the Date literals keyed, which vet insists on across packages.
func day(y int, m time.Month, d int) domain.Date {
	return domain.Date{Year: y, Month: m, Day: d}
}

func countHabit(kind domain.Kind, target int) domain.Habit {
	return domain.Habit{
		Name: "Test", Color: "#16a34a", Kind: kind, TargetValue: target,
		Frequency: domain.Frequency{Kind: domain.FreqDaily},
	}
}

// Every migration applies cleanly to an empty file, and re-opening the same
// file is a no-op rather than a second run.
func TestMigrationsAreIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")

	first, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	h := mustCreateHabit(t, first, "alice", countHabit(domain.KindCheck, 1))
	first.Close()

	second, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer second.Close()
	if _, err := second.GetHabit(ctx, "alice", h.ID); err != nil {
		t.Errorf("habit did not survive the second start: %v", err)
	}
}

// Stored timestamps are compared as text — by the purge, and as the tie-break
// in every list — so the text order has to be the chronological order. A
// trimmed fraction would break that: ".5Z" sorts after ".5001Z".
func TestStoredTimestampsSortChronologically(t *testing.T) {
	base := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	ordered := []time.Time{
		base,
		base.Add(1 * time.Nanosecond),
		base.Add(100 * time.Microsecond),
		base.Add(500 * time.Millisecond),    // the ".5" case
		base.Add(500100 * time.Microsecond), // ".5001", which must sort after it
		base.Add(1 * time.Second),
		base.Add(90 * 24 * time.Hour),
	}
	for i := 1; i < len(ordered); i++ {
		earlier, later := formatTime(ordered[i-1]), formatTime(ordered[i])
		if !(earlier < later) {
			t.Errorf("%q does not sort before %q", earlier, later)
		}
	}

	// And the format still parses back to the instant it came from.
	for _, want := range ordered {
		got, err := parseTime(formatTime(want))
		if err != nil {
			t.Errorf("parseTime(%q): %v", formatTime(want), err)
			continue
		}
		if !got.Equal(want) {
			t.Errorf("round trip: %v != %v", got, want)
		}
	}

	// Rows written before the padding existed still read back correctly.
	if _, err := parseTime("2026-09-19T12:00:00.5Z"); err != nil {
		t.Errorf("old timestamp without padding: %v", err)
	}
}
