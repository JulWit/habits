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
func scanHabit(rows interface{ Scan(...any) error }) (domain.Habit, error) {
	var (
		h          domain.Habit
		archivedAt sql.NullString
		categoryID sql.NullString
		created    string
		updated    string
	)
	err := rows.Scan(
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
	if h.ArchivedAt, err = nullableTime(archivedAt); err != nil {
		return domain.Habit{}, fmt.Errorf("habit %s: archived_at: %w", h.ID, err)
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
		h.SetSchedules(schedules[h.ID])
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
	schedules, err := s.schedulesOfHabit(ctx, h.ID)
	if err != nil {
		return domain.Habit{}, err
	}
	h.SetSchedules(schedules)
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	var next sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(position) FROM habits WHERE user_id = ? AND deleted_at IS NULL`, userID,
	).Scan(&next); err != nil {
		return fmt.Errorf("determining position: %w", err)
	}
	h.Position = int(next.Int64) + 1

	if err := ensureUser(ctx, tx, userID); err != nil {
		return err
	}
	if err := s.requireOwnCategory(ctx, tx, userID, h.CategoryID); err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO habits (id, user_id, name, color, icon, kind, step_value, unit,
			position, created_at, updated_at, category_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		h.ID, userID, h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
		h.Position, formatTime(h.CreatedAt), formatTime(h.UpdatedAt), nullableID(h.CategoryID))
	if err != nil {
		return fmt.Errorf("creating habit: %w", err)
	}
	if err := saveSchedules(ctx, tx, h); err != nil {
		return err
	}
	return tx.Commit()
}

// requireOwnCategory returns a validation error if categoryID is not "" and
// not a category of the user.
func (s *Store) requireOwnCategory(ctx context.Context, q queryer, userID, categoryID string) error {
	if categoryID == "" {
		return nil
	}
	var found string
	err := q.QueryRowContext(ctx,
		`SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		categoryID, userID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invalid("unknown_category", "unknown category")
	}
	if err != nil {
		return fmt.Errorf("checking category: %w", err)
	}
	return nil
}

// nullableID maps "" to NULL.
func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

// UpdateHabit updates all fields except the position (see ReorderHabits).
func (s *Store) UpdateHabit(ctx context.Context, userID string, h *domain.Habit) error {
	h.UpdatedAt = time.Now().UTC()
	if err := h.Validate(); err != nil {
		return err
	}
	var archived any
	if h.ArchivedAt != nil {
		archived = formatTime(*h.ArchivedAt)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	if err := s.requireOwnCategory(ctx, tx, userID, h.CategoryID); err != nil {
		return err
	}
	if err := s.requireKindKeepsHistoryMeaningful(ctx, tx, userID, h); err != nil {
		return err
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE habits SET
			name = ?, color = ?, icon = ?, kind = ?, step_value = ?, unit = ?,
			archived_at = ?, updated_at = ?, category_id = ?
		WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
		archived, formatTime(h.UpdatedAt), nullableID(h.CategoryID),
		h.ID, userID)
	if err != nil {
		return fmt.Errorf("updating habit: %w", err)
	}
	if err := expectOneRow(res); err != nil {
		return err
	}
	if err := saveSchedules(ctx, tx, h); err != nil {
		return err
	}
	return tx.Commit()
}

// requireKindKeepsHistoryMeaningful returns a validation error if the kind of a
// habit with entries is changed, since stored values depend on the kind.
func (s *Store) requireKindKeepsHistoryMeaningful(ctx context.Context, q queryer, userID string, h *domain.Habit) error {
	var current domain.Kind
	err := q.QueryRowContext(ctx,
		`SELECT kind FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		h.ID, userID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading current kind: %w", err)
	}
	if current == h.Kind {
		return nil
	}

	var entries int
	if err := q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM entries WHERE habit_id = ?`, h.ID).Scan(&entries); err != nil {
		return fmt.Errorf("counting entries: %w", err)
	}
	if entries > 0 {
		// Separate templates for singular and plural.
		if entries == 1 {
			return domain.Invalid("kind_locked_one", `The kind can no longer be changed: 1 day is already recorded, `+
				`and its value would mean something else as "{kind}". Create a new habit instead.`,
				"kind", h.Kind.Label())
		}
		return domain.Invalid("kind_locked", `The kind can no longer be changed: {count} days are already recorded, `+
			`and their values would mean something else as "{kind}". Create a new habit instead.`,
			"count", entries, "kind", h.Kind.Label())
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

// ReorderHabits sets the display order of the user's habits (see reorder). It
// does not change updated_at.
func (s *Store) ReorderHabits(ctx context.Context, userID string, ids []string) error {
	return s.reorder(ctx, "habits", userID, ids, false)
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
