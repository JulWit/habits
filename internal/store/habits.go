package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

const habitColumns = `id, name, color, icon, kind, step_value, unit,
	position, archived_at, created_at, updated_at, category_id`

// scanHabit scans a row selected with habitColumns.
func scanHabit(row interface{ Scan(...any) error }) (domain.Habit, error) {
	var (
		h          domain.Habit
		archivedAt sql.NullString
		categoryID sql.NullString
		created    string
		updated    string
	)
	err := row.Scan(
		&h.ID, &h.Name, &h.Color, &h.Icon, &h.Kind, &h.StepValue, &h.Unit,
		&h.Position, &archivedAt, &created, &updated, &categoryID,
	)
	if err != nil {
		return domain.Habit{}, err
	}
	h.CategoryID = categoryID.String
	if h.CreatedAt, err = parseTime(created); err != nil {
		return domain.Habit{}, fmt.Errorf("habit %s: created_at: %w", h.ID, err)
	}
	if h.UpdatedAt, err = parseTime(updated); err != nil {
		return domain.Habit{}, fmt.Errorf("habit %s: updated_at: %w", h.ID, err)
	}
	if archivedAt.Valid {
		t, err := parseTime(archivedAt.String)
		if err != nil {
			return domain.Habit{}, fmt.Errorf("habit %s: archived_at: %w", h.ID, err)
		}
		h.ArchivedAt = &t
	}
	return h, nil
}

// ListHabits returns the user's habits in display order, excluding deleted
// habits.
func (s *Store) ListHabits(ctx context.Context, userID string, includeArchived bool) ([]domain.Habit, error) {
	query := `SELECT ` + habitColumns + `
		FROM habits
		WHERE user_id = ? AND deleted_at IS NULL`
	if !includeArchived {
		query += ` AND archived_at IS NULL`
	}
	query += ` ORDER BY position, created_at`

	// Loaded first: the pool has a single connection, so the habit rows must be
	// closed before the next query.
	schedules, err := s.schedulesOfUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("loading habits: %w", err)
	}
	defer rows.Close()

	habits := []domain.Habit{}
	for rows.Next() {
		h, err := scanHabit(rows)
		if err != nil {
			return nil, err
		}
		h.Schedules = schedules[h.ID]
		if len(h.Schedules) == 0 {
			return nil, fmt.Errorf("habit %s has no schedule", h.ID)
		}
		habits = append(habits, h)
	}
	return habits, rows.Err()
}

// GetHabit returns a habit of the user, or ErrNotFound.
func (s *Store) GetHabit(ctx context.Context, userID, id string) (domain.Habit, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+habitColumns+` FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		id, userID)
	h, err := scanHabit(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Habit{}, ErrNotFound
	}
	if err != nil {
		return domain.Habit{}, fmt.Errorf("loading habit: %w", err)
	}
	if h.Schedules, err = s.schedulesOfHabit(ctx, h.ID); err != nil {
		return domain.Habit{}, err
	}
	if len(h.Schedules) == 0 {
		return domain.Habit{}, fmt.Errorf("habit %s has no schedule", h.ID)
	}
	return h, nil
}

// CreateHabit inserts the habit at the end of the list and sets its ID,
// position and timestamps.
func (s *Store) CreateHabit(ctx context.Context, userID string, h *domain.Habit) error {
	now := time.Now().UTC()
	h.ID = NewID()
	h.CreatedAt, h.UpdatedAt = now, now
	if err := h.Validate(); err != nil {
		return err
	}

	return s.inTx(ctx, "creating habit", func(tx *sql.Tx) error {
		if err := ensureUser(ctx, tx, userID); err != nil {
			return err
		}
		return insertHabit(ctx, tx, userID, h)
	})
}

// insertHabit inserts the validated habit h, whose ID and timestamps are set,
// at the end of the user's list and sets its position.
func insertHabit(ctx context.Context, tx *sql.Tx, userID string, h *domain.Habit) error {
	var last sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(position) FROM habits WHERE user_id = ? AND deleted_at IS NULL`, userID,
	).Scan(&last); err != nil {
		return err
	}
	h.Position = int(last.Int64) + 1

	if err := requireOwnCategory(ctx, tx, userID, h.CategoryID); err != nil {
		return err
	}
	var archivedAt any
	if h.ArchivedAt != nil {
		archivedAt = formatTime(*h.ArchivedAt)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO habits (id, user_id, name, color, icon, kind, step_value, unit,
			position, archived_at, created_at, updated_at, category_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		h.ID, userID, h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
		h.Position, archivedAt, formatTime(h.CreatedAt), formatTime(h.UpdatedAt), nullableID(h.CategoryID),
	); err != nil {
		return err
	}
	return saveSchedules(ctx, tx, h)
}

