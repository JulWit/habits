package httpapi

import (
	"net/http"
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
		return 0, domain.Invalid("invalid_year", "Invalid year")
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
}

// handleDays returns the day statistics of a year (?year=, by default the
// current one): how many of the habits that are not archived were due and
// done on each day, and what that adds up to.
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
		habits, err := tx.Habits(false)
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
		out = daysResponse{Year: year, Totals: totals, Stats: domain.ComputeDayStats(past, b.today)}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "loading day statistics")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// categoryStats is the response of GET /api/categories/{id}/stats.
type categoryStats struct {
	// From is the first day the perfect days are counted from: 1 January.
	From domain.Date `json:"from"`
	// DueDays counts the days since From with a due habit, Perfect those on
	// which every due habit was completed, CurrentStreak the current run of
	// perfect days.
	DueDays       int `json:"dueDays"`
	Perfect       int `json:"perfect"`
	CurrentStreak int `json:"currentStreak"`
	// Expected and Achieved add up those of the habits' statistics, which
	// cover the completion rate's window.
	Expected int `json:"expected"`
	Achieved int `json:"achieved"`
	// Habits is the number of habits in the category that are not archived.
	Habits int `json:"habits"`
}

// handleCategoryStats returns the statistics of a category over its habits
// that are not archived.
func (s *Server) handleCategoryStats(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	var out categoryStats
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		category, err := tx.Category(r.PathValue("id"))
		if err != nil {
			return err
		}
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		all, err := tx.Habits(false)
		if err != nil {
			return err
		}
		entries, err := tx.Entries()
		if err != nil {
			return err
		}

		var habits []domain.Habit
		for _, h := range all {
			if h.CategoryID != category.ID {
				continue
			}
			habits = append(habits, h)
			st := domain.ComputeStats(h, entries[h.ID], b.today, b.windowDays)
			out.Expected += st.Expected
			out.Achieved += st.Achieved
		}
		out.Habits = len(habits)
		out.From, _ = yearRange(b.today.Year)
		totals := domain.DayTotals(habits, entries, out.From, b.today, b.today)
		for _, t := range totals {
			if t.Due > 0 {
				out.DueDays++
			}
			if t.Perfect() {
				out.Perfect++
			}
		}
		out.CurrentStreak, _ = domain.PerfectStreaks(totals, b.today)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "loading category statistics")
		return
	}
	writeJSON(w, http.StatusOK, out)
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
