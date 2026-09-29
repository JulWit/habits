package store

import (
	"context"
	"fmt"
	"slices"

	"github.com/JulWit/habits/internal/domain"
)

// reorder sets the positions of the user's rows in table to the order of
// ids. Rows missing from ids follow in their previous order; unknown IDs are
// ignored; duplicate IDs are an error. table must be a constant. Reordering
// is not an undo step.
func (t *Tx) reorder(ctx context.Context, table string, ids []string) error {
	for i, id := range ids {
		if slices.Contains(ids[:i], id) {
			return domain.Invalid("order_duplicate", "the new order names the same entry twice")
		}
	}

	rows, err := t.query(ctx, `SELECT id FROM `+table+` WHERE user_id = ? ORDER BY position, created_at`, t.userID)
	if err != nil {
		return fmt.Errorf("loading the order of %s: %w", table, err)
	}
	var current []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("reading the order of %s: %w", table, err)
		}
		current = append(current, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("reading the order of %s: %w", table, err)
	}

	// First the named rows in their new order, then the others.
	var order []string
	for _, id := range ids {
		if slices.Contains(current, id) {
			order = append(order, id)
		}
	}
	for _, id := range current {
		if !slices.Contains(ids, id) {
			order = append(order, id)
		}
	}

	for position, id := range order {
		if _, err := t.exec(ctx, `UPDATE `+table+` SET position = ? WHERE id = ?`, position, id); err != nil {
			return fmt.Errorf("saving the order of %s: %w", table, err)
		}
	}
	return nil
}
