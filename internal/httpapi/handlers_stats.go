package httpapi

import (
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
func (s *Server) handleDays(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	var out daysResponse
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		year, err := statsYear(r, b.today)
		if err != nil {
			return err
		}
		habits, err := habitsOfCategory(tx, r.URL.Query().Get("category"))
		if err != nil {
			return err
		}
		entries, err := tx.Entries()
		if err != nil {
			return err
		}
		first, last := yearRange(year)
		totals := domain.DayTotals(habits, entries, first, last, b.today)
		past := totals
		if !last.Before(b.today) {
			past = totals[:b.today.DaysSince(first)+1]
		}
		out = daysResponse{
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
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "loading day statistics")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// habitsOfCategory returns the user's habits that are not archived: all of
// them for categoryID "", otherwise those of that category. An unknown
// category is ErrNotFound.
func habitsOfCategory(tx *store.Tx, categoryID string) ([]domain.Habit, error) {
	habits, err := tx.Habits(false)
	if err != nil || categoryID == "" {
		return habits, err
	}
	if _, err := tx.Category(categoryID); err != nil {
		return nil, err
	}
	return slices.DeleteFunc(habits, func(h domain.Habit) bool { return h.CategoryID != categoryID }), nil
}

// handleHabitTotals sums a habit's values over a year (?year=, by default the
// current one) per day, week or month (?grain=, by default month), up to
// today.
func (s *Server) handleHabitTotals(w http.ResponseWriter, r *http.Request) {
	grain := domain.Grain(r.URL.Query().Get("grain"))
	if grain == "" {
		grain = domain.GrainMonth
	}
	if !grain.Valid() {
		writeError(w, http.StatusBadRequest, "invalid_grain", "grain must be day, week or month")
		return
	}
	user := auth.MustUser(r.Context())
	var out domain.Totals
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		year, err := statsYear(r, b.today)
		if err != nil {
			return err
		}
		h, err := tx.Habit(r.PathValue("id"))
		if err != nil {
			return err
		}
		entries, err := tx.HabitEntries(h.ID)
		if err != nil {
			return err
		}
		first, last := yearRange(year)
		out = domain.SumValues(entries, first, last.Min(b.today), grain)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "loading totals")
		return
	}
	writeJSON(w, http.StatusOK, out)
}
