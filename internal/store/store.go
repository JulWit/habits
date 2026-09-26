// Package store is the persistence layer. It owns the SQL schema and is the
// only package that knows the application uses SQLite.
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

	_ "modernc.org/sqlite" // pure-Go driver: no cgo, so the binary links statically
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// invalidf marks a rejection as a validation failure rather than a fault, so
// the HTTP layer answers 422 instead of 500.
func invalidf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", domain.ErrValidation, fmt.Sprintf(format, args...))
}

// execer is satisfied by both *sql.DB and *sql.Tx, so a write can be run either
// on its own or as one step of a larger transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type Store struct {
	db *sql.DB
}

// Open connects to the SQLite file and brings the schema up to date.
//
// The pool is capped at a single connection on purpose. SQLite allows only one
// writer, and a larger pool buys nothing for a personal tracker while making
// SQLITE_BUSY possible. If read throughput ever matters, the fix is a second
// read-only pool rather than a bigger shared one.
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

func (s *Store) Close() error { return s.db.Close() }

// migrations are applied in order and tracked with PRAGMA user_version. Never
// edit an entry that has shipped — append a new one instead.
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

	// Drop the "system" theme. SQLite cannot alter a column default, so the
	// table is rebuilt; anyone still on 'system' is moved to the light theme,
	// which is now the default.
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

	// Categories group habits into blocks on the overview. Like habits they are
	// soft-deleted, which is what lets a deletion be undone; a habit whose
	// category is soft-deleted simply shows as uncategorised until the category
	// comes back, so no habit rows have to be touched either way.
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

	// How many day columns the board shows. 0 keeps the previous behaviour of
	// filling whatever width is available.
	`ALTER TABLE user_settings ADD COLUMN overview_days INTEGER NOT NULL DEFAULT 0;`,

	// Whether archived habits are shown. Stored rather than kept in the client,
	// so it survives a reload like every other setting and the first response
	// already contains the right set of habits.
	`ALTER TABLE user_settings ADD COLUMN show_archived INTEGER NOT NULL DEFAULT 0;`,

	// The habit palette was replaced. Existing habits still carry a colour from
	// the old set, which would leave the board showing shades the editor no
	// longer offers, so each is mapped to its nearest counterpart. The old
	// palette had a yellow and a brown that the new one does not; those go to
	// amber and to the neutral grey. Any colour outside the old palette is left
	// untouched by the ELSE.
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

	// Habit notes were removed from the product. Dropping the column rather than
	// leaving it behind keeps the schema honest about what the app stores; any
	// text still in it goes with it.
	`ALTER TABLE habits DROP COLUMN notes;`,

	// The habit kinds were renamed to match what the UI calls them, and a
	// fourth was added. Only the stored strings change; the meaning of every
	// row is untouched.
	`UPDATE habits SET kind = CASE kind
		WHEN 'bool' THEN 'check'
		WHEN 'counter' THEN 'count'
		WHEN 'duration' THEN 'time'
		ELSE kind
	END;`,

	// The overview offers 28 days instead of 30, so that the longest range is a
	// whole number of weeks. Anyone still on 30 is moved across: the value stays
	// valid on its own, but the settings dialog would show no option selected.
	`UPDATE user_settings SET overview_days = 28 WHERE overview_days = 30;`,

	// The amber in slot three read as orange next to the orange beside it, and
	// was replaced by an actual yellow. Habits wearing the old value are moved
	// across: it stays a valid colour on its own, but the editor would show no
	// swatch selected for it.
	`UPDATE habits SET color = '#eab308' WHERE color = '#cc7006';`,

	// The typeface became a setting. Existing rows get the face the interface
	// had been drawn with up to here, so nobody's app changes its look because
	// of an upgrade.
	`ALTER TABLE user_settings ADD COLUMN font TEXT NOT NULL DEFAULT 'inter';`,

	// How an order is changed became a setting. Dragging is the default, which
	// is what the board did when the choice did not exist yet.
	`ALTER TABLE user_settings ADD COLUMN reorder_mode TEXT NOT NULL DEFAULT 'drag';`,

	// How much a tap adds became a property of the habit. Existing rows get the
	// step their kind had hard-coded until now, so nothing changes for anyone
	// until they set a different one.
	`ALTER TABLE habits ADD COLUMN step_value INTEGER NOT NULL DEFAULT 1;
	 UPDATE habits SET step_value = CASE kind
		WHEN 'time' THEN 5
		WHEN 'distance' THEN 500
		ELSE 1
	END;`,

	// Counts and durations gained a decimal place. Values stay whole numbers in
	// the database, so both kinds move to a unit ten times finer - tenths of a
	// count, tenths of a minute - the way a distance has always been kept in
	// metres. Multiplying every stored number by ten leaves what people see
	// exactly as it was.
	`UPDATE entries SET value = value * 10
	 WHERE habit_id IN (SELECT id FROM habits WHERE kind IN ('count', 'time'));
	 UPDATE habits SET target_value = target_value * 10, step_value = step_value * 10
	 WHERE kind IN ('count', 'time');`,

	`ALTER TABLE user_settings ADD COLUMN pattern TEXT NOT NULL DEFAULT 'none';`,

	`ALTER TABLE user_settings ADD COLUMN align_weeks INTEGER NOT NULL DEFAULT 0;`,

	`ALTER TABLE user_settings ADD COLUMN background TEXT NOT NULL DEFAULT 'default';`,

	// The page colour was taken out again. The column goes with it rather than
	// lingering as a value nothing reads.
	`ALTER TABLE user_settings DROP COLUMN background;`,

	`ALTER TABLE user_settings ADD COLUMN band_color TEXT NOT NULL DEFAULT 'neutral';`,

	// The uploaded background, and the two knobs that make a photo behind a board
	// readable. The image itself lives in the database rather than beside it: the
	// application is one binary and one file, and a blob keeps it that way -
	// backup, deletion and the user's own row all stay in one place.
	`ALTER TABLE user_settings ADD COLUMN bg_dim INTEGER NOT NULL DEFAULT 55;
	 ALTER TABLE user_settings ADD COLUMN bg_blur INTEGER NOT NULL DEFAULT 0;
	 CREATE TABLE backgrounds (
		user_id    TEXT PRIMARY KEY,
		mime       TEXT NOT NULL,
		bytes      BLOB NOT NULL,
		etag       TEXT NOT NULL,
		updated_at TEXT NOT NULL
	 );`,

	// The blur went from pixels to percent, where a hundred is the same fully
	// soft picture the old forty pixels gave. Existing values are converted
	// rather than reinterpreted, so nobody's background changes behind them.
	`UPDATE user_settings SET bg_blur = MIN(100, CAST(bg_blur * 2.5 AS INTEGER));`,

	// The surfaces over an uploaded picture: how solid the cards and the bars
	// are, and how far they blur what shows through them. The defaults are what
	// the title bar already did on its own - opaque enough to read, soft enough
	// that the picture is still there behind it.
	`ALTER TABLE user_settings ADD COLUMN surface_opacity INTEGER NOT NULL DEFAULT 88;
	 ALTER TABLE user_settings ADD COLUMN surface_blur INTEGER NOT NULL DEFAULT 30;`,

	// How strongly today's column is marked. A hundred is what it has always
	// been, so nothing changes for anyone who never touches the slider.
	`ALTER TABLE user_settings ADD COLUMN band_opacity INTEGER NOT NULL DEFAULT 100;`,

	// How tightly the interface is packed. "standard" is the spacing it has always
	// had, so nothing moves for anyone until they choose otherwise.
	`ALTER TABLE user_settings ADD COLUMN density TEXT NOT NULL DEFAULT 'standard';`,

	// Whether today runs as a band through the cards. On is what it has always
	// done, so nothing changes for anyone until they switch it off.
	`ALTER TABLE user_settings ADD COLUMN show_band INTEGER NOT NULL DEFAULT 1;`,

	// For a while the palette was extended well past the original twelve; it
	// went back to them. Anything already painted with one of the extra shades -
	// a habit or the today band - moves to the original of the same hue, rather
	// than keeping a colour the editor no longer offers or falling back to grey.
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

	// How strongly the band through the cards is drawn, apart from the accent's
	// own opacity. Started at whatever that opacity was, so the band looks the
	// same for everyone until they move the new slider.
	`ALTER TABLE user_settings ADD COLUMN band_fill_opacity INTEGER NOT NULL DEFAULT 100;
	 UPDATE user_settings SET band_fill_opacity = band_opacity;`,

	// Habits can wear an icon beside their name. Empty is "none", which every
	// existing habit keeps until someone picks one.
	`ALTER TABLE habits ADD COLUMN icon TEXT NOT NULL DEFAULT '';`,

	// Categories can wear an icon too, from the same set as habits.
	`ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';`,

	// Whether a category's heading shows today's progress. On is what every
	// block has done so far, so nothing changes until someone switches it off.
	`ALTER TABLE categories ADD COLUMN show_progress INTEGER NOT NULL DEFAULT 1;`,

	// The default turned out the other way round: a heading shows no progress
	// until it is asked to. Every category is switched off, since none had been
	// switched deliberately yet. The column keeps its DEFAULT 1 - SQLite cannot
	// change a default without rebuilding the table, and every insert names the
	// value anyway.
	`UPDATE categories SET show_progress = 0;`,

	// Categories can take a colour for their icon. Empty is neutral ink, which
	// is how every existing category has been drawn so far.
	`ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '';`,
}

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
		// PRAGMA does not accept placeholders, hence the formatted statement;
		// the value is a loop index, never user input.
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

// NewID returns a random opaque identifier. Random rather than sequential so
// that IDs leak neither creation order nor how many habits exist.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("store: no entropy available: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// storedTimeLayout is RFC3339 in UTC with a fixed-width nanosecond field.
//
// The padding is the point. time.RFC3339Nano trims trailing zeros, which leaves
// the fraction variable-width — and then text ordering stops agreeing with
// chronological ordering, because "…:00.5Z" sorts after "…:00.5001Z" ('Z' is
// above '0'). Two places rely on that ordering: the purge compares deleted_at
// against a cutoff as text, and the habit and category lists break ties on
// created_at. Parsing stays on RFC3339Nano, which reads both the padded form
// and the trimmed rows already in existing databases.
const storedTimeLayout = "2006-01-02T15:04:05.000000000Z07:00"

func formatTime(t time.Time) string { return t.UTC().Format(storedTimeLayout) }

func parseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

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
