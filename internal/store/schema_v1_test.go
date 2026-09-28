package store

// schemaV1 is the schema of version 1, the first release, for testing the
// migrations from it. It must not change.
const schemaV1 = `CREATE TABLE users (
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