// UpdateHabit updates all fields except the position (see ReorderHabits).
// Unless entries is nil, it also replaces all entries of the habit with
// entries, e.g. with the history converted to a new kind (see
// domain.ConvertKind).
func (s *Store) UpdateHabit(ctx context.Context, userID string, h *domain.Habit, entries map[domain.Date]domain.Entry) error {
	h.UpdatedAt = time.Now().UTC()
	if err := h.Validate(); err != nil {
		return err
	}
	var archivedAt any
	if h.ArchivedAt != nil {
		archivedAt = formatTime(*h.ArchivedAt)
	}

	return s.inTx(ctx, "updating habit", func(tx *sql.Tx) error {
		if err := requireOwnCategory(ctx, tx, userID, h.CategoryID); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE habits SET
				name = ?, color = ?, icon = ?, kind = ?, step_value = ?, unit = ?,
				archived_at = ?, updated_at = ?, category_id = ?
			WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
			h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
			archivedAt, formatTime(h.UpdatedAt), nullableID(h.CategoryID),
			h.ID, userID)
		if err != nil {
			return err
		}
		if err := expectOneRow(res); err != nil {
			return err
		}
		if err := saveSchedules(ctx, tx, h); err != nil {
			return err
		}
		if entries == nil {
			return nil
		}
		return replaceEntries(ctx, tx, h, entries)
	})
}

// requireOwnCategory returns a validation error if categoryID is not "" and
// not a category of the user.
func requireOwnCategory(ctx context.Context, tx *sql.Tx, userID, categoryID string) error {
	if categoryID == "" {
		return nil
	}
	var found string
	err := tx.QueryRowContext(ctx,
		`SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		categoryID, userID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invalid("unknown_category", "unknown category")
	}
	return err
}

// nullableID maps "" to NULL.
func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

// replaceEntries replaces all entries of the habit.
func replaceEntries(ctx context.Context, tx *sql.Tx, h *domain.Habit, entries map[domain.Date]domain.Entry) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM entries WHERE habit_id = ?`, h.ID); err != nil {
		return err
	}
	now := formatTime(time.Now())
	for d, e := range entries {
		if err := e.Validate(h.Kind); err != nil {
			return err
		}
		if err := writeEntry(ctx, tx, h.ID, d, e, now); err != nil {
			return err
		}
	}
	return nil
}

// SoftDeleteHabit marks the habit as deleted. It can be restored with
// RestoreHabit until PurgeDeleted removes it.
func (s *Store) SoftDeleteHabit(ctx context.Context, userID, id string) error {
	now := formatTime(time.Now())
	res, err := s.db.ExecContext(ctx,
		`UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		now, now, id, userID)
	if err != nil {
		return fmt.Errorf("deleting habit: %w", err)
	}
	return expectOneRow(res)
}

// RestoreHabit restores a soft-deleted habit.
func (s *Store) RestoreHabit(ctx context.Context, userID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE habits SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
		formatTime(time.Now()), id, userID)
	if err != nil {
		return fmt.Errorf("restoring habit: %w", err)
	}
	return expectOneRow(res)
}

// ReorderHabits sets the display order of the user's habits (see reorder).
func (s *Store) ReorderHabits(ctx context.Context, userID string, ids []string) error {
	return s.reorder(ctx, "habits", userID, ids)
}

// PurgeDeleted permanently removes habits deleted more than olderThan ago,
// including their entries, and returns their number.
func (s *Store) PurgeDeleted(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := formatTime(time.Now().Add(-olderThan))
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM habits WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purging deleted habits: %w", err)
	}
	return res.RowsAffected()
}

// expectOneRow returns ErrNotFound if res affected no rows.
func expectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("affected rows: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountArchivedHabits returns the number of archived habits of the user.
func (s *Store) CountArchivedHabits(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM habits
		 WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
		userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("counting archived habits: %w", err)
	}
	return n, nil
}
