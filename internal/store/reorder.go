package store

import (
	"context"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// reorder writes the positions 0, 1, 2, … of the user's live rows in table, in
// the order ids gives.
//
// ids need not name every row. The client leaves out what it does not show -
// archived habits while they are hidden, a habit another device created a
// moment ago - and those follow the named rows in the order they already had,
// so no two rows ever share a position. An id that is not one of the user's
// live rows is skipped rather than refused, so a stale client cannot fail the
// whole request. An id named twice is refused: no client means that, and there
// is no telling which of the two places it wanted.
//
// table is one of the package's own constants, never input. touchUpdated says
// whether a move counts as a change to the row.
func (s *Store) reorder(ctx context.Context, table, userID string, ids []string, touchUpdated bool) error {
	named := make(map[string]bool, len(ids))
	for _, id := range ids {
		if named[id] {
			return domain.Invalid("The new order names the same entry twice.")
		}
		named[id] = true
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `SELECT id FROM `+table+`
		WHERE user_id = ? AND deleted_at IS NULL ORDER BY position, created_at`, userID)
	if err != nil {
		return fmt.Errorf("loading order: %w", err)
	}
	var current []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("reading order: %w", err)
		}
		current = append(current, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("reading order: %w", err)
	}

	live := make(map[string]bool, len(current))
	for _, id := range current {
		live[id] = true
	}
	order := make([]string, 0, len(current))
	for _, id := range ids {
		if live[id] {
			order = append(order, id)
		}
	}
	for _, id := range current {
		if !named[id] {
			order = append(order, id)
		}
	}

	query := `UPDATE ` + table + ` SET position = ? WHERE id = ?`
	args := func(i int, id string) []any { return []any{i, id} }
	if touchUpdated {
		now := formatTime(time.Now())
		query = `UPDATE ` + table + ` SET position = ?, updated_at = ? WHERE id = ?`
		args = func(i int, id string) []any { return []any{i, now, id} }
	}
	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return fmt.Errorf("preparing reorder: %w", err)
	}
	defer stmt.Close()
	for i, id := range order {
		if _, err := stmt.ExecContext(ctx, args(i, id)...); err != nil {
			return fmt.Errorf("saving order: %w", err)
		}
	}
	return tx.Commit()
}
