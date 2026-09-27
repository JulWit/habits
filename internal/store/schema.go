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
	habit_id            TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	valid_from          TEXT    NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	target_value        INTEGER NOT NULL CHECK (target_value > 0),
	freq_kind           TEXT    NOT NULL CHECK (freq_kind IN ('daily', 'times_per_week', 'weekdays', 'custom_interval')),
	freq_times_per_week INTEGER NOT NULL DEFAULT 0 CHECK (freq_times_per_week BETWEEN 0 AND 7),
	freq_weekdays       INTEGER NOT NULL DEFAULT 0 CHECK (freq_weekdays BETWEEN 0 AND 127),
	freq_interval_days  INTEGER NOT NULL DEFAULT 0 CHECK (freq_interval_days >= 0),
	freq_week_interval  INTEGER NOT NULL DEFAULT 0 CHECK (freq_week_interval >= 0),
	freq_week_of_month  INTEGER NOT NULL DEFAULT 0 CHECK (freq_week_of_month BETWEEN -1 AND 4),
	freq_anchor_date    TEXT    NOT NULL DEFAULT '',
	PRIMARY KEY (habit_id, valid_from)
) STRICT, WITHOUT ROWID;

-- Days without a value have no row.
CREATE TABLE entries (
	habit_id   TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
	date       TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	value      INTEGER NOT NULL CHECK (value > 0),
	updated_at TEXT    NOT NULL,
	PRIMARY KEY (habit_id, date)
) STRICT, WITHOUT ROWID;
`

// migrations change the schema of an existing database, oldest first. Append
// new ones, never change released ones, and make the same change to schema,
// which creates new databases.
var migrations = []string{}

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
