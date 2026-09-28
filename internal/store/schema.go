package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// schema creates the tables of a new database. Tables are STRICT, so a value
// of the wrong type is an error instead of being stored as it is, and CHECK
// constraints hold the invariants the database can check by itself. Every
// user-owned row hangs off users, so removing a user removes their data.
const schema = `
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
	-- A soft-deleted category keeps its habits, which show as uncategorised
	-- until it is restored; purging it detaches them.
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
	-- A limit may be 0 ("none at all"), a target not.
	CHECK (target_value > 0 OR target_type = 'at_most')
) STRICT, WITHOUT ROWID;

-- Days with nothing recorded have no row. A skipped day has no value.
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

// migrations change the schema of an existing database, oldest first. Append
// new ones, never change released ones, and make the same change to schema,
// which creates new databases.
var migrations = []string{
	// 2: limits (target_type, a limit may be 0), times per month, and
	// skipped days and notes in entries. SQLite cannot change a CHECK
	// constraint, so both tables are rebuilt.
	`
CREATE TABLE habit_schedules_new (
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
	-- A limit may be 0 ("none at all"), a target not.
	CHECK (target_value > 0 OR target_type = 'at_most')
) STRICT, WITHOUT ROWID;

INSERT INTO habit_schedules_new (habit_id, valid_from, target_value,
	freq_kind, freq_times_per_week, freq_weekdays, freq_interval_days,
	freq_week_interval, freq_week_of_month, freq_anchor_date)
SELECT habit_id, valid_from, target_value,
	freq_kind, freq_times_per_week, freq_weekdays, freq_interval_days,
	freq_week_interval, freq_week_of_month, freq_anchor_date
FROM habit_schedules;
DROP TABLE habit_schedules;
ALTER TABLE habit_schedules_new RENAME TO habit_schedules;

CREATE TABLE entries_new (
	habit_id   TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	date       TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	value      INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
	skipped    INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
	note       TEXT    NOT NULL DEFAULT '',
	updated_at TEXT    NOT NULL,
	PRIMARY KEY (habit_id, date),
	CHECK (skipped = 0 OR value = 0),
	CHECK (value > 0 OR skipped = 1 OR note <> '')
) STRICT, WITHOUT ROWID;

INSERT INTO entries_new (habit_id, date, value, updated_at)
SELECT habit_id, date, value, updated_at FROM entries;
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
`,
	// 3: notes are removed. The note column is part of a CHECK constraint, so
	// entries is rebuilt; days that only held a note have nothing left.
	`
CREATE TABLE entries_new (
	habit_id   TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	date       TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	value      INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
	skipped    INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
	updated_at TEXT    NOT NULL,
	PRIMARY KEY (habit_id, date),
	CHECK (skipped = 0 OR value = 0),
	CHECK (value > 0 OR skipped = 1)
) STRICT, WITHOUT ROWID;

INSERT INTO entries_new (habit_id, date, value, skipped, updated_at)
SELECT habit_id, date, value, skipped, updated_at FROM entries
WHERE value > 0 OR skipped = 1;
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
`,
}

// The user_version of a database is 1 plus the number of migrations applied
// to it; 0 means the database is empty.
func latestVersion() int { return 1 + len(migrations) }

// migrate creates the schema in an empty database, or applies the migrations
// an existing one is missing, each in its own transaction.
func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}
	latest := latestVersion()

	if version == 0 {
		return s.inTx(ctx, "creating the schema", func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, schema); err != nil {
				return err
			}
			return setVersion(ctx, tx, latest)
		})
	}
	if version > latest {
		return fmt.Errorf("database has schema version %d, this binary only knows %d — probably an older version of the application", version, latest)
	}
	for v := version; v < latest; v++ {
		if err := s.inTx(ctx, fmt.Sprintf("migration %d", v), func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, migrations[v-1]); err != nil {
				return err
			}
			return setVersion(ctx, tx, v+1)
		}); err != nil {
			return err
		}
	}
	return nil
}

// setVersion sets the database's user_version. PRAGMA does not support
// placeholders.
func setVersion(ctx context.Context, tx *sql.Tx, version int) error {
	_, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", version))
	return err
}

// inTx runs fn in a transaction and commits it. what describes the work for
// errors.
func (s *Store) inTx(ctx context.Context, what string, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}

// ensureUser records the user on their first write. Every user-owned row
// refers to it.
func ensureUser(ctx context.Context, tx *sql.Tx, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("no user")
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
		userID, formatTime(time.Now())); err != nil {
		return fmt.Errorf("recording user: %w", err)
	}
	return nil
}
