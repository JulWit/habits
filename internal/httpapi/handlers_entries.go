package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// setEntryResponse is the response of PUT /api/habits/{id}/entries/{date}.
type setEntryResponse struct {
	HabitID string      `json:"habitId"`
	Date    domain.Date `json:"date"`
	// The entry after the change: value and skipped.
	domain.Entry
	// Previous is the replaced entry.
	Previous   domain.Entry       `json:"previous"`
	Stats      domain.Stats       `json:"stats"`
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// Status is the day's status after the change (domain.DayStatus).
	Status string `json:"status"`
	// HistoryStart is the first day of the habit's history after the change;
	// an entry before it moves it.
	HistoryStart domain.Date `json:"historyStart"`
	// UpdatedAt is the habit's updated_at after the change.
	UpdatedAt time.Time `json:"updatedAt"`
}

// handleSetEntry changes the entry of a habit on a date: its value and
// whether the day is skipped; a field left out stays as it is. A change that
// records something (a value or a skip) is only accepted on due days between
// domain.EarliestEntry and domain.EntryHorizonDays after today; removing is
// allowed on any day.
func (s *Server) handleSetEntry(w http.ResponseWriter, r *http.Request) {
	var change domain.EntryChange
	if !decodeJSON(w, r, &change) {
		return
	}
	date, err := domain.ParseDate(r.PathValue("date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
		return
	}
	user := auth.MustUser(r.Context())

	var out setEntryResponse
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		h, err := tx.Habit(r.PathValue("id"))
		if err != nil {
			return err
		}
		if err := checkEntryDay(h, date, b.today, change.Records()); err != nil {
			return err
		}
		previous, err := tx.Entry(h.ID, date)
		if err != nil {
			return err
		}
		next := change.Apply(previous)
		if err := tx.SetEntries(h, map[domain.Date]domain.Entry{date: next}); err != nil {
			return err
		}
		entries, err := tx.HabitEntries(h.ID)
		if err != nil {
			return err
		}
		tx.Record("{name} — {date}", "name", h.Name, "date", date.String())

		start := domain.HistoryStart(h, entries)
		runs := domain.StreakRuns(h, entries, b.today)
		if runs == nil {
			// Sent as [], as in the habit view.
			runs = []domain.StreakRun{}
		}
		out = setEntryResponse{
			HabitID:      h.ID,
			Date:         date,
			Entry:        next,
			Previous:     previous,
			Stats:        domain.ComputeStats(h, entries, b.today, b.windowDays),
			StreakRuns:   runs,
			Status:       string(h.Status(date, next, start, b.today)),
			HistoryStart: start,
			UpdatedAt:    tx.Now(),
		}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "saving entry")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusOK, out)
}

// checkEntryDay returns an error unless the entry of h on date may be
// changed: within the bounds of checkEntryDate, and on a due day for
// recording something (records). Removing is allowed on any day.
func checkEntryDay(h domain.Habit, date, today domain.Date, records bool) error {
	if err := checkEntryDate(date, today, records); err != nil {
		return err
	}
	if records && !h.IsScheduled(date) {
		return domain.Invalid("not_scheduled", "The habit is not scheduled on this day")
	}
	return nil
}

// checkEntryDate returns an error unless an entry may be dated on date.
// Nothing may be dated more than domain.EntryHorizonDays after today, and
// nothing recorded (records) before domain.EarliestEntry.
func checkEntryDate(date, today domain.Date, records bool) error {
	switch {
	case date.After(today.AddDays(domain.EntryHorizonDays)):
		return domain.Invalid("entry_too_far_ahead", "Entries may be at most one year in the future")
	case records && date.Before(domain.EarliestEntry):
		// The year is passed as a string so the client does not format it as
		// a number.
		return domain.Invalid("entry_too_early",
			"Entries may not be dated before {year}", "year", strconv.Itoa(domain.EarliestEntry.Year))
	}
	return nil
}
