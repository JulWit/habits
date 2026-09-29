package store

import (
	"database/sql"
	"errors"
	"fmt"

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

// Habits returns the user's habits in display order, archived ones only with
// includeArchived.
func (t *Tx) Habits(includeArchived bool) ([]domain.Habit, error) {
	query := `SELECT ` + habitColumns + ` FROM habits WHERE user_id = ?`
	if !includeArchived {
		query += ` AND archived_at IS NULL`
	}
	query += ` ORDER BY position, created_at`

	schedules, err := t.schedulesOfUser()
	if err != nil {
		return nil, err
	}
	rows, err := t.query(query, t.userID)
	if err != nil {
		return nil, fmt.Errorf("loading habits: %w", err)
	}
	defer rows.Close()

	// Not nil, so that the API sends [] for a user without habits.
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

// Habit returns a habit of the user, or ErrNotFound.
func (t *Tx) Habit(id string) (domain.Habit, error) {
	h, err := scanHabit(t.queryRow(
		`SELECT `+habitColumns+` FROM habits WHERE id = ? AND user_id = ?`, id, t.userID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Habit{}, ErrNotFound
	}
	if err != nil {
		return domain.Habit{}, fmt.Errorf("loading habit: %w", err)
	}
	if h.Schedules, err = t.schedulesOfHabit(h.ID); err != nil {
		return domain.Habit{}, err
	}
	if len(h.Schedules) == 0 {
		return domain.Habit{}, fmt.Errorf("habit %s has no schedule", h.ID)
	}
	return h, nil
}

// CreateHabit validates the habit and inserts it at the end of the user's
// list, with a new ID, its position and timestamps; a creation time already
// set is kept.
func (t *Tx) CreateHabit(h *domain.Habit) error {
	h.ID = NewID()
	// An imported habit keeps the day it was created on.
	if h.CreatedAt.IsZero() {
		h.CreatedAt = t.now
	}
	h.UpdatedAt = t.now
	if err := h.Validate(); err != nil {
		return err
	}
	if err := t.requireOwnCategory(h.CategoryID); err != nil {
		return err
	}
	var last sql.NullInt64
	if err := t.queryRow(`SELECT MAX(position) FROM habits WHERE user_id = ?`, t.userID).Scan(&last); err != nil {
		return err
	}
	h.Position = int(last.Int64) + 1

	if err := t.watch("habits", "id = ?", h.ID); err != nil {
		return err
	}
	if _, err := t.exec(`
		INSERT INTO habits (id, user_id, name, color, icon, kind, step_value, unit,
			position, archived_at, created_at, updated_at, category_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		h.ID, t.userID, h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
		h.Position, archivedAt(h), formatTime(h.CreatedAt), formatTime(h.UpdatedAt), nullableID(h.CategoryID),
	); err != nil {
		return err
	}
	return t.saveSchedules(h)
}

// SaveHabit validates the habit and stores all its fields except the
// position (see ReorderHabits), with its schedules.
func (t *Tx) SaveHabit(h *domain.Habit) error {
	h.UpdatedAt = t.now
	if err := h.Validate(); err != nil {
		return err
	}
	if err := t.requireOwnCategory(h.CategoryID); err != nil {
		return err
	}
	if err := t.watch("habits", "id = ?", h.ID); err != nil {
		return err
	}
	res, err := t.exec(`
		UPDATE habits SET
			name = ?, color = ?, icon = ?, kind = ?, step_value = ?, unit = ?,
			archived_at = ?, updated_at = ?, category_id = ?
		WHERE id = ? AND user_id = ?`,
		h.Name, h.Color, h.Icon, h.Kind, h.StepValue, h.Unit,
		archivedAt(h), formatTime(h.UpdatedAt), nullableID(h.CategoryID),
		h.ID, t.userID)
	if err != nil {
		return err
	}
	if err := expectOneRow(res); err != nil {
		return err
	}
	return t.saveSchedules(h)
}

// archivedAt returns the archive time of h for storage, or NULL.
func archivedAt(h *domain.Habit) any {
	if h.ArchivedAt == nil {
		return nil
	}
	return formatTime(*h.ArchivedAt)
}

// DeleteHabit removes a habit of the user with its schedules and entries.
// Undoing the step brings them back.
func (t *Tx) DeleteHabit(id string) error {
	if err := errors.Join(
		t.watch("habits", "id = ? AND user_id = ?", id, t.userID),
		t.watch("habit_schedules", "habit_id = ?", id),
		t.watch("entries", "habit_id = ?", id),
	); err != nil {
		return err
	}
	res, err := t.exec(`DELETE FROM habits WHERE id = ? AND user_id = ?`, id, t.userID)
	if err != nil {
		return fmt.Errorf("deleting habit: %w", err)
	}
	return expectOneRow(res)
}

// requireOwnCategory returns a validation error if categoryID is not "" and
// not a category of the user.
func (t *Tx) requireOwnCategory(categoryID string) error {
	if categoryID == "" {
		return nil
	}
	_, err := t.Category(categoryID)
	if errors.Is(err, ErrNotFound) {
		return domain.Invalid("unknown_category", "unknown category")
	}
	return err
}

// ReorderHabits sets the display order of the user's habits (see reorder).
func (t *Tx) ReorderHabits(ids []string) error {
	return t.reorder("habits", ids)
}
