package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// A database of version 1 with data is migrated to the schema a new database
// gets, and keeps its data.
func TestMigrationFromVersion1(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v1.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		schemaV1,
		`PRAGMA user_version = 1`,
		`INSERT INTO users VALUES ('alice', '2026-01-01T00:00:00.000000000Z')`,
		`INSERT INTO habits (id, user_id, name, color, kind, step_value, created_at, updated_at)
		 VALUES ('h1', 'alice', 'Water', 'sky', 'count', 10, '2026-01-01T00:00:00.000000000Z', '2026-01-01T00:00:00.000000000Z')`,
		`INSERT INTO habit_schedules (habit_id, valid_from, target_value, freq_kind, freq_times_per_week)
		 VALUES ('h1', '2026-01-01', 80, 'times_per_week', 3)`,
		`INSERT INTO entries VALUES ('h1', '2026-01-05', 40, '2026-01-05T00:00:00.000000000Z')`,
	} {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("setting up version 1: %v", err)
		}
	}
	old.Close()

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer st.Close()

	h, err := st.GetHabit(ctx, "alice", "h1")
	if err != nil {
		t.Fatal(err)
	}
	want := domain.Schedule{
		From: day(2026, time.January, 1), TargetValue: 80, TargetType: domain.TargetAtLeast,
		Frequency: domain.Frequency{Kind: domain.FreqTimesPerWeek, TimesPerWeek: 3},
	}
	if len(h.Schedules) != 1 || h.Schedules[0] != want {
		t.Errorf("schedules = %+v, want %+v", h.Schedules, want)
	}
	entries, err := st.EntriesForHabit(ctx, "alice", "h1")
	if err != nil {
		t.Fatal(err)
	}
	if got := entries[day(2026, time.January, 5)]; got != (domain.Entry{Value: 40}) {
		t.Errorf("entry = %+v, want the value 40", got)
	}

	fresh := openTestStore(t)
	if got, want := schemaOf(t, st.db), schemaOf(t, fresh.db); got != want {
		t.Errorf("migrated schema differs from a new one:\n%s\nwant:\n%s", got, want)
	}
	var version int
	st.db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != latestVersion() {
		t.Errorf("user_version = %d, want %d", version, latestVersion())
	}
}

// Migration 3 removes the notes: days that held only a note go, the others
// keep their value or skip.
func TestMigrationRemovesNotes(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v2.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	const stamp = "2026-01-01T00:00:00.000000000Z"
	for _, stmt := range []string{
		schemaV1,
		migrations[0],
		`PRAGMA user_version = 2`,
		`INSERT INTO users VALUES ('alice', '` + stamp + `')`,
		`INSERT INTO habits (id, user_id, name, color, kind, step_value, created_at, updated_at)
		 VALUES ('h1', 'alice', 'Read', 'sky', 'check', 1, '` + stamp + `', '` + stamp + `')`,
		`INSERT INTO habit_schedules (habit_id, valid_from, target_value, freq_kind)
		 VALUES ('h1', '2026-01-01', 1, 'daily')`,
		`INSERT INTO entries (habit_id, date, value, skipped, note, updated_at) VALUES
		 ('h1', '2026-01-05', 1, 0, 'done', '` + stamp + `'),
		 ('h1', '2026-01-06', 0, 1, 'ill', '` + stamp + `'),
		 ('h1', '2026-01-07', 0, 0, 'only a note', '` + stamp + `')`,
	} {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("setting up version 2: %v", err)
		}
	}
	old.Close()

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer st.Close()
	entries, err := st.EntriesForHabit(ctx, "alice", "h1")
	if err != nil {
		t.Fatal(err)
	}
	want := map[domain.Date]domain.Entry{
		day(2026, time.January, 5): {Value: 1},
		day(2026, time.January, 6): {Skipped: true},
	}
	if len(entries) != len(want) || entries[day(2026, time.January, 5)] != want[day(2026, time.January, 5)] ||
		entries[day(2026, time.January, 6)] != want[day(2026, time.January, 6)] {
		t.Errorf("entries = %+v, want %+v", entries, want)
	}
}

// schemaOf returns the definitions of the tables and indexes of db, with
// quotes and whitespace normalised, as a table rebuilt and renamed by a
// migration is stored with a quoted name.
func schemaOf(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.Query(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	space := regexp.MustCompile(`\s+`)
	var out []string
	for rows.Next() {
		var def string
		if err := rows.Scan(&def); err != nil {
			t.Fatal(err)
		}
		def = strings.ReplaceAll(def, `"`, "")
		out = append(out, space.ReplaceAllString(def, " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(out, "\n")
}
