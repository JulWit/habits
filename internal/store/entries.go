package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// EntryMap holds one day's value per date for a single habit.
type EntryMap map[domain.Date]int

// EntriesForUser loads every entry of every non-deleted habit of the user in a
// single query, keyed by habit ID. One query rather than one per habit keeps
// the overview at a constant number of round trips as the list grows.
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

// EntriesForHabit loads the full history of one habit after checking ownership.
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

// SetEntry records a value for one day and returns the value it replaced.
//
// Returning the previous value is what makes undo possible without any local
// state: the client can always ask the server to put back exactly what was
// there, even after a reload or from a second device.
func (s *Store) SetEntry(ctx context.Context, userID, habitID string, date domain.Date, value int) (previous int, err error) {
	// The value is checked against the habit's kind below, once the row that
	// names that kind has been read.
	if date.IsZero() {
		return 0, domain.Invalid("date is missing")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// The kind comes back with the ownership check, because it is what decides
	// how large a day may be: the same per-kind ceiling a target is held to.
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
		// Keep the table sparse: an empty day is the absence of a row, not a
		// row holding zero. Heatmaps and stats then never have to distinguish
		// "not recorded" from "recorded as nothing".
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
