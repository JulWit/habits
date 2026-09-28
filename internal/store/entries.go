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
func (s *Store) EntriesForUser(ctx context.Context, userID string) (map[string]map[domain.Date]domain.Entry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.habit_id, e.date, e.value, e.skipped, e.note
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL`, userID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()

	out := map[string]map[domain.Date]domain.Entry{}
	for rows.Next() {
		var habitID string
		d, e, err := scanEntry(rows, &habitID)
		if err != nil {
			return nil, err
		}
		if out[habitID] == nil {
			out[habitID] = map[domain.Date]domain.Entry{}
		}
		out[habitID][d] = e
	}
	return out, rows.Err()
}

// EntriesForHabit returns all entries of a habit of the user.
func (s *Store) EntriesForHabit(ctx context.Context, userID, habitID string) (map[domain.Date]domain.Entry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.habit_id, e.date, e.value, e.skipped, e.note
		FROM entries e
		JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND h.deleted_at IS NULL AND e.habit_id = ?`, userID, habitID)
	if err != nil {
		return nil, fmt.Errorf("loading entries: %w", err)
	}
	defer rows.Close()

	out := map[domain.Date]domain.Entry{}
	for rows.Next() {
		var id string
		d, e, err := scanEntry(rows, &id)
		if err != nil {
			return nil, err
		}
		out[d] = e
	}
	return out, rows.Err()
}

// scanEntry scans a row of habit_id, date, value, skipped and note; the
// habit ID goes to habitID.
func scanEntry(rows *sql.Rows, habitID *string) (domain.Date, domain.Entry, error) {
	var (
		date string
		e    domain.Entry
	)
	if err := rows.Scan(habitID, &date, &e.Value, &e.Skipped, &e.Note); err != nil {
		return domain.Date{}, domain.Entry{}, fmt.Errorf("reading entry: %w", err)
	}
	d, err := domain.ParseDate(date)
	if err != nil {
		return domain.Date{}, domain.Entry{}, fmt.Errorf("entry of habit %s: %w", *habitID, err)
	}
	return d, e, nil
}

// SetEntry applies change to the entry of a habit on date and returns the
// entry before and after, and the habit's new updated_at. An entry with
// nothing recorded is deleted.
//
// With expect, the write is conditional: it only happens while the stored
// entry (the zero Entry without one) is still *expect. Otherwise nothing
// changes and SetEntry returns ErrConflict with the stored entry as previous.
// Undo uses it so that it does not overwrite a change made elsewhere in the
// meantime.
func (s *Store) SetEntry(ctx context.Context, userID, habitID string, date domain.Date, change domain.EntryChange, expect *domain.Entry) (previous, next domain.Entry, updatedAt time.Time, err error) {
	if date.IsZero() {
		return previous, next, updatedAt, domain.Invalid("date_missing", "date is missing")
	}

	updatedAt = time.Now().UTC()
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

		err = tx.QueryRowContext(ctx,
			`SELECT value, skipped, note FROM entries WHERE habit_id = ? AND date = ?`,
			habitID, date.String()).Scan(&previous.Value, &previous.Skipped, &previous.Note)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if expect != nil && previous != *expect {
			return ErrConflict
		}
		next = change.Apply(previous)
		if err := next.Validate(kind); err != nil {
			return err
		}

		now := formatTime(updatedAt)
		if err := writeEntry(ctx, tx, habitID, date, next, now); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE habits SET updated_at = ? WHERE id = ?`, now, habitID)
		return err
	})
	if err != nil {
		// previous holds the stored entry on ErrConflict.
		return previous, domain.Entry{}, time.Time{}, err
	}
	return previous, next, updatedAt, nil
}

// writeEntry stores e as the entry of the habit on date, or deletes the entry
// if e records nothing.
func writeEntry(ctx context.Context, tx *sql.Tx, habitID string, date domain.Date, e domain.Entry, now string) error {
	if e.IsZero() {
		_, err := tx.ExecContext(ctx,
			`DELETE FROM entries WHERE habit_id = ? AND date = ?`, habitID, date.String())
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO entries (habit_id, date, value, skipped, note, updated_at) VALUES (?,?,?,?,?,?)
		ON CONFLICT(habit_id, date) DO UPDATE SET
			value = excluded.value, skipped = excluded.skipped, note = excluded.note,
			updated_at = excluded.updated_at`,
		habitID, date.String(), e.Value, e.Skipped, e.Note, now)
	return err
}
