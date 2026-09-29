package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/JulWit/habits/internal/domain"
)

const scheduleColumns = `s.habit_id, s.valid_from, s.target_value, s.target_type,
	s.freq_kind, s.freq_times_per_week, s.freq_times_per_month, s.freq_weekdays, s.freq_interval_days,
	s.freq_week_interval, s.freq_week_of_month, s.freq_anchor_date`

// schedulesOfUser returns the schedules of the user's habits, oldest first,
// keyed by habit ID.
func (t *Tx) schedulesOfUser(ctx context.Context) (map[string][]domain.Schedule, error) {
	rows, err := t.query(ctx, `SELECT `+scheduleColumns+`
		FROM habit_schedules s JOIN habits h ON h.id = s.habit_id
		WHERE h.user_id = ?
		ORDER BY s.habit_id, s.valid_from`, t.userID)
	if err != nil {
		return nil, fmt.Errorf("loading schedules: %w", err)
	}
	defer rows.Close()
	return collectSchedules(rows)
}

// schedulesOfHabit returns the schedules of a habit, oldest first.
func (t *Tx) schedulesOfHabit(ctx context.Context, habitID string) ([]domain.Schedule, error) {
	rows, err := t.query(ctx, `SELECT `+scheduleColumns+`
		FROM habit_schedules s WHERE s.habit_id = ? ORDER BY s.valid_from`, habitID)
	if err != nil {
		return nil, fmt.Errorf("loading schedules: %w", err)
	}
	defer rows.Close()
	byHabit, err := collectSchedules(rows)
	if err != nil {
		return nil, err
	}
	return byHabit[habitID], nil
}

// collectSchedules reads rows selected with scheduleColumns.
func collectSchedules(rows *sql.Rows) (map[string][]domain.Schedule, error) {
	out := map[string][]domain.Schedule{}
	for rows.Next() {
		var (
			habitID  string
			from     string
			anchor   string
			weekdays int64
			sc       domain.Schedule
		)
		f := &sc.Frequency
		err := rows.Scan(&habitID, &from, &sc.TargetValue, &sc.TargetType,
			&f.Kind, &f.TimesPerWeek, &f.TimesPerMonth, &weekdays, &f.IntervalDays,
			&f.WeekInterval, &f.WeekOfMonth, &anchor)
		if err != nil {
			return nil, fmt.Errorf("reading schedule: %w", err)
		}
		f.Weekdays = domain.Weekdays(weekdays)
		if sc.From, err = domain.ParseDate(from); err != nil {
			return nil, fmt.Errorf("schedule of habit %s: %w", habitID, err)
		}
		if anchor != "" {
			if f.AnchorDate, err = domain.ParseDate(anchor); err != nil {
				return nil, fmt.Errorf("schedule of habit %s: anchor date: %w", habitID, err)
			}
		}
		out[habitID] = append(out[habitID], sc)
	}
	return out, rows.Err()
}

// saveSchedules replaces the stored schedules of the habit with h.Schedules.
func (t *Tx) saveSchedules(ctx context.Context, h *domain.Habit) error {
	if err := t.watch(ctx, "habit_schedules", "habit_id = ?", h.ID); err != nil {
		return err
	}
	if _, err := t.exec(ctx, `DELETE FROM habit_schedules WHERE habit_id = ?`, h.ID); err != nil {
		return fmt.Errorf("replacing schedules: %w", err)
	}
	for _, sc := range h.Schedules {
		f := sc.Frequency
		if _, err := t.exec(ctx, `
			INSERT INTO habit_schedules (habit_id, valid_from, target_value, target_type,
				freq_kind, freq_times_per_week, freq_times_per_month, freq_weekdays, freq_interval_days,
				freq_week_interval, freq_week_of_month, freq_anchor_date)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			h.ID, sc.From.String(), sc.TargetValue, sc.TargetType,
			f.Kind, f.TimesPerWeek, f.TimesPerMonth, int64(f.Weekdays), f.IntervalDays,
			f.WeekInterval, f.WeekOfMonth, f.AnchorDate.String()); err != nil {
			return fmt.Errorf("saving schedule: %w", err)
		}
	}
	return nil
}
