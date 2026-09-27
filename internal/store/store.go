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
