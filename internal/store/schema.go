package store

import (
	"context"
	"database/sql"
	"fmt"
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
	created_at    TEXT    NOT NULL,
	updated_at    TEXT    NOT NULL
) STRICT;
CREATE INDEX idx_categories_user ON categories(user_id, position);

CREATE TABLE habits (
	id          TEXT    NOT NULL PRIMARY KEY,
	user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- Deleting a category leaves its habits without one; undoing it puts
	-- them back.
	category_id TEXT    REFERENCES categories(id) ON DELETE SET NULL,
	name        TEXT    NOT NULL CHECK (name <> ''),
	color       TEXT    NOT NULL,
	icon        TEXT    NOT NULL DEFAULT '',
	kind        TEXT    NOT NULL CHECK (kind IN ('check', 'count', 'time', 'distance')),
	step_value  INTEGER NOT NULL CHECK (step_value > 0),
	unit        TEXT    NOT NULL DEFAULT '',
	position    INTEGER NOT NULL DEFAULT 0,
	archived_at TEXT,
	created_at  TEXT    NOT NULL,
	updated_at  TEXT    NOT NULL,
	-- Counts the changes of the habit's schedules and entries, kept by the
	-- triggers below: statistics computed at one revision stay valid until
	-- the next.
	revision    INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_habits_user ON habits(user_id, position);
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
` + revisionTriggers + changesTable

// revisionTriggers count every change of a habit's schedules and entries in
// its revision, whatever makes it: a write, an undo or a deletion.
const revisionTriggers = `
CREATE TRIGGER schedules_insert_revise AFTER INSERT ON habit_schedules
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = NEW.habit_id; END;
CREATE TRIGGER schedules_update_revise AFTER UPDATE ON habit_schedules
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = NEW.habit_id; END;
CREATE TRIGGER schedules_delete_revise AFTER DELETE ON habit_schedules
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = OLD.habit_id; END;
CREATE TRIGGER entries_insert_revise AFTER INSERT ON entries
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = NEW.habit_id; END;
CREATE TRIGGER entries_update_revise AFTER UPDATE ON entries
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = NEW.habit_id; END;
CREATE TRIGGER entries_delete_revise AFTER DELETE ON entries
BEGIN UPDATE habits SET revision = revision + 1 WHERE id = OLD.habit_id; END;
`

// changesTable holds the undo steps (see changes.go): the rows a change
// replaced and wrote, as JSON. undone_at is set while a step is undone. IDs
// are never reused (AUTOINCREMENT), as a client may still offer to undo a
// step that has been dropped since.
const changesTable = `
CREATE TABLE changes (
	id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	label      TEXT    NOT NULL,
	params     TEXT    NOT NULL CHECK (json_valid(params)),
	diff       TEXT    NOT NULL CHECK (json_valid(diff)),
	undone_at  TEXT,
	created_at TEXT    NOT NULL
) STRICT;
CREATE INDEX idx_changes_user ON changes(user_id, id);
`

// oldestVersion is the oldest schema version this binary can migrate. Older
// databases have to be opened with an older release first.
const oldestVersion = 3

// migrations change the schema of an existing database, keyed by the version
// they start from. Add new ones for the next version and make the same change
// to schema, which creates new databases.
var migrations = map[int]string{
	// 3 → 4: undo steps replace soft deletion. Deleted habits and categories
	// are removed; habits of a deleted category lose it. Habits count their
	// revisions.
	3: `
DELETE FROM habits WHERE deleted_at IS NOT NULL;
DELETE FROM categories WHERE deleted_at IS NOT NULL;
DROP INDEX idx_habits_user;
DROP INDEX idx_categories_user;
ALTER TABLE habits DROP COLUMN deleted_at;
ALTER TABLE categories DROP COLUMN deleted_at;
CREATE INDEX idx_habits_user ON habits(user_id, position);
CREATE INDEX idx_categories_user ON categories(user_id, position);
ALTER TABLE habits ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
` + revisionTriggers + changesTable,
}

// latestVersion is the schema version of schema.
const latestVersion = 4

// migrate creates the schema in an empty database, or applies the migrations
// an existing one is missing, each in its own transaction.
func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}

	switch {
	case version == 0:
		return s.inTx(ctx, "creating the schema", func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, schema); err != nil {
				return fmt.Errorf("creating the schema: %w", err)
			}
			return setVersion(ctx, tx, latestVersion)
		})
	case version > latestVersion:
		return fmt.Errorf("database has schema version %d, this binary only knows %d — probably an older version of the application", version, latestVersion)
	case version < oldestVersion:
		return fmt.Errorf("database has schema version %d, this binary migrates from %d on — open it with an older release first", version, oldestVersion)
	}
	for v := version; v < latestVersion; v++ {
		if err := s.inTx(ctx, "migrating", func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, migrations[v]); err != nil {
				return fmt.Errorf("migration from version %d: %w", v, err)
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
