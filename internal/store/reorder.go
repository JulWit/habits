package store

import (
	"context"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// reorder sets the positions of the user's non-deleted rows in table to the
// order of ids. Rows missing from ids follow in their previous order; unknown
// IDs are ignored; duplicate IDs are an error. table must be a constant.
// touchUpdated also sets updated_at.
func (s *Store) reorder(ctx context.Context, table, userID string, ids []string, touchUpdated bool) error {
	named := make(map[string]bool, len(ids))
	for _, id := range ids {
		if named[id] {
			return domain.Invalid("order_duplicate", "The new order names the same entry twice.")
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

	now := formatTime(time.Now())
	for i, id := range order {
		var err error
		if touchUpdated {
			_, err = tx.ExecContext(ctx,
				`UPDATE `+table+` SET position = ?, updated_at = ? WHERE id = ?`, i, now, id)
		} else {
			_, err = tx.ExecContext(ctx,
				`UPDATE `+table+` SET position = ? WHERE id = ?`, i, id)
		}
		if err != nil {
			return fmt.Errorf("saving order: %w", err)
		}
	}
	return tx.Commit()
}
