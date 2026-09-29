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

// schemaV3 is the schema of version 3, the oldest one this binary migrates,
// for testing the migration from it. It must not change.
const schemaV3 = `
CREATE TABLE users (
	id         TEXT NOT NULL PRIMARY KEY CHECK (id <> ''),
	created_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_settings (
	user_id    TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	data       TEXT NOT NULL CHECK (json_valid(data)),
	updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE categories (
	id            TEXT    NOT NULL PRIMARY KEY,
	user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name          TEXT    NOT NULL CHECK (name <> ''),
	icon          TEXT    NOT NULL DEFAULT '',
	color         TEXT    NOT NULL DEFAULT '',
	show_progress INTEGER NOT NULL DEFAULT 0 CHECK (show_progress IN (0, 1)),
	position      INTEGER NOT NULL DEFAULT 0,
	deleted_at    TEXT,
	created_at    TEXT    NOT NULL,
	updated_at    TEXT    NOT NULL
) STRICT;
CREATE INDEX idx_categories_user ON categories(user_id, deleted_at, position);

CREATE TABLE habits (
	id          TEXT    NOT NULL PRIMARY KEY,
	user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	category_id TEXT    REFERENCES categories(id) ON DELETE SET NULL,
	name        TEXT    NOT NULL CHECK (name <> ''),
	color       TEXT    NOT NULL,
	icon        TEXT    NOT NULL DEFAULT '',
	kind        TEXT    NOT NULL CHECK (kind IN ('check', 'count', 'time', 'distance')),
	step_value  INTEGER NOT NULL CHECK (step_value > 0),
	unit        TEXT    NOT NULL DEFAULT '',
	position    INTEGER NOT NULL DEFAULT 0,
	archived_at TEXT,
	deleted_at  TEXT,
	created_at  TEXT    NOT NULL,
	updated_at  TEXT    NOT NULL
) STRICT;
CREATE INDEX idx_habits_user ON habits(user_id, deleted_at, position);
CREATE INDEX idx_habits_category ON habits(category_id);

CREATE TABLE habit_schedules (
	habit_id             TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	valid_from           TEXT    NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	target_value         INTEGER NOT NULL CHECK (target_value >= 0),
	target_type          TEXT    NOT NULL DEFAULT 'at_least' CHECK (target_type IN ('at_least', 'at_most')),
	freq_kind            TEXT    NOT NULL CHECK (freq_kind IN ('daily', 'times_per_week', 'times_per_month', 'weekdays', 'custom_interval')),
	freq_times_per_week  INTEGER NOT NULL DEFAULT 0 CHECK (freq_times_per_week BETWEEN 0 AND 7),
	freq_times_per_month INTEGER NOT NULL DEFAULT 0 CHECK (freq_times_per_month BETWEEN 0 AND 28),
	freq_weekdays        INTEGER NOT NULL DEFAULT 0 CHECK (freq_weekdays BETWEEN 0 AND 127),
	freq_interval_days   INTEGER NOT NULL DEFAULT 0 CHECK (freq_interval_days >= 0),
	freq_week_interval   INTEGER NOT NULL DEFAULT 0 CHECK (freq_week_interval >= 0),
	freq_week_of_month   INTEGER NOT NULL DEFAULT 0 CHECK (freq_week_of_month BETWEEN -1 AND 4),
	freq_anchor_date     TEXT    NOT NULL DEFAULT '',
	PRIMARY KEY (habit_id, valid_from),
	CHECK (target_value > 0 OR target_type = 'at_most')
) STRICT, WITHOUT ROWID;

CREATE TABLE entries (
	habit_id   TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	date       TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	value      INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
	skipped    INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
	updated_at TEXT    NOT NULL,
	PRIMARY KEY (habit_id, date),
	CHECK (skipped = 0 OR value = 0),
	CHECK (value > 0 OR skipped = 1)
) STRICT, WITHOUT ROWID;
`

// oldDatabase creates a database at path with the statements, as an older
// release left it.
func oldDatabase(t *testing.T, path string, stmts ...string) {
	t.Helper()
	old, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	for _, stmt := range stmts {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("setting up the old database: %v", err)
		}
	}
}

