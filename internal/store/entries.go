package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/JulWit/habits/internal/domain"
)

// Entries returns the entries of all habits of the user, keyed by habit ID.
func (t *Tx) Entries(ctx context.Context) (map[string]map[domain.Date]domain.Entry, error) {
	rows, err := t.query(ctx, `
		SELECT e.habit_id, e.date, e.value, e.skipped
		FROM entries e JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ?`, t.userID)
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

// HabitEntries returns all entries of a habit of the user.
func (t *Tx) HabitEntries(ctx context.Context, habitID string) (map[domain.Date]domain.Entry, error) {
	rows, err := t.query(ctx, `
		SELECT e.habit_id, e.date, e.value, e.skipped
		FROM entries e JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND e.habit_id = ?`, t.userID, habitID)
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

// scanEntry scans a row of habit_id, date, value and skipped; the habit ID
// goes to habitID.
func scanEntry(rows *sql.Rows, habitID *string) (domain.Date, domain.Entry, error) {
	var (
		date string
		e    domain.Entry
	)
	if err := rows.Scan(habitID, &date, &e.Value, &e.Skipped); err != nil {
		return domain.Date{}, domain.Entry{}, fmt.Errorf("reading entry: %w", err)
	}
	d, err := domain.ParseDate(date)
	if err != nil {
		return domain.Date{}, domain.Entry{}, fmt.Errorf("entry of habit %s: %w", *habitID, err)
	}
	return d, e, nil
}

// Entry returns the entry of a habit of the user on date; the zero Entry if
// nothing is recorded.
func (t *Tx) Entry(ctx context.Context, habitID string, date domain.Date) (domain.Entry, error) {
	var e domain.Entry
	err := t.queryRow(ctx, `
		SELECT e.value, e.skipped FROM entries e JOIN habits h ON h.id = e.habit_id
		WHERE h.user_id = ? AND e.habit_id = ? AND e.date = ?`,
		t.userID, habitID, date.String()).Scan(&e.Value, &e.Skipped)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Entry{}, nil
	}
	if err != nil {
		return domain.Entry{}, fmt.Errorf("loading entry: %w", err)
	}
	return e, nil
}

// SetEntries stores the entries of the habit h on their days, deleting those
// that record nothing, and updates the habit's updated_at. Each entry is
// validated for the habit's kind.
func (t *Tx) SetEntries(ctx context.Context, h domain.Habit, entries map[domain.Date]domain.Entry) error {
	if len(entries) == 0 {
		return nil
	}
	days := slices.SortedFunc(maps.Keys(entries), domain.Date.Compare)
	for _, d := range days {
		if err := entries[d].Validate(h.Kind); err != nil {
			return err
		}
	}
	first, last := days[0].String(), days[len(days)-1].String()
	if err := t.watch(ctx, "entries", "habit_id = ? AND date BETWEEN ? AND ?", h.ID, first, last); err != nil {
		return err
	}
	now := formatTime(t.now)
	for _, d := range days {
		if err := t.writeEntry(ctx, h.ID, d, entries[d], now); err != nil {
			return err
		}
	}
	if _, err := t.exec(ctx, `UPDATE habits SET updated_at = ? WHERE id = ? AND user_id = ?`, now, h.ID, t.userID); err != nil {
		return fmt.Errorf("touching habit %s: %w", h.ID, err)
	}
	return nil
}

// ReplaceEntries replaces all entries of the habit h with entries, e.g. with
// its history converted to a new kind (domain.ConvertKind).
func (t *Tx) ReplaceEntries(ctx context.Context, h domain.Habit, entries map[domain.Date]domain.Entry) error {
	for _, e := range entries {
		if err := e.Validate(h.Kind); err != nil {
			return err
		}
	}
	if err := t.watch(ctx, "entries", "habit_id = ?", h.ID); err != nil {
		return err
	}
	if _, err := t.exec(ctx, `DELETE FROM entries WHERE habit_id = ?`, h.ID); err != nil {
		return fmt.Errorf("deleting entries of habit %s: %w", h.ID, err)
	}
	now := formatTime(t.now)
	for d, e := range entries {
		if err := t.writeEntry(ctx, h.ID, d, e, now); err != nil {
			return err
		}
	}
	return nil
}

// writeEntry stores e as the entry of the habit on date, or deletes the entry
// if e records nothing.
func (t *Tx) writeEntry(ctx context.Context, habitID string, date domain.Date, e domain.Entry, now string) error {
	if e.IsZero() {
		if _, err := t.exec(ctx, `DELETE FROM entries WHERE habit_id = ? AND date = ?`, habitID, date.String()); err != nil {
			return fmt.Errorf("deleting entry of %s: %w", date, err)
		}
		return nil
	}
	if _, err := t.exec(ctx, `
		INSERT INTO entries (habit_id, date, value, skipped, updated_at) VALUES (?,?,?,?,?)
		ON CONFLICT(habit_id, date) DO UPDATE SET
			value = excluded.value, skipped = excluded.skipped, updated_at = excluded.updated_at`,
		habitID, date.String(), e.Value, e.Skipped, now); err != nil {
		return fmt.Errorf("saving entry of %s: %w", date, err)
	}
	return nil
}
