package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

const categoryColumns = `id, name, position, created_at, updated_at`

func scanCategory(row interface{ Scan(...any) error }) (domain.Category, error) {
	var (
		c       domain.Category
		created string
		updated string
	)
	if err := row.Scan(&c.ID, &c.Name, &c.Position, &created, &updated); err != nil {
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

// ListCategories returns the user's categories in display order. Soft-deleted
// ones are excluded; they exist only so a deletion can be undone.
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
		`INSERT INTO categories (id, user_id, name, position, created_at, updated_at)
		 VALUES (?,?,?,?,?,?)`,
		c.ID, userID, c.Name, c.Position, formatTime(c.CreatedAt), formatTime(c.UpdatedAt)); err != nil {
		return fmt.Errorf("creating category: %w", err)
	}
	return tx.Commit()
}

func (s *Store) UpdateCategory(ctx context.Context, userID string, c *domain.Category) error {
	c.UpdatedAt = time.Now().UTC()
	if err := c.Validate(); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE categories SET name = ?, updated_at = ?
		 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		c.Name, formatTime(c.UpdatedAt), c.ID, userID)
	if err != nil {
		return fmt.Errorf("updating category: %w", err)
	}
	return expectOneRow(res)
}

// SoftDeleteCategory hides the category. Its habits keep their category_id and
// simply render as uncategorised, so restoring the category puts the block back
// together exactly as it was.
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

func (s *Store) ReorderCategories(ctx context.Context, userID string, ids []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`UPDATE categories SET position = ?, updated_at = ?
		 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
	if err != nil {
		return fmt.Errorf("preparing reorder: %w", err)
	}
	defer stmt.Close()

	now := formatTime(time.Now())
	for i, id := range ids {
		if _, err := stmt.ExecContext(ctx, i, now, id, userID); err != nil {
			return fmt.Errorf("saving order: %w", err)
		}
	}
	return tx.Commit()
}

// PurgeDeletedCategories removes categories past the undo retention window. The
// ON DELETE SET NULL on habits.category_id then detaches their habits for good.
func (s *Store) PurgeDeletedCategories(ctx context.Context, olderThan time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM categories WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
		formatTime(time.Now().Add(-olderThan)))
	if err != nil {
		return 0, fmt.Errorf("purging deleted categories: %w", err)
	}
	return res.RowsAffected()
}

// categoryBelongsTo reports whether the id names a live category of the user.
// An empty id means "no category" and is always acceptable.
func (s *Store) categoryBelongsTo(ctx context.Context, q queryer, userID, categoryID string) (bool, error) {
	if categoryID == "" {
		return true, nil
	}
	var found string
	err := q.QueryRowContext(ctx,
		`SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		categoryID, userID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking category: %w", err)
	}
	return true, nil
}

// queryer is satisfied by both *sql.DB and *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
