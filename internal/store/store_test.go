package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// openTestStore opens a new database in a temporary directory, running all
// migrations.
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

// day returns a Date (keyed fields, as required by vet).
func day(y int, m time.Month, d int) domain.Date {
	return domain.Date{Year: y, Month: m, Day: d}
}

func countHabit(kind domain.Kind, target int) domain.Habit {
	return domain.Habit{
		Name: "Test", Color: "green", Kind: kind,
		Schedules: []domain.Schedule{
			{From: day(2026, time.January, 1), TargetValue: target, Frequency: domain.Frequency{Kind: domain.FreqDaily}},
		},
	}
}

func ptr[T any](v T) *T { return &v }

// setValue is the change that sets a day's value.
func setValue(v int) domain.EntryChange { return domain.EntryChange{Value: &v} }

// Migrations apply to an empty database, and reopening it does not run them
// again.
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

// Stored timestamps sort chronologically as text.
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

	// Stored timestamps parse back to the original time.
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
}

// Deleting a user removes all their data, and only theirs.
func TestDeleteUserRemovesAllTheirData(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	cat := domain.Category{Name: "Health"}
	if err := st.CreateCategory(ctx, "alice", &cat); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	h := countHabit(domain.KindCount, 10)
	h.CategoryID = cat.ID
	h = mustCreateHabit(t, st, "alice", h)
	if _, _, _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.January, 5), setValue(20), nil); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}
	if _, err := st.UpdateSettings(ctx, "alice", func(s *Settings) error { s.Theme = "dark"; return nil }); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	mustCreateHabit(t, st, "bob", countHabit(domain.KindCheck, 1))

	if err := st.DeleteUser(ctx, "alice"); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	for _, table := range []string{"users", "user_settings", "categories", "habits", "habit_schedules", "entries"} {
		var n int
		if err := st.db.QueryRowContext(ctx, `SELECT count(*) FROM `+table+` WHERE `+ownerColumn(table)+` = 'alice'`).Scan(&n); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows of alice left", table, n)
		}
	}
	got, err := st.GetSettings(ctx, "alice")
	if err != nil || got != DefaultSettings() {
		t.Errorf("settings = %+v, %v; want the defaults", got, err)
	}
	bobs, err := st.ListHabits(ctx, "bob", true)
	if err != nil || len(bobs) != 1 {
		t.Errorf("bob's habits = %d, %v; want 1", len(bobs), err)
	}
	// Once more, without data.
	if err := st.DeleteUser(ctx, "alice"); err != nil {
		t.Errorf("DeleteUser without data: %v", err)
	}
}

// ownerColumn returns an expression for the user a row of table belongs to.
func ownerColumn(table string) string {
	switch table {
	case "users":
		return "id"
	case "habit_schedules", "entries":
		return "(SELECT user_id FROM habits WHERE habits.id = habit_id)"
	default:
		return "user_id"
	}
}
