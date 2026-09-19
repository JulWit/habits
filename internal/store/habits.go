package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

const habitColumns = `id, name, color, kind, target_value, step_value, unit,
	freq_kind, freq_times_per_week, freq_weekdays, freq_interval_days, freq_anchor_date,
	position, archived_at, created_at, updated_at, category_id`

func scanHabit(rows interface{ Scan(...any) error }) (domain.Habit, error) {
	var (
		h          domain.Habit
		anchor     string
		archivedAt sql.NullString
		categoryID sql.NullString
		created    string
		updated    string
		weekdays   int64
	)
	err := rows.Scan(
		&h.ID, &h.Name, &h.Color, &h.Kind, &h.TargetValue, &h.StepValue, &h.Unit,
		&h.Frequency.Kind, &h.Frequency.TimesPerWeek, &weekdays, &h.Frequency.IntervalDays, &anchor,
		&h.Position, &archivedAt, &created, &updated, &categoryID,
	)
	if err != nil {
		return domain.Habit{}, err
	}
	h.Frequency.Weekdays = domain.Weekdays(weekdays)
	h.CategoryID = categoryID.String
	if anchor != "" {
		if h.Frequency.AnchorDate, err = domain.ParseDate(anchor); err != nil {
			return domain.Habit{}, fmt.Errorf("habit %s: anker-datum: %w", h.ID, err)
		}
	}
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

// ListHabits returns the user's habits in display order. Soft-deleted habits
// are always excluded; they exist only so a deletion can be undone.
func (s *Store) ListHabits(ctx context.Context, userID string, includeArchived bool) ([]domain.Habit, error) {
	query := `SELECT ` + habitColumns + `
		FROM habits
		WHERE user_id = ? AND deleted_at IS NULL`
	if !includeArchived {
		query += ` AND archived_at IS NULL`
	}
	query += ` ORDER BY position, created_at`

	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("habits laden: %w", err)
	}
	defer rows.Close()

	habits := []domain.Habit{}
	for rows.Next() {
		h, err := scanHabit(rows)
		if err != nil {
			return nil, err
		}
		habits = append(habits, h)
	}
	return habits, rows.Err()
}

func (s *Store) GetHabit(ctx context.Context, userID, id string) (domain.Habit, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+habitColumns+` FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		id, userID)
	h, err := scanHabit(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Habit{}, ErrNotFound
	}
	if err != nil {
		return domain.Habit{}, fmt.Errorf("habit laden: %w", err)
	}
	return h, nil
}

// CreateHabit inserts the habit and assigns it the next free position, so new
// habits appear at the bottom of the list.
func (s *Store) CreateHabit(ctx context.Context, userID string, h *domain.Habit) error {
	now := time.Now().UTC()
	h.ID = NewID()
	h.CreatedAt, h.UpdatedAt = now, now
	if err := h.Validate(); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("transaktion starten: %w", err)
	}
	defer tx.Rollback()

	var next sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(position) FROM habits WHERE user_id = ? AND deleted_at IS NULL`, userID,
	).Scan(&next); err != nil {
		return fmt.Errorf("position bestimmen: %w", err)
	}
	h.Position = int(next.Int64) + 1

	if err := s.requireOwnCategory(ctx, tx, userID, h.CategoryID); err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO habits (id, user_id, name, color, kind, target_value, step_value, unit,
			freq_kind, freq_times_per_week, freq_weekdays, freq_interval_days, freq_anchor_date,
			position, created_at, updated_at, category_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		h.ID, userID, h.Name, h.Color, h.Kind, h.TargetValue, h.StepValue, h.Unit,
		h.Frequency.Kind, h.Frequency.TimesPerWeek, int64(h.Frequency.Weekdays),
		h.Frequency.IntervalDays, h.Frequency.AnchorDate.String(),
		h.Position, formatTime(h.CreatedAt), formatTime(h.UpdatedAt), nullableID(h.CategoryID))
	if err != nil {
		return fmt.Errorf("habit anlegen: %w", err)
	}
	return tx.Commit()
}

// requireOwnCategory rejects a habit pointing at a category that is not the
// user's own. Without it a client could file its habit under someone else's
// category and learn whether that id exists.
func (s *Store) requireOwnCategory(ctx context.Context, q queryer, userID, categoryID string) error {
	ok, err := s.categoryBelongsTo(ctx, q, userID, categoryID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%w: unbekannte Kategorie", domain.ErrValidation)
	}
	return nil
}

// nullableID maps the empty id to SQL NULL, so "no category" is an absent
// reference rather than an empty string that no foreign key could satisfy.
func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

