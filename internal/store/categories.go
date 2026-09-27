package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

const categoryColumns = `id, name, icon, color, show_progress, position, created_at, updated_at`

// scanCategory scans a row selected with categoryColumns.
func scanCategory(row interface{ Scan(...any) error }) (domain.Category, error) {
	var (
		c       domain.Category
		created string
		updated string
	)
	if err := row.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.ShowProgress, &c.Position, &created, &updated); err != nil {
		return domain.Category{}, err
	}
	var err error
	if c.CreatedAt, err = parseTime(created); err != nil {
		return domain.Category{}, fmt.Errorf("category %s: created_at: %w", c.ID, err)
	}
	if c.UpdatedAt, err = parseTime(updated); err != nil {
		return domain.Category{}, fmt.Errorf("category %s: updated_at: %w", c.ID, err)
	}
	return c, nil
}

// ListCategories returns the user's categories in display order, excluding
// deleted categories.
func (s *Store) ListCategories(ctx context.Context, userID string) ([]domain.Category, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+categoryColumns+`
		 FROM categories
		 WHERE user_id = ? AND deleted_at IS NULL
		 ORDER BY position, created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("loading categories: %w", err)
	}
	defer rows.Close()

	out := []domain.Category{}
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCategory returns a category of the user, or ErrNotFound.
func (s *Store) GetCategory(ctx context.Context, userID, id string) (domain.Category, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+categoryColumns+` FROM categories
		 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, id, userID)
	c, err := scanCategory(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Category{}, ErrNotFound
	}
	if err != nil {
		return domain.Category{}, fmt.Errorf("loading category: %w", err)
	}
	return c, nil
}

// CreateCategory inserts the category at the end of the list and sets its ID,
// position and timestamps.
func (s *Store) CreateCategory(ctx context.Context, userID string, c *domain.Category) error {
	now := time.Now().UTC()
	c.ID = NewID()
	c.CreatedAt, c.UpdatedAt = now, now
	if err := c.Validate(); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	var next sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(position) FROM categories WHERE user_id = ? AND deleted_at IS NULL`, userID,
	).Scan(&next); err != nil {
		return fmt.Errorf("determining position: %w", err)
	}
	c.Position = int(next.Int64) + 1

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO categories (id, user_id, name, icon, color, show_progress, position, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		c.ID, userID, c.Name, c.Icon, c.Color, c.ShowProgress, c.Position, formatTime(c.CreatedAt), formatTime(c.UpdatedAt)); err != nil {
		return fmt.Errorf("creating category: %w", err)
	}
	return tx.Commit()
}

// UpdateCategory updates all fields except the position.
func (s *Store) UpdateCategory(ctx context.Context, userID string, c *domain.Category) error {
	c.UpdatedAt = time.Now().UTC()
	if err := c.Validate(); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE categories SET name = ?, icon = ?, color = ?, show_progress = ?, updated_at = ?
		 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		c.Name, c.Icon, c.Color, c.ShowProgress, formatTime(c.UpdatedAt), c.ID, userID)
	if err != nil {
		return fmt.Errorf("updating category: %w", err)
	}
	return expectOneRow(res)
}

// SoftDeleteCategory marks the category as deleted. Its habits keep their
// category ID and are shown as uncategorised until it is restored.
func (s *Store) SoftDeleteCategory(ctx context.Context, userID, id string) error {
	now := formatTime(time.Now())
	res, err := s.db.ExecContext(ctx,
		`UPDATE categories SET deleted_at = ?, updated_at = ?
		 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, now, now, id, userID)
	if err != nil {
		return fmt.Errorf("deleting category: %w", err)
	}
	return expectOneRow(res)
}

// RestoreCategory restores a soft-deleted category.
func (s *Store) RestoreCategory(ctx context.Context, userID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE categories SET deleted_at = NULL, updated_at = ?
		 WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
		formatTime(time.Now()), id, userID)
	if err != nil {
		return fmt.Errorf("restoring category: %w", err)
	}
	return expectOneRow(res)
}

// ReorderCategories sets the display order of the user's categories (see
// reorder).
func (s *Store) ReorderCategories(ctx context.Context, userID string, ids []string) error {
	return s.reorder(ctx, "categories", userID, ids, true)
}

// PurgeDeletedCategories permanently removes categories deleted more than
// olderThan ago and returns their number. Their habits become uncategorised.
func (s *Store) PurgeDeletedCategories(ctx context.Context, olderThan time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM categories WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
		formatTime(time.Now().Add(-olderThan)))
	if err != nil {
		return 0, fmt.Errorf("purging deleted categories: %w", err)
	}
	return res.RowsAffected()
}
