package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// EntryMap maps dates to the recorded values of a habit.
type EntryMap map[domain.Date]int

// EntriesForUser returns the entries of all non-deleted habits of the user,
// keyed by habit ID.
func (s *Store) EntriesForUser(ctx context.Context, userID string) (map[string]EntryMap, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.habit_id, e.date, e.value
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL`, userID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()
	return collectEntries(rows)
}

// EntriesForHabit returns all entries of a habit of the user.
func (s *Store) EntriesForHabit(ctx context.Context, userID, habitID string) (EntryMap, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.habit_id, e.date, e.value
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL AND e.habit_id = ?`, userID, habitID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()

	byHabit, err := collectEntries(rows)
	if err != nil {
		return nil, err
	}
	if m := byHabit[habitID]; m != nil {
		return m, nil
	}
	return EntryMap{}, nil
}

// collectEntries reads rows of (habit_id, date, value) into entry maps keyed
// by habit ID.
func collectEntries(rows *sql.Rows) (map[string]EntryMap, error) {
	out := map[string]EntryMap{}
	for rows.Next() {
		var (
			habitID string
			raw     string
			value   int
		)
		if err := rows.Scan(&habitID, &raw, &value); err != nil {
			return nil, fmt.Errorf("reading entry: %w", err)
		}
		d, err := domain.ParseDate(raw)
		if err != nil {
			return nil, fmt.Errorf("entry of habit %s: %w", habitID, err)
		}
		if out[habitID] == nil {
			out[habitID] = EntryMap{}
		}
		out[habitID][d] = value
	}
	return out, rows.Err()
}

// SetEntry sets the value of a habit on date and returns the previous value
// (for undo). A value of 0 deletes the entry.
func (s *Store) SetEntry(ctx context.Context, userID, habitID string, date domain.Date, value int) (previous int, err error) {
	// The value is validated below, once the habit's kind is known.
	if date.IsZero() {
		return 0, domain.Invalid("date is missing")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// Check ownership and load the kind.
	var kind domain.Kind
	err = tx.QueryRowContext(ctx,
		`SELECT kind FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		habitID, userID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("checking habit: %w", err)
	}
	if err := domain.ValidateEntryValue(kind, value); err != nil {
		return 0, err
	}

	key := date.String()
	err = tx.QueryRowContext(ctx,
		`SELECT value FROM entries WHERE habit_id = ? AND date = ?`, habitID, key).Scan(&previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("reading previous value: %w", err)
	}

	if value == 0 {
		// Days without a value have no row.
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM entries WHERE habit_id = ? AND date = ?`, habitID, key); err != nil {
			return 0, fmt.Errorf("deleting entry: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entries (habit_id, date, value, updated_at) VALUES (?,?,?,?)
			ON CONFLICT(habit_id, date) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			habitID, key, value, formatTime(time.Now())); err != nil {
			return 0, fmt.Errorf("saving entry: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE habits SET updated_at = ? WHERE id = ?`, formatTime(time.Now()), habitID); err != nil {
		return 0, fmt.Errorf("updating habit timestamp: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing entry: %w", err)
	}
	return previous, nil
}