// UpdateHabit writes the mutable fields. Position is not touched here; ordering
// is changed through ReorderHabits so a rename cannot reshuffle the list.
//
// The whole update runs in one transaction: the category check and the kind
// check both read rows the write then depends on, and between a bare read and a
// bare write either could stop being true.
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
		return fmt.Errorf("transaktion starten: %w", err)
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
			name = ?, color = ?, kind = ?, target_value = ?, step_value = ?, unit = ?,
			freq_kind = ?, freq_times_per_week = ?, freq_weekdays = ?,
			freq_interval_days = ?, freq_anchor_date = ?,
			archived_at = ?, updated_at = ?, category_id = ?
		WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		h.Name, h.Color, h.Kind, h.TargetValue, h.StepValue, h.Unit,
		h.Frequency.Kind, h.Frequency.TimesPerWeek, int64(h.Frequency.Weekdays),
		h.Frequency.IntervalDays, h.Frequency.AnchorDate.String(),
		archived, formatTime(h.UpdatedAt), nullableID(h.CategoryID),
		h.ID, userID)
	if err != nil {
		return fmt.Errorf("habit aktualisieren: %w", err)
	}
	if err := expectOneRow(res); err != nil {
		return err
	}
	return tx.Commit()
}

// requireKindKeepsHistoryMeaningful refuses to change the kind of a habit that
// already has entries.
//
// Every kind stores a plain integer per day, but they are not the same integer:
// 5000 is five kilometres to a distance and five hundred repetitions to a count.
// Rewriting the kind alone would silently reinterpret the whole history, and
// there is no honest conversion between the two — so the change is refused
// while there is a history to misread. A habit without entries can still be
// corrected freely, which is when people actually do it.
func (s *Store) requireKindKeepsHistoryMeaningful(ctx context.Context, q queryer, userID string, h *domain.Habit) error {
	var current domain.Kind
	err := q.QueryRowContext(ctx,
		`SELECT kind FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		h.ID, userID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("bisherigen typ lesen: %w", err)
	}
	if current == h.Kind {
		return nil
	}

	var entries int
	if err := q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM entries WHERE habit_id = ?`, h.ID).Scan(&entries); err != nil {
		return fmt.Errorf("einträge zählen: %w", err)
	}
	if entries > 0 {
		return invalidf(
			"Der Typ lässt sich nicht mehr ändern: es sind schon %d Tage erfasst, "+
				"deren Werte als „%s“ etwas anderes bedeuten würden. "+
				"Lege stattdessen eine neue Gewohnheit an.",
			entries, h.Kind.Label())
	}
	return nil
}

// SoftDeleteHabit hides the habit but keeps the row, which is what makes the
// "Rückgängig" toast able to bring it back with its whole history intact.
func (s *Store) SoftDeleteHabit(ctx context.Context, userID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		formatTime(time.Now()), formatTime(time.Now()), id, userID)
	if err != nil {
		return fmt.Errorf("habit löschen: %w", err)
	}
	return expectOneRow(res)
}

func (s *Store) RestoreHabit(ctx context.Context, userID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE habits SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
		formatTime(time.Now()), id, userID)
	if err != nil {
		return fmt.Errorf("habit wiederherstellen: %w", err)
	}
	return expectOneRow(res)
}

// ReorderHabits applies a new display order. IDs not belonging to the user are
// ignored by the WHERE clause rather than rejected, so a stale client cannot
// fail the whole request.
func (s *Store) ReorderHabits(ctx context.Context, userID string, ids []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("transaktion starten: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`UPDATE habits SET position = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
	if err != nil {
		return fmt.Errorf("reihenfolge vorbereiten: %w", err)
	}
	defer stmt.Close()

	now := formatTime(time.Now())
	for i, id := range ids {
		if _, err := stmt.ExecContext(ctx, i, now, id, userID); err != nil {
			return fmt.Errorf("reihenfolge speichern: %w", err)
		}
	}
	return tx.Commit()
}

// PurgeDeleted removes soft-deleted habits past the undo retention window,
// together with their entries via ON DELETE CASCADE.
func (s *Store) PurgeDeleted(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := formatTime(time.Now().Add(-olderThan))
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM habits WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("gelöschte habits aufräumen: %w", err)
	}
	return res.RowsAffected()
}

func expectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("betroffene zeilen: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountArchivedHabits reports how many archived habits the user has. The
// overview needs it to decide whether an "show archived" control is worth
// showing at all — a toggle that can never reveal anything is just noise.
func (s *Store) CountArchivedHabits(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM habits
		 WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
		userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("archivierte habits zählen: %w", err)
	}
	return n, nil
}
