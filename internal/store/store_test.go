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
		Name: "Test", Color: "green", Kind: kind, TargetValue: target,
		Frequency: domain.Frequency{Kind: domain.FreqDaily},
	}
}

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

	// Timestamps without fixed-width nanoseconds still parse.
	if _, err := parseTime("2026-09-19T12:00:00.5Z"); err != nil {
		t.Errorf("old timestamp without padding: %v", err)
	}
}

// The migration to colour names maps the palette and moves anything else to
// slate, or for the band to neutral.
func TestColorMigrationMapsThePalette(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	db := openAtMigration(t, path, "WHEN '#dc2626' THEN 'red'")
	now := formatTime(time.Now())
	for _, stmt := range []string{
		`INSERT INTO habits (id, user_id, name, color, kind, created_at, updated_at)
		 VALUES ('h1', 'alice', 'A', '#2563EB', 'check', '` + now + `', '` + now + `'),
		        ('h2', 'alice', 'B', '#123456', 'check', '` + now + `', '` + now + `')`,
		`INSERT INTO habit_schedules (habit_id, valid_from, target_value, freq_kind)
		 VALUES ('h1', '2026-01-01', 1, 'daily'), ('h2', '2026-01-01', 1, 'daily')`,
		`INSERT INTO categories (id, user_id, name, color, created_at, updated_at)
		 VALUES ('c1', 'alice', 'Sport', '#db2777', '` + now + `', '` + now + `'),
		        ('c2', 'alice', 'Home', '', '` + now + `', '` + now + `')`,
		`INSERT INTO user_settings (user_id, data, updated_at)
		 VALUES ('alice', '{"bandColor":"#eab308"}', ''), ('bob', '{"bandColor":"#abcdef"}', '')`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	for id, want := range map[string]string{"h1": "blue", "h2": "slate"} {
		if h, _ := st.GetHabit(ctx, "alice", id); h.Color != want {
			t.Errorf("habit %s: color %q, want %q", id, h.Color, want)
		}
	}
	for id, want := range map[string]string{"c1": "pink", "c2": ""} {
		if c, _ := st.GetCategory(ctx, "alice", id); c.Color != want {
			t.Errorf("category %s: color %q, want %q", id, c.Color, want)
		}
	}
	for user, want := range map[string]string{"alice": "yellow", "bob": "neutral"} {
		if s, _ := st.GetSettings(ctx, user); s.BandColor != want {
			t.Errorf("%s: band colour %q, want %q", user, s.BandColor, want)
		}
	}
}
