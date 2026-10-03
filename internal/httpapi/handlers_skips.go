package httpapi

import (
	"context"
	"net/http"
	"slices"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// maxSkipDays is the longest range of days that can be skipped at once.
const maxSkipDays = 366

// handleSkipDays skips the days from From to To of the given habits, or of
// all habits that are not archived, e.g. for a holiday. Only due days without
// a value are skipped (domain.DaysToSkip). The answer counts the skipped
// days; undo takes them back as one step.
func (s *server) handleSkipDays(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		From     domain.Date `json:"from"`
		To       domain.Date `json:"to"`
		HabitIDs []string    `json:"habitIds"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.From.IsZero() || body.To.IsZero() {
		s.writeError(w, http.StatusBadRequest, "missing_fields", "from and to are required")
		return
	}
	if body.To.Before(body.From) {
		s.writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("skip_range_reversed",
			"the last day lies before the first"))
		return
	}
	if body.To.DaysSince(body.From) >= maxSkipDays {
		s.writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("skip_range_too_long",
			"at most {max} days can be skipped at once", "max", maxSkipDays))
		return
	}
	ctx := r.Context()

	skipped := 0
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		b, err := s.loadBasis(ctx, tx)
		if err != nil {
			return err
		}
		if err := checkRecordDate(body.From, b.today); err != nil {
			return err
		}
		if err := checkRecordDate(body.To, b.today); err != nil {
			return err
		}
		habits, err := habitsToSkip(ctx, tx, body.HabitIDs)
		if err != nil {
			return err
		}
		entries, err := tx.Entries(ctx)
		if err != nil {
			return err
		}
		for _, h := range habits {
			days := map[domain.Date]domain.Entry{}
			for _, d := range domain.DaysToSkip(h, entries[h.ID], body.From, body.To) {
				days[d] = domain.Entry{Skipped: true}
			}
			if err := tx.SetEntries(ctx, &h, days); err != nil {
				return err
			}
			skipped += len(days)
		}
		if skipped == 1 {
			tx.Record("1 day skipped")
		} else {
			tx.Record("{n} days skipped", "n", skipped)
		}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, r, err, "skipping days")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusOK, map[string]int{"skipped": skipped})
}

// habitsToSkip returns the habits of the user with the given IDs, or all
// that are not archived if there are none. An unknown ID is ErrNotFound.
func habitsToSkip(ctx context.Context, tx *store.Tx, ids []string) ([]domain.Habit, error) {
	all, err := tx.Habits(ctx)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return slices.DeleteFunc(all, func(h domain.Habit) bool { return h.ArchivedAt != nil }), nil
	}
	var chosen []domain.Habit
	for _, id := range ids {
		i := slices.IndexFunc(all, func(h domain.Habit) bool { return h.ID == id })
		if i == -1 {
			return nil, store.ErrNotFound
		}
		chosen = append(chosen, all[i])
	}
	return chosen, nil
}
