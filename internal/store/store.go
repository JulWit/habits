// Package store persists the application data in SQLite.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/JulWit/habits/internal/domain"

	_ "modernc.org/sqlite" // pure Go driver, no cgo
)

var (
	// ErrNotFound is returned when a record does not exist for the user.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned when a change conflicts with the stored state.
	ErrConflict = errors.New("conflict")
)

// invalidf returns a validation error with an untranslated message. Messages
// the user can trigger through the UI use domain.Invalid instead.
func invalidf(format string, args ...any) error {
	return domain.Invalid(fmt.Sprintf(format, args...))
}

// execer and queryer are implemented by *sql.DB and *sql.Tx.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Store provides access to the database.
type Store struct {
	db *sql.DB
}

// Open opens the SQLite database at path and applies pending migrations. The
// pool uses a single connection, since SQLite allows only one writer.
func Open(ctx context.Context, path string) (*Store, error) {
	dsn := "file:" + url.PathEscape(path) + "?" + url.Values{
		"_pragma": {
			"journal_mode(WAL)",
			"busy_timeout(5000)",
			"foreign_keys(1)",
			"synchronous(NORMAL)",
		},
	}.Encode()

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening the database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("reaching the database: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// migrations are applied in order; PRAGMA user_version stores how many have
// run. Do not change released migrations, append new ones.
var migrations = []string{
	`CREATE TABLE habits (
		id                  TEXT    PRIMARY KEY,
		user_id             TEXT    NOT NULL,
		name                TEXT    NOT NULL,
		notes               TEXT    NOT NULL DEFAULT '',
		color               TEXT    NOT NULL,
		kind                TEXT    NOT NULL,
		target_value        INTEGER NOT NULL DEFAULT 1,
		unit                TEXT    NOT NULL DEFAULT '',
		freq_kind           TEXT    NOT NULL,
		freq_times_per_week INTEGER NOT NULL DEFAULT 0,
		freq_weekdays       INTEGER NOT NULL DEFAULT 0,
		freq_interval_days  INTEGER NOT NULL DEFAULT 0,
		freq_anchor_date    TEXT    NOT NULL DEFAULT '',
		position            INTEGER NOT NULL DEFAULT 0,
		archived_at         TEXT,
		deleted_at          TEXT,
		created_at          TEXT    NOT NULL,
		updated_at          TEXT    NOT NULL
	);
	CREATE INDEX idx_habits_user ON habits(user_id, deleted_at, position);

	CREATE TABLE entries (
		habit_id   TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
		date       TEXT    NOT NULL,
		value      INTEGER NOT NULL,
		updated_at TEXT    NOT NULL,
		PRIMARY KEY (habit_id, date)
	) WITHOUT ROWID;
	CREATE INDEX idx_entries_date ON entries(date);

	CREATE TABLE user_settings (
		user_id    TEXT PRIMARY KEY,
		theme      TEXT NOT NULL DEFAULT 'system',
		updated_at TEXT NOT NULL
	);`,

	// Remove the "system" theme; the default becomes "light".
	`CREATE TABLE user_settings_v2 (
		user_id    TEXT PRIMARY KEY,
		theme      TEXT NOT NULL DEFAULT 'light',
		updated_at TEXT NOT NULL
	);
	INSERT INTO user_settings_v2 (user_id, theme, updated_at)
		SELECT user_id,
		       CASE WHEN theme IN ('light', 'dark') THEN theme ELSE 'light' END,
		       updated_at
		FROM user_settings;
	DROP TABLE user_settings;
	ALTER TABLE user_settings_v2 RENAME TO user_settings;`,

	// Add categories.
	`CREATE TABLE categories (
		id         TEXT    PRIMARY KEY,
		user_id    TEXT    NOT NULL,
		name       TEXT    NOT NULL,
		position   INTEGER NOT NULL DEFAULT 0,
		deleted_at TEXT,
		created_at TEXT    NOT NULL,
		updated_at TEXT    NOT NULL
	);
	CREATE INDEX idx_categories_user ON categories(user_id, deleted_at, position);

	ALTER TABLE habits ADD COLUMN category_id TEXT
		REFERENCES categories(id) ON DELETE SET NULL;
	CREATE INDEX idx_habits_category ON habits(category_id);`,

	// Number of day columns on the overview; 0 fills the available width.
	`ALTER TABLE user_settings ADD COLUMN overview_days INTEGER NOT NULL DEFAULT 0;`,

	// Whether archived habits are shown.
	`ALTER TABLE user_settings ADD COLUMN show_archived INTEGER NOT NULL DEFAULT 0;`,

	// Map habit colours from the old palette to the new one.
	`UPDATE habits SET color = CASE color
		WHEN '#e05252' THEN '#dc2626'
		WHEN '#e07b52' THEN '#ea580c'
		WHEN '#e0a852' THEN '#cc7006'
		WHEN '#c9c14a' THEN '#cc7006'
		WHEN '#7cb342' THEN '#65a30d'
		WHEN '#43a047' THEN '#16a34a'
		WHEN '#26a69a' THEN '#0d9488'
		WHEN '#29b6d6' THEN '#0284c7'
		WHEN '#4285f4' THEN '#2563eb'
		WHEN '#5c6bc0' THEN '#4f46e5'
		WHEN '#8e5ec2' THEN '#7c3aed'
		WHEN '#c2569e' THEN '#db2777'
		WHEN '#8d6e63' THEN '#64748b'
		WHEN '#78909c' THEN '#64748b'
		ELSE color
	END;`,

	// Remove habit notes.
	`ALTER TABLE habits DROP COLUMN notes;`,

	// Rename the habit kinds.
	`UPDATE habits SET kind = CASE kind
		WHEN 'bool' THEN 'check'
		WHEN 'counter' THEN 'count'
		WHEN 'duration' THEN 'time'
		ELSE kind
	END;`,

	// Replace the 30-day overview option with 28 days.
	`UPDATE user_settings SET overview_days = 28 WHERE overview_days = 30;`,

	// Replace amber with yellow in the palette.
	`UPDATE habits SET color = '#eab308' WHERE color = '#cc7006';`,

	// Font setting.
	`ALTER TABLE user_settings ADD COLUMN font TEXT NOT NULL DEFAULT 'inter';`,

	// Reorder mode setting.
	`ALTER TABLE user_settings ADD COLUMN reorder_mode TEXT NOT NULL DEFAULT 'drag';`,

	// Step per habit, initialised with the previous step of each kind.
	`ALTER TABLE habits ADD COLUMN step_value INTEGER NOT NULL DEFAULT 1;
	 UPDATE habits SET step_value = CASE kind
		WHEN 'time' THEN 5
		WHEN 'distance' THEN 500
		ELSE 1
	END;`,

	// Store counts and times in tenths to allow one decimal place.
	`UPDATE entries SET value = value * 10
	 WHERE habit_id IN (SELECT id FROM habits WHERE kind IN ('count', 'time'));
	 UPDATE habits SET target_value = target_value * 10, step_value = step_value * 10
	 WHERE kind IN ('count', 'time');`,

	`ALTER TABLE user_settings ADD COLUMN pattern TEXT NOT NULL DEFAULT 'none';`,

	`ALTER TABLE user_settings ADD COLUMN align_weeks INTEGER NOT NULL DEFAULT 0;`,

	`ALTER TABLE user_settings ADD COLUMN background TEXT NOT NULL DEFAULT 'default';`,

	// Remove the background colour setting.
	`ALTER TABLE user_settings DROP COLUMN background;`,

	`ALTER TABLE user_settings ADD COLUMN band_color TEXT NOT NULL DEFAULT 'neutral';`,

	// Background image with dimming and blur; the image is stored as a blob.
	`ALTER TABLE user_settings ADD COLUMN bg_dim INTEGER NOT NULL DEFAULT 55;
	 ALTER TABLE user_settings ADD COLUMN bg_blur INTEGER NOT NULL DEFAULT 0;
	 CREATE TABLE backgrounds (
		user_id    TEXT PRIMARY KEY,
		mime       TEXT NOT NULL,
		bytes      BLOB NOT NULL,
		etag       TEXT NOT NULL,
		updated_at TEXT NOT NULL
	 );`,

	// Convert the background blur from pixels (max. 40) to percent.
	`UPDATE user_settings SET bg_blur = MIN(100, CAST(bg_blur * 2.5 AS INTEGER));`,

	// Opacity and blur of surfaces over a background image.
	`ALTER TABLE user_settings ADD COLUMN surface_opacity INTEGER NOT NULL DEFAULT 88;
	 ALTER TABLE user_settings ADD COLUMN surface_blur INTEGER NOT NULL DEFAULT 30;`,

	// Opacity of the today highlight.
	`ALTER TABLE user_settings ADD COLUMN band_opacity INTEGER NOT NULL DEFAULT 100;`,

	// Density setting.
	`ALTER TABLE user_settings ADD COLUMN density TEXT NOT NULL DEFAULT 'standard';`,

	// Whether the today band is shown.
	`ALTER TABLE user_settings ADD COLUMN show_band INTEGER NOT NULL DEFAULT 1;`,

	// Map colours of the extended palette back to the original twelve.
	`UPDATE habits SET color = CASE color
		WHEN '#ff3b30' THEN '#dc2626'
		WHEN '#ff6b6b' THEN '#dc2626'
		WHEN '#c0392b' THEN '#dc2626'
		WHEN '#ff375f' THEN '#db2777'
		WHEN '#ff2d92' THEN '#db2777'
		WHEN '#e91e8c' THEN '#db2777'
		WHEN '#ff6eb4' THEN '#db2777'
		WHEN '#ff9500' THEN '#ea580c'
		WHEN '#ff6d00' THEN '#ea580c'
		WHEN '#ff8c42' THEN '#ea580c'
		WHEN '#e67e22' THEN '#ea580c'
		WHEN '#a0522d' THEN '#ea580c'
		WHEN '#ffcc00' THEN '#eab308'
		WHEN '#ffd60a' THEN '#eab308'
		WHEN '#f4d03f' THEN '#eab308'
		WHEN '#8b6914' THEN '#eab308'
		WHEN '#a8e063' THEN '#65a30d'
		WHEN '#7ed321' THEN '#65a30d'
		WHEN '#30d158' THEN '#16a34a'
		WHEN '#34c759' THEN '#16a34a'
		WHEN '#00c853' THEN '#16a34a'
		WHEN '#2ecc71' THEN '#16a34a'
		WHEN '#1abc9c' THEN '#0d9488'
		WHEN '#4ecdc4' THEN '#0d9488'
		WHEN '#26c6da' THEN '#0d9488'
		WHEN '#00bcd4' THEN '#0d9488'
		WHEN '#006689' THEN '#0284c7'
		WHEN '#5ac8fa' THEN '#0284c7'
		WHEN '#2196f3' THEN '#0284c7'
		WHEN '#3498db' THEN '#0284c7'
		WHEN '#0a84ff' THEN '#2563eb'
		WHEN '#007aff' THEN '#2563eb'
		WHEN '#5856d6' THEN '#4f46e5'
		WHEN '#9b59b6' THEN '#7c3aed'
		WHEN '#6c3483' THEN '#7c3aed'
		WHEN '#bf5af2' THEN '#7c3aed'
		WHEN '#8e8e93' THEN '#64748b'
		WHEN '#636366' THEN '#64748b'
		WHEN '#48484a' THEN '#64748b'
		WHEN '#ffffff' THEN '#64748b'
		WHEN '#1c1c1e' THEN '#64748b'
		ELSE color
	END;
	UPDATE user_settings SET band_color = CASE band_color
		WHEN '#ff3b30' THEN '#dc2626'
		WHEN '#ff6b6b' THEN '#dc2626'
		WHEN '#c0392b' THEN '#dc2626'
		WHEN '#ff375f' THEN '#db2777'
		WHEN '#ff2d92' THEN '#db2777'
		WHEN '#e91e8c' THEN '#db2777'
		WHEN '#ff6eb4' THEN '#db2777'
		WHEN '#ff9500' THEN '#ea580c'
		WHEN '#ff6d00' THEN '#ea580c'
		WHEN '#ff8c42' THEN '#ea580c'
		WHEN '#e67e22' THEN '#ea580c'
		WHEN '#a0522d' THEN '#ea580c'
		WHEN '#ffcc00' THEN '#eab308'
		WHEN '#ffd60a' THEN '#eab308'
		WHEN '#f4d03f' THEN '#eab308'
		WHEN '#8b6914' THEN '#eab308'
		WHEN '#a8e063' THEN '#65a30d'
		WHEN '#7ed321' THEN '#65a30d'
		WHEN '#30d158' THEN '#16a34a'
		WHEN '#34c759' THEN '#16a34a'
		WHEN '#00c853' THEN '#16a34a'
		WHEN '#2ecc71' THEN '#16a34a'
		WHEN '#1abc9c' THEN '#0d9488'
		WHEN '#4ecdc4' THEN '#0d9488'
		WHEN '#26c6da' THEN '#0d9488'
		WHEN '#00bcd4' THEN '#0d9488'
		WHEN '#006689' THEN '#0284c7'
		WHEN '#5ac8fa' THEN '#0284c7'
		WHEN '#2196f3' THEN '#0284c7'
		WHEN '#3498db' THEN '#0284c7'
		WHEN '#0a84ff' THEN '#2563eb'
		WHEN '#007aff' THEN '#2563eb'
		WHEN '#5856d6' THEN '#4f46e5'
		WHEN '#9b59b6' THEN '#7c3aed'
		WHEN '#6c3483' THEN '#7c3aed'
		WHEN '#bf5af2' THEN '#7c3aed'
		WHEN '#8e8e93' THEN '#64748b'
		WHEN '#636366' THEN '#64748b'
		WHEN '#48484a' THEN '#64748b'
		WHEN '#ffffff' THEN '#64748b'
		WHEN '#1c1c1e' THEN '#64748b'
		ELSE band_color
	END;`,

	// Separate opacity for the today band, initialised with band_opacity.
	`ALTER TABLE user_settings ADD COLUMN band_fill_opacity INTEGER NOT NULL DEFAULT 100;
	 UPDATE user_settings SET band_fill_opacity = band_opacity;`,

	// Habit icon; "" means none.
	`ALTER TABLE habits ADD COLUMN icon TEXT NOT NULL DEFAULT '';`,

	// Category icon; "" means none.
	`ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';`,

	// Whether a category heading shows today's progress.
	`ALTER TABLE categories ADD COLUMN show_progress INTEGER NOT NULL DEFAULT 1;`,

	// Turn category progress off by default. The column default stays 1; every
	// insert sets the value explicitly.
	`UPDATE categories SET show_progress = 0;`,

	// Category icon colour; "" means the default colour.
	`ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '';`,

	// Rename frequency "every_n_days" to "custom_interval".
	`UPDATE habits SET freq_kind = 'custom_interval' WHERE freq_kind = 'every_n_days';`,

	// Week interval and week of month for weekday schedules.
	`ALTER TABLE habits ADD COLUMN freq_week_interval INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE habits ADD COLUMN freq_week_of_month INTEGER NOT NULL DEFAULT 0;
	 UPDATE habits SET freq_week_interval = 1 WHERE freq_kind = 'weekdays';`,

	// Language ("system": browser language) and time zone ("": HABITS_TZ).
	`ALTER TABLE user_settings ADD COLUMN language TEXT NOT NULL DEFAULT 'system';
	 ALTER TABLE user_settings ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';`,

	// Versioned schedules: target and frequency move into their own table, one
	// row per version. Every habit starts with its current schedule from its
	// creation day on.
	`CREATE TABLE habit_schedules (
		habit_id            TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
		valid_from          TEXT    NOT NULL,
		target_value        INTEGER NOT NULL,
		freq_kind           TEXT    NOT NULL,
		freq_times_per_week INTEGER NOT NULL DEFAULT 0,
		freq_weekdays       INTEGER NOT NULL DEFAULT 0,
		freq_interval_days  INTEGER NOT NULL DEFAULT 0,
		freq_week_interval  INTEGER NOT NULL DEFAULT 0,
		freq_week_of_month  INTEGER NOT NULL DEFAULT 0,
		freq_anchor_date    TEXT    NOT NULL DEFAULT '',
		PRIMARY KEY (habit_id, valid_from)
	) WITHOUT ROWID;
	INSERT INTO habit_schedules
		SELECT id, substr(created_at, 1, 10), target_value,
		       freq_kind, freq_times_per_week, freq_weekdays, freq_interval_days,
		       freq_week_interval, freq_week_of_month, freq_anchor_date
		FROM habits;
	ALTER TABLE habits DROP COLUMN target_value;
	ALTER TABLE habits DROP COLUMN freq_kind;
	ALTER TABLE habits DROP COLUMN freq_times_per_week;
	ALTER TABLE habits DROP COLUMN freq_weekdays;
	ALTER TABLE habits DROP COLUMN freq_interval_days;
	ALTER TABLE habits DROP COLUMN freq_anchor_date;
	ALTER TABLE habits DROP COLUMN freq_week_interval;
	ALTER TABLE habits DROP COLUMN freq_week_of_month;`,
}

// migrate applies all migrations newer than the schema version, each in its
// own transaction.
func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}
	if version > len(migrations) {
		return fmt.Errorf("database has schema version %d, this binary only knows %d — probably an older version of the application", version, len(migrations))
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("starting migration %d: %w", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("applying migration %d: %w", i+1, err)
		}
		// PRAGMA does not support placeholders.
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return fmt.Errorf("setting schema version %d: %w", i+1, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("committing migration %d: %w", i+1, err)
		}
	}
	return nil
}

// NewID returns a random 128-bit ID in hex.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("store: no entropy available: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// storedTimeLayout is RFC 3339 with fixed-width nanoseconds, so that stored
// timestamps sort chronologically as text.
const storedTimeLayout = "2006-01-02T15:04:05.000000000Z07:00"

// formatTime formats t in UTC for storage.
func formatTime(t time.Time) string { return t.UTC().Format(storedTimeLayout) }

// parseTime parses a stored timestamp, with or without fixed-width
// nanoseconds.
func parseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

// nullableTime parses a nullable stored timestamp; NULL and "" yield nil.
func nullableTime(s sql.NullString) (*time.Time, error) {
	if !s.Valid || s.String == "" {
		return nil, nil
	}
	t, err := parseTime(s.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