// A database of version 3 with data is migrated to the schema a new database
// gets. It keeps its data, except what was deleted: deleted habits go, and
// habits of a deleted category lose it.
func TestMigrationFromVersion3(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v3.db")
	const stamp = "2026-01-01T00:00:00.000000000Z"
	oldDatabase(t, path,
		schemaV3,
		`PRAGMA user_version = 3`,
		`INSERT INTO users VALUES ('alice', '`+stamp+`')`,
		`INSERT INTO categories (id, user_id, name, deleted_at, created_at, updated_at)
		 VALUES ('gone', 'alice', 'Old', '`+stamp+`', '`+stamp+`', '`+stamp+`')`,
		`INSERT INTO habits (id, user_id, category_id, name, color, kind, step_value, created_at, updated_at)
		 VALUES ('h1', 'alice', 'gone', 'Water', 'sky', 'count', 10, '`+stamp+`', '`+stamp+`')`,
		`INSERT INTO habits (id, user_id, name, color, kind, step_value, deleted_at, created_at, updated_at)
		 VALUES ('h2', 'alice', 'Deleted', 'sky', 'check', 1, '`+stamp+`', '`+stamp+`', '`+stamp+`')`,
		`INSERT INTO habit_schedules (habit_id, valid_from, target_value, freq_kind, freq_times_per_week)
		 VALUES ('h1', '2026-01-01', 80, 'times_per_week', 3), ('h2', '2026-01-01', 1, 'daily', 0)`,
		`INSERT INTO entries (habit_id, date, value, updated_at) VALUES
		 ('h1', '2026-01-05', 40, '`+stamp+`'), ('h2', '2026-01-05', 1, '`+stamp+`')`,
	)

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer st.Close()

	habits := read(t, st, "alice", func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context(), true) })
	if len(habits) != 1 || habits[0].ID != "h1" {
		t.Fatalf("habits = %+v, want only h1", habits)
	}
	h := habits[0]
	want := domain.Schedule{
		From: day(2026, time.January, 1), TargetValue: 80, TargetType: domain.TargetAtLeast,
		Frequency: domain.Frequency{Kind: domain.FreqTimesPerWeek, TimesPerWeek: 3},
	}
	if len(h.Schedules) != 1 || h.Schedules[0] != want {
		t.Errorf("schedules = %+v, want %+v", h.Schedules, want)
	}
	if h.CategoryID != "" {
		t.Errorf("category = %q, want none", h.CategoryID)
	}
	if got := entriesOf(t, st, "alice", "h1")[day(2026, time.January, 5)]; got != (domain.Entry{Value: 40}) {
		t.Errorf("entry = %+v, want the value 40", got)
	}
	var orphans int
	st.db.QueryRow(`SELECT COUNT(*) FROM entries WHERE habit_id = 'h2'`).Scan(&orphans)
	if orphans != 0 {
		t.Errorf("%d entries of the deleted habit left", orphans)
	}

	fresh := openTestStore(t)
	if got, want := schemaOf(t, st.db), schemaOf(t, fresh.db); got != want {
		t.Errorf("migrated schema differs from a new one:\n%s\nwant:\n%s", got, want)
	}
	var version int
	st.db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != latestVersion {
		t.Errorf("user_version = %d, want %d", version, latestVersion)
	}
}

// An undo step recorded in version 4, whose habit rows still carry the
// revision, can be undone after the migration: deleting a habit is undone,
// and the habit comes back with its schedule.
func TestMigrationFromVersion4KeepsUndoSteps(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v4.db")
	const stamp = "2026-01-01T00:00:00.000000000Z"
	habit := `{"id":"h1","user_id":"alice","category_id":null,"name":"Water","color":"sky","icon":"",
		"kind":"count","step_value":10,"unit":"","position":1,"archived_at":null,
		"created_at":"` + stamp + `","updated_at":"` + stamp + `","revision":3}`
	schedule := `{"habit_id":"h1","valid_from":"2026-01-01","target_value":80,"target_type":"at_least",
		"freq_kind":"daily","freq_times_per_week":0,"freq_times_per_month":0,"freq_weekdays":0,
		"freq_interval_days":0,"freq_week_interval":0,"freq_week_of_month":0,"freq_anchor_date":""}`
	diff := `[{"table":"habits","before":` + habit + `,"after":null},
		{"table":"habit_schedules","before":` + schedule + `,"after":null}]`
	oldDatabase(t, path,
		schemaV3,
		migrations[3],
		`PRAGMA user_version = 4`,
		`INSERT INTO users VALUES ('alice', '`+stamp+`')`,
		`INSERT INTO changes (user_id, label, params, diff, created_at)
		 VALUES ('alice', '"{name}" deleted', '{"name":"Water"}', '`+diff+`', '`+stamp+`')`,
	)

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer st.Close()

	if _, err := st.Undo(ctx, "alice", 0); err != nil {
		t.Fatalf("undoing the step of version 4: %v", err)
	}
	h := habitOf(t, st, "alice", "h1")
	if h.Name != "Water" || len(h.Schedules) != 1 || h.Schedules[0].TargetValue != 80 {
		t.Errorf("habit = %+v, want Water with its schedule back", h)
	}

	fresh := openTestStore(t)
	if got, want := schemaOf(t, st.db), schemaOf(t, fresh.db); got != want {
		t.Errorf("migrated schema differs from a new one:\n%s\nwant:\n%s", got, want)
	}
}

// A database older than oldestVersion is refused and left as it is.
func TestTooOldDatabaseIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v2.db")
	oldDatabase(t, path, `CREATE TABLE users (id TEXT)`, `PRAGMA user_version = 2`)
	if st, err := Open(context.Background(), path); err == nil {
		st.Close()
		t.Fatal("a database of version 2 was opened")
	}
}

// schemaOf returns the definitions of the tables and indexes of db, with
// comments, quotes and whitespace normalised, as they differ between a
// table created anew and one changed by ALTER TABLE.
func schemaOf(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.Query(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	comment := regexp.MustCompile(`--[^\n]*`)
	space := regexp.MustCompile(`\s+`)
	var out []string
	for rows.Next() {
		var def string
		if err := rows.Scan(&def); err != nil {
			t.Fatal(err)
		}
		def = comment.ReplaceAllString(def, "")
		def = strings.ReplaceAll(def, `"`, "")
		def = space.ReplaceAllString(def, " ")
		def = strings.ReplaceAll(def, "( ", "(")
		def = strings.ReplaceAll(def, " )", ")")
		def = strings.ReplaceAll(def, " ,", ",")
		out = append(out, def)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(out, "\n")
}
