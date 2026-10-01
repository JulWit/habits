package httpapi

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// statsYear reads the query parameter year, which defaults to the year of
// today and lies between that of domain.EarliestEntry and today's.
func statsYear(r *http.Request, today domain.Date) (int, error) {
	v := r.URL.Query().Get("year")
	if v == "" {
		return today.Year, nil
	}
	year, err := strconv.Atoi(v)
	if err != nil || year < domain.EarliestEntry.Year || year > today.Year {
		return 0, domain.Invalid("invalid_year", "invalid year")
	}
	return year, nil
}

// yearRange returns 1 January and 31 December of year.
func yearRange(year int) (first, last domain.Date) {
	return domain.Date{Year: year, Month: time.January, Day: 1},
		domain.Date{Year: year, Month: time.December, Day: 31}
}

// daysResponse is the response of GET /api/days.
type daysResponse struct {
	Year int `json:"year"`
	// Totals has a domain.DayTotal for every day of the year, days ahead
	// included.
	Totals []domain.DayTotal `json:"totals"`
	// Stats covers the days of the year up to today.
	Stats domain.DayStats `json:"stats"`
	// Habits is the number of habits counted: those that are not archived,
	// of the category if one is given.
	Habits int `json:"habits"`
	// Expected and Achieved add up those of the habits' statistics, which
	// cover the completion rate's window.
	Expected int `json:"expected"`
	Achieved int `json:"achieved"`
}

// handleDays returns the day statistics of a year (?year=, by default the
// current one): how many of the habits that are not archived were due and
// done on each day, and what that adds up to. ?category= limits them to the
// habits of a category.
func (s *server) handleDays(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	var (
		b       basis
		year    int
		habits  []domain.Habit
		entries map[string]map[domain.Date]domain.Entry
	)
	err := s.store.View(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		if b, err = s.basis(ctx, tx); err != nil {
			return err
		}
		if year, err = statsYear(r, b.today); err != nil {
			return err
		}
		if habits, err = habitsOfCategory(ctx, tx, r.URL.Query().Get("category")); err != nil {
			return err
		}
		entries, err = tx.Entries(ctx)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading day statistics")
		return
	}

	// Computed after the transaction, see habitData.
	first, last := yearRange(year)
	totals := domain.DayTotals(habits, entries, first, last, b.today)
	past := totals
	if !last.Before(b.today) {
		past = totals[:b.today.DaysSince(first)+1]
	}
	out := daysResponse{
		Year:   year,
		Totals: totals,
		Stats:  domain.ComputeDayStats(past, b.today),
		Habits: len(habits),
	}
	for _, h := range habits {
		st := domain.ComputeStats(h, entries[h.ID], b.today, b.windowDays)
		out.Expected += st.Expected
		out.Achieved += st.Achieved
	}
	s.writeJSON(w, http.StatusOK, out)
}

// habitsOfCategory returns the user's habits that are not archived: all of
// them for categoryID "", otherwise those of that category. An unknown
// category is ErrNotFound.
func habitsOfCategory(ctx context.Context, tx *store.Tx, categoryID string) ([]domain.Habit, error) {
	habits, err := tx.ActiveHabits(ctx)
	if err != nil || categoryID == "" {
		return habits, err
	}
	if _, err := tx.Category(ctx, categoryID); err != nil {
		return nil, err
	}
	return slices.DeleteFunc(habits, func(h domain.Habit) bool { return h.CategoryID != categoryID }), nil
}

// handleHabitTotals sums a habit's values over a year (?year=, by default the
// current one) per day, week or month (?grain=, by default month), up to
// today.
func (s *server) handleHabitTotals(w http.ResponseWriter, r *http.Request, user auth.User) {
	grain := domain.Grain(r.URL.Query().Get("grain"))
	if grain == "" {
		grain = domain.GrainMonth
	}
	if !grain.Valid() {
		s.writeError(w, http.StatusBadRequest, "invalid_grain", "grain must be day, week or month")
		return
	}
	ctx := r.Context()
	var (
		data habitData
		year int
	)
	err := s.store.View(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		if data, err = s.loadHabit(ctx, tx, r.PathValue("id")); err != nil {
			return err
		}
		year, err = statsYear(r, data.basis.today)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading totals")
		return
	}
	// Computed after the transaction, see habitData.
	first, last := yearRange(year)
	s.writeJSON(w, http.StatusOK, domain.SumValues(data.entries, first, last.Min(data.basis.today), grain))
}
