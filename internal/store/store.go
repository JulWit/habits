// Package store persists the application data in SQLite.
//
// All access goes through a transaction of one user (Tx): View for reading,
// Update for changing. A handler reads, checks and writes within one
// transaction, so no change made in between can slip through. An Update that
// calls Tx.Record keeps an undo step (see changes.go).
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var (
	// ErrNotFound is returned when a record does not exist for the user.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned when a change conflicts with the stored state,
	// e.g. an undo of data changed since.
	ErrConflict = errors.New("conflict")
)

// Store provides access to the database.
type Store struct {
	db *sql.DB
}

// Open opens the SQLite database at path and applies pending migrations. The
// pool uses a single connection, since SQLite allows only one writer. The
// program has to register the driver "sqlite" by importing
// modernc.org/sqlite.
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

// Tx is a transaction of one user. Its methods are scoped to that user.
type Tx struct {
	tx     *sql.Tx
	userID string
	// now is the time of the transaction, used for all its timestamps.
	now time.Time
	// log collects the rows the transaction changes, for its undo step; nil
	// in View.
	log *changeLog
}

// View runs fn in a transaction that only reads.
func (s *Store) View(ctx context.Context, userID string, fn func(*Tx) error) error {
	return s.inTx(ctx, "reading", func(tx *sql.Tx) error {
		return fn(&Tx{tx: tx, userID: userID, now: time.Now().UTC()})
	})
}

// Update runs fn in a transaction that changes the user's data and commits
// it if fn succeeds. If fn calls Tx.Record, the change is kept as an undo
// step and its ID returned; otherwise the ID is 0.
func (s *Store) Update(ctx context.Context, userID string, fn func(*Tx) error) (int64, error) {
	if strings.TrimSpace(userID) == "" {
		return 0, errors.New("no user")
	}
	var changeID int64
	err := s.inTx(ctx, "saving", func(tx *sql.Tx) error {
		t := &Tx{tx: tx, userID: userID, now: time.Now().UTC(), log: &changeLog{}}
		if err := t.ensureUser(ctx); err != nil {
			return err
		}
		if err := fn(t); err != nil {
			return err
		}
		id, err := t.saveChange(ctx)
		changeID = id
		return err
	})
	if err != nil {
		return 0, err
	}
	return changeID, nil
}

// inTx runs fn in a transaction and commits it. what describes the work for
// errors; errors of the domain and ErrNotFound are passed on unwrapped.
func (s *Store) inTx(ctx context.Context, what string, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}

// Now returns the time of the transaction, which its timestamps use.
func (t *Tx) Now() time.Time { return t.now }

// exec runs a statement in the transaction.
func (t *Tx) exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, query, args...)
}

// query runs a query in the transaction.
func (t *Tx) query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.tx.QueryContext(ctx, query, args...)
}

// queryRow runs a query for a single row in the transaction.
func (t *Tx) queryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(ctx, query, args...)
}

// ensureUser records the user on their first write. Every user-owned row
// refers to it.
func (t *Tx) ensureUser(ctx context.Context) error {
	if _, err := t.exec(ctx,
		`INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
		t.userID, formatTime(t.now)); err != nil {
		return fmt.Errorf("recording user: %w", err)
	}
	return nil
}

// DeleteUser removes the user and, through ON DELETE CASCADE, all their data:
// settings, categories, habits, schedules, entries and undo steps. The user
// is recorded again on their next write. It cannot be undone.
func (t *Tx) DeleteUser(ctx context.Context) error {
	if _, err := t.exec(ctx, `DELETE FROM users WHERE id = ?`, t.userID); err != nil {
		return fmt.Errorf("deleting user: %w", err)
	}
	return nil
}

// NewID returns a random 128-bit ID in hex.
func NewID() string {
	var b [16]byte
	rand.Read(b[:]) // never fails since Go 1.24
	return hex.EncodeToString(b[:])
}

// storedTimeLayout is RFC 3339 with fixed-width nanoseconds, so that stored
// timestamps sort chronologically as text.
const storedTimeLayout = "2006-01-02T15:04:05.000000000Z07:00"

// formatTime formats t in UTC for storage.
func formatTime(t time.Time) string { return t.UTC().Format(storedTimeLayout) }

// parseTime parses a stored timestamp.
func parseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

// scanner is a single row to scan: a *sql.Row, or *sql.Rows at its current
// row.
type scanner interface {
	Scan(dest ...any) error
}

// expectOneRow returns ErrNotFound if res affected no rows.
func expectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("affected rows: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// nullableID maps "" to NULL.
func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
}
