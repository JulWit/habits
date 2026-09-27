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

CREATE TABLE backgrounds (
	user_id    TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
	bytes      BLOB NOT NULL,
	etag       TEXT NOT NULL,
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

// schemaVersion is the user_version of a database created from schema. It
// lies above every legacy version.
const schemaVersion = 1000

// migrations change schema; migration i brings a database to version
// schemaVersion+i+1. Do not change released migrations, append new ones, and
// keep schema describing a new database, so both paths end up alike.
var migrations = []string{
	// The uploaded background image is no longer offered.
	`DROP TABLE backgrounds;`,
}

// migrate brings the database to the current version: a new database gets
// schema, an old one runs its missing legacy migrations and is converted, and
// then the migrations after schema are applied, each in its own transaction.
func (s *Store) migrate(ctx context.Context) error {
	version, err := s.version(ctx)
	if err != nil {
		return err
	}
	latest := schemaVersion + len(migrations)
	switch {
	case version > latest:
		return fmt.Errorf("database has schema version %d, this binary only knows %d — probably an older version of the application", version, latest)
	case version == 0:
		if err := s.inTx(ctx, "creating the schema", func(tx *sql.Tx) error {
			return exec(ctx, tx, schema, setVersion(schemaVersion))
		}); err != nil {
			return err
		}
		version = schemaVersion
	case version <= len(legacyMigrations):
		for i := version; i < len(legacyMigrations); i++ {
			if err := s.inTx(ctx, fmt.Sprintf("legacy migration %d", i+1), func(tx *sql.Tx) error {
				return exec(ctx, tx, legacyMigrations[i], setVersion(i+1))
			}); err != nil {
				return err
			}
		}
		if err := s.convertLegacy(ctx); err != nil {
			return err
		}
		version = schemaVersion
	case version < schemaVersion:
		return fmt.Errorf("database has the unknown schema version %d", version)
	}

	for i := version - schemaVersion; i < len(migrations); i++ {
		if err := s.inTx(ctx, fmt.Sprintf("migration %d", i+1), func(tx *sql.Tx) error {
			return exec(ctx, tx, migrations[i], setVersion(schemaVersion+i+1))
		}); err != nil {
			return err
		}
	}
	return nil
}

// convertLegacy moves a database at the last legacy version into schema: the
// old tables are renamed, schema is created, the rows are copied and the old
// tables dropped. Foreign keys are off meanwhile, since renaming and dropping
// referenced tables would trip them; rows the new constraints would reject
// (entries of vanished habits, a category that no longer exists) are left
// behind, and foreign_key_check confirms the result before it is committed.
func (s *Store) convertLegacy(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return fmt.Errorf("converting the legacy schema: %w", err)
	}
	defer s.db.ExecContext(ctx, "PRAGMA foreign_keys = ON")

	return s.inTx(ctx, "converting the legacy schema", func(tx *sql.Tx) error {
		tables := []string{"user_settings", "backgrounds", "categories", "habits", "habit_schedules", "entries"}
		for _, t := range tables {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE `+t+` RENAME TO legacy_`+t); err != nil {
				return err
			}
		}
		// The old indexes keep their names; drop them before schema reuses
		// the names.
		for _, idx := range []string{"idx_habits_user", "idx_habits_category", "idx_categories_user", "idx_entries_date"} {
			if _, err := tx.ExecContext(ctx, `DROP INDEX IF EXISTS `+idx); err != nil {
				return err
			}
		}
		if err := exec(ctx, tx, schema, `
			INSERT INTO users (id, created_at)
				SELECT user_id, MIN(at) FROM (
					SELECT user_id, created_at AS at FROM legacy_habits
					UNION ALL SELECT user_id, created_at FROM legacy_categories
					UNION ALL SELECT user_id, updated_at FROM legacy_user_settings
					UNION ALL SELECT user_id, updated_at FROM legacy_backgrounds)
				WHERE user_id <> ''
				GROUP BY user_id;
			INSERT INTO user_settings SELECT user_id, data, updated_at FROM legacy_user_settings;
			INSERT INTO backgrounds SELECT user_id, mime, bytes, etag, updated_at FROM legacy_backgrounds;
			INSERT INTO categories (id, user_id, name, icon, color, show_progress, position,
					deleted_at, created_at, updated_at)
				SELECT id, user_id, name, icon, color, show_progress <> 0, position,
					deleted_at, created_at, updated_at
				FROM legacy_categories;
			INSERT INTO habits (id, user_id, category_id, name, color, icon, kind, step_value, unit,
					position, archived_at, deleted_at, created_at, updated_at)
				SELECT id, user_id,
					CASE WHEN category_id IN (SELECT id FROM categories) THEN category_id END,
					name, color, icon, kind, MAX(step_value, 1), unit,
					position, archived_at, deleted_at, created_at, updated_at
				FROM legacy_habits;
			INSERT INTO habit_schedules SELECT * FROM legacy_habit_schedules
				WHERE habit_id IN (SELECT id FROM habits);
			INSERT INTO entries SELECT habit_id, date, value, updated_at FROM legacy_entries
				WHERE value > 0 AND habit_id IN (SELECT id FROM habits);
		`); err != nil {
			return err
		}
		for _, t := range tables {
			if _, err := tx.ExecContext(ctx, `DROP TABLE legacy_`+t); err != nil {
				return err
			}
		}
		if err := foreignKeyCheck(ctx, tx); err != nil {
			return err
		}
		return exec(ctx, tx, setVersion(schemaVersion))
	})
}

// foreignKeyCheck returns an error if any row breaks a foreign key.
func foreignKeyCheck(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		var table string
		var rowid sql.NullInt64
		var parent string
		var fkid int
		if err := rows.Scan(&table, &rowid, &parent, &fkid); err != nil {
			return err
		}
		return fmt.Errorf("a row of %s refers to a missing row of %s", table, parent)
	}
	return rows.Err()
}

// version returns the database's user_version.
func (s *Store) version(ctx context.Context) (int, error) {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("reading schema version: %w", err)
	}
	return version, nil
}

// setVersion returns the statement that sets user_version. PRAGMA does not
// support placeholders.
func setVersion(v int) string { return fmt.Sprintf("PRAGMA user_version = %d", v) }

// exec runs the statements in order.
func exec(ctx context.Context, tx *sql.Tx, statements ...string) error {
	for _, stmt := range statements {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
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
func ensureUser(ctx context.Context, q execer, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("no user")
	}
	if _, err := q.ExecContext(ctx,
		`INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
		userID, formatTime(time.Now())); err != nil {
		return fmt.Errorf("recording user: %w", err)
	}
	return nil
}
