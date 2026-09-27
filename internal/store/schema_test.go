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

// schemaOf returns the normalised definitions of the tables and indexes.
func schemaOf(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query(`SELECT name, sql FROM sqlite_schema
		WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	space := regexp.MustCompile(`\s+`)
	out := map[string]string{}
	for rows.Next() {
		var name, def string
		if err := rows.Scan(&name, &def); err != nil {
			t.Fatal(err)
		}
		// A renamed table is stored with its name quoted.
		def = strings.ReplaceAll(def, `"`, "")
		out[name] = space.ReplaceAllString(def, " ")
	}
	return out
}

// A converted legacy database has exactly the schema of a new one.
func TestLegacyConversionMatchesTheSchema(t *testing.T) {
	ctx := context.Background()
	fresh := openTestStore(t)

	path := filepath.Join(t.TempDir(), "old.db")
	// Before the last legacy migration, with data in every table.
	db := openAtMigration(t, path, "WHEN '#dc2626' THEN 'red'")
	now := formatTime(time.Now())
	for _, stmt := range []string{
		`INSERT INTO categories (id, user_id, name, color, created_at, updated_at)
		 VALUES ('c1', 'alice', 'Sport', '', '` + now + `', '` + now + `')`,
		`INSERT INTO habits (id, user_id, name, color, kind, step_value, category_id, created_at, updated_at)
		 VALUES ('h1', 'alice', 'Run', '#2563eb', 'distance', 500, 'c1', '` + now + `', '` + now + `'),
		        ('h2', 'bob', 'Read', '#2563eb', 'check', 0, 'gone', '` + now + `', '` + now + `')`,
		`INSERT INTO habit_schedules (habit_id, valid_from, target_value, freq_kind)
		 VALUES ('h1', '2026-01-01', 5000, 'daily'), ('h2', '2026-01-01', 1, 'daily')`,
		`INSERT INTO entries (habit_id, date, value, updated_at)
		 VALUES ('h1', '2026-02-01', 5200, ''), ('h1', '2026-02-02', 0, '')`,
		`INSERT INTO user_settings (user_id, data, updated_at) VALUES ('carol', '{}', '')`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	old, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer old.Close()

	want, got := schemaOf(t, fresh.db), schemaOf(t, old.db)
	for name, def := range want {
		if got[name] != def {
			t.Errorf("%s:\n got  %s\n want %s", name, got[name], def)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("left over after the conversion: %s", name)
		}
	}
	if v, _ := old.version(ctx); v != schemaVersion {
		t.Errorf("version = %d, want %d", v, schemaVersion)
	}

	// Every owner became a user; the rows came along, cleaned where needed.
	var users int
	old.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	if users != 3 {
		t.Errorf("%d users, want alice, bob and carol", users)
	}
	h2, err := old.GetHabit(ctx, "bob", "h2")
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if h2.CategoryID != "" || h2.StepValue != 1 {
		t.Errorf("h2: category %q, step %d; want no category and step 1", h2.CategoryID, h2.StepValue)
	}
	entries, err := old.EntriesForHabit(ctx, "alice", "h1")
	if err != nil || len(entries) != 1 {
		t.Errorf("entries = %v (%v), want only the non-zero one", entries, err)
	}
}

// The schema rejects values the application never writes, and removing a user
// removes their data.
func TestSchemaConstraints(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 10))
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.March, 1), 10); err != nil {
		t.Fatal(err)
	}

	for name, stmt := range map[string]string{
		"unknown kind":    `UPDATE habits SET kind = 'weight'`,
		"zero value":      `UPDATE entries SET value = 0`,
		"text as number":  `UPDATE habits SET position = 'first'`,
		"malformed date":  `UPDATE entries SET date = '1.3.2026'`,
		"unknown user":    `UPDATE habits SET user_id = 'mallory'`,
		"invalid json":    `INSERT INTO user_settings VALUES ('alice', '{', '')`,
		"unknown freq":    `UPDATE habit_schedules SET freq_kind = 'hourly'`,
		"negative target": `UPDATE habit_schedules SET target_value = -1`,
	} {
		if _, err := st.db.Exec(stmt); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	if _, err := st.db.Exec(`DELETE FROM users WHERE id = 'alice'`); err != nil {
		t.Fatalf("deleting the user: %v", err)
	}
	for _, table := range []string{"habits", "habit_schedules", "entries"} {
		var n int
		st.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n)
		if n != 0 {
			t.Errorf("%s: %d rows left after deleting the user", table, n)
		}
	}
}
