package store

import (
	"database/sql"
	"errors"
	"fmt"

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

// Categories returns the user's categories in display order.
func (t *Tx) Categories() ([]domain.Category, error) {
	rows, err := t.query(`SELECT `+categoryColumns+` FROM categories
		WHERE user_id = ? ORDER BY position, created_at`, t.userID)
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

// Category returns a category of the user, or ErrNotFound.
func (t *Tx) Category(id string) (domain.Category, error) {
	c, err := scanCategory(t.queryRow(
		`SELECT `+categoryColumns+` FROM categories WHERE id = ? AND user_id = ?`, id, t.userID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Category{}, ErrNotFound
	}
	if err != nil {
		return domain.Category{}, fmt.Errorf("loading category: %w", err)
	}
	return c, nil
}

// CreateCategory validates the category and inserts it at the end of the
// user's list, with a new ID, its position and timestamps.
func (t *Tx) CreateCategory(c *domain.Category) error {
	c.ID = NewID()
	c.CreatedAt, c.UpdatedAt = t.now, t.now
	if err := c.Validate(); err != nil {
		return err
	}
	var last sql.NullInt64
	if err := t.queryRow(`SELECT MAX(position) FROM categories WHERE user_id = ?`, t.userID).Scan(&last); err != nil {
		return err
	}
	c.Position = int(last.Int64) + 1

	if err := t.watch("categories", "id = ?", c.ID); err != nil {
		return err
	}
	_, err := t.exec(`
		INSERT INTO categories (id, user_id, name, icon, color, show_progress, position, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		c.ID, t.userID, c.Name, c.Icon, c.Color, c.ShowProgress, c.Position,
		formatTime(c.CreatedAt), formatTime(c.UpdatedAt))
	return err
}

// SaveCategory validates the category and stores all its fields except the
// position (see ReorderCategories).
func (t *Tx) SaveCategory(c *domain.Category) error {
	c.UpdatedAt = t.now
	if err := c.Validate(); err != nil {
		return err
	}
	if err := t.watch("categories", "id = ?", c.ID); err != nil {
		return err
	}
	res, err := t.exec(`
		UPDATE categories SET name = ?, icon = ?, color = ?, show_progress = ?, updated_at = ?
		WHERE id = ? AND user_id = ?`,
		c.Name, c.Icon, c.Color, c.ShowProgress, formatTime(c.UpdatedAt), c.ID, t.userID)
	if err != nil {
		return fmt.Errorf("updating category: %w", err)
	}
	return expectOneRow(res)
}

// DeleteCategory removes a category of the user. Its habits stay, without a
// category; undoing the step puts them back into it.
func (t *Tx) DeleteCategory(id string) error {
	if err := errors.Join(
		t.watch("categories", "id = ? AND user_id = ?", id, t.userID),
		t.watch("habits", "category_id = ?", id),
	); err != nil {
		return err
	}
	res, err := t.exec(`DELETE FROM categories WHERE id = ? AND user_id = ?`, id, t.userID)
	if err != nil {
		return fmt.Errorf("deleting category: %w", err)
	}
	return expectOneRow(res)
}

// ReorderCategories sets the display order of the user's categories (see
// reorder).
func (t *Tx) ReorderCategories(ids []string) error {
	return t.reorder("categories", ids)
}
