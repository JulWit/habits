package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// EntriesForUser returns the entries of all non-deleted habits of the user,
// keyed by habit ID.
func (s *Store) EntriesForUser(ctx context.Context, userID string) (map[string]map[domain.Date]int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.habit_id, e.date, e.value
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL`, userID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()

	out := map[string]map[domain.Date]int{}
	for rows.Next() {
		var (
			habitID string
			date    string
			value   int
		)
		if err := rows.Scan(&habitID, &date, &value); err != nil {
			return nil, fmt.Errorf("reading entry: %w", err)
		}
		d, err := domain.ParseDate(date)
		if err != nil {
			return nil, fmt.Errorf("entry of habit %s: %w", habitID, err)
		}
		if out[habitID] == nil {
			out[habitID] = map[domain.Date]int{}
		}
		out[habitID][d] = value
	}
	return out, rows.Err()
}

// EntriesForHabit returns all entries of a habit of the user.
func (s *Store) EntriesForHabit(ctx context.Context, userID, habitID string) (map[domain.Date]int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.date, e.value
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL AND e.habit_id = ?`, userID, habitID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()

	out := map[domain.Date]int{}
	for rows.Next() {
		var (
			date  string
			value int
		)
		if err := rows.Scan(&date, &value); err != nil {
			return nil, fmt.Errorf("reading entry: %w", err)
		}
		d, err := domain.ParseDate(date)
		if err != nil {
			return nil, fmt.Errorf("entry of habit %s: %w", habitID, err)
		}
		out[d] = value
	}
	return out, rows.Err()
}

// SetEntry sets the value of a habit on date and returns the previous value,
// 0 without an entry. A value of 0 deletes the entry.
//
// With expect, the write is conditional: it only happens while the stored
// value is still *expect. Otherwise nothing changes and SetEntry returns
// ErrConflict with the stored value as previous. Undo uses it so that it does
// not overwrite a change made elsewhere in the meantime.
func (s *Store) SetEntry(ctx context.Context, userID, habitID string, date domain.Date, value int, expect *int) (previous int, err error) {
	if date.IsZero() {
		return 0, domain.Invalid("date_missing", "date is missing")
	}

	err = s.inTx(ctx, "saving entry", func(tx *sql.Tx) error {
		// Check ownership and load the kind, which bounds the value.
		var kind domain.Kind
		err := tx.QueryRowContext(ctx,
			`SELECT kind FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
			habitID, userID).Scan(&kind)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if err := domain.ValidateEntryValue(kind, value); err != nil {
			return err
		}

		err = tx.QueryRowContext(ctx,
			`SELECT value FROM entries WHERE habit_id = ? AND date = ?`, habitID, date.String()).Scan(&previous)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if expect != nil && previous != *expect {
			return ErrConflict
		}

		now := formatTime(time.Now())
		if value == 0 {
			// Days without a value have no row.
			_, err = tx.ExecContext(ctx,
				`DELETE FROM entries WHERE habit_id = ? AND date = ?`, habitID, date.String())
		} else {
			_, err = tx.ExecContext(ctx, `
				INSERT INTO entries (habit_id, date, value, updated_at) VALUES (?,?,?,?)
				ON CONFLICT(habit_id, date) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
				habitID, date.String(), value, now)
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE habits SET updated_at = ? WHERE id = ?`, now, habitID)
		return err
	})
	return previous, err
}
