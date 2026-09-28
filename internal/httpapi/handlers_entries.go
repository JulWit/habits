package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// EntryHorizonDays is how many days after today an entry may be dated.
const EntryHorizonDays = 365

// EarliestEntry is the earliest date an entry may have.
var EarliestEntry = domain.Date{Year: 2000, Month: time.January, Day: 1}

// setEntryResponse is the response of PUT /api/habits/{id}/entries/{date}.
type setEntryResponse struct {
	HabitID string      `json:"habitId"`
	Date    domain.Date `json:"date"`
	// The entry after the change: value, skipped and note.
	domain.Entry
	// Previous is the replaced entry; writing it back undoes the change.
	Previous   domain.Entry       `json:"previous"`
	Stats      domain.Stats       `json:"stats"`
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// UpdatedAt is the habit's updated_at after the change.
	UpdatedAt time.Time `json:"updatedAt"`
}

// handleSetEntry changes the entry of a habit on a date: its value, whether
// the day is skipped, and its note; fields left out stay as they are. A
// change that records something (a value, a skip or a note) is only accepted
// on scheduled days between EarliestEntry and EntryHorizonDays after today;
// removing is allowed on any day.
func (s *Server) handleSetEntry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		domain.EntryChange
		// Expect makes the write conditional: it only happens while the stored
		// entry (all zero without one) is still Expect, otherwise the answer
		// is 409. Undo sends the entry it wants to take back.
		Expect *domain.Entry `json:"expect"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	date, err := domain.ParseDate(r.PathValue("date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
		return
	}
	user := auth.MustUser(r.Context())
	habitID := r.PathValue("id")
	records := body.Records()

	// Loaded before the write, as recording needs a due day; the write does
	// not change the habit's rules, so its statistics are computed from it
	// after.
	habit, err := s.store.GetHabit(r.Context(), user.ID, habitID)
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	today := s.todayFor(r.Context(), user.ID)
	if !checkEntryDay(w, habit, date, today, records) {
		return
	}

	previous, next, updatedAt, err := s.store.SetEntry(r.Context(), user.ID, habitID, date, body.EntryChange, body.Expect)
	if errors.Is(err, store.ErrConflict) {
		writeProblemBody(w, problemBody{
			Status: http.StatusConflict,
			Code:   "entry_changed",
			Detail: "The entry was changed in the meantime",
			Params: map[string]any{"current": previous.Value},
		})
		return
	}
	if err != nil {
		s.writeStoreError(w, err, "saving entry")
		return
	}
	entries, err := s.store.EntriesForHabit(r.Context(), user.ID, habitID)
	if err != nil {
		s.writeStoreError(w, err, "loading entries")
		return
	}

	runs := domain.StreakRuns(habit, entries, today)
	if runs == nil {
		// Sent as [], as in the habit view.
		runs = []domain.StreakRun{}
	}
	writeJSON(w, http.StatusOK, setEntryResponse{
		HabitID:    habitID,
		Date:       date,
		Entry:      next,
		Previous:   previous,
		Stats:      domain.ComputeStats(habit, entries, today, domain.DefaultRateWindowDays),
		StreakRuns: runs,
		UpdatedAt:  updatedAt,
	})
}

// checkEntryDay reports whether the entry of h on date may be changed, and
// writes the error if not: within the bounds of checkEntryDate, and on a due
// day for recording something (records). Removing is allowed on any day.
func checkEntryDay(w http.ResponseWriter, h domain.Habit, date, today domain.Date, records bool) bool {
	if !checkEntryDate(w, date, today, records) {
		return false
	}
	if records && !h.IsScheduled(date) {
		writeError(w, http.StatusUnprocessableEntity, "not_scheduled", "The habit is not scheduled on this day")
		return false
	}
	return true
}

// checkEntryDate reports whether an entry may be dated on date, and writes the
// error if not. Nothing may be dated more than EntryHorizonDays after today,
// and nothing recorded (records) before EarliestEntry.
func checkEntryDate(w http.ResponseWriter, date, today domain.Date, records bool) bool {
	switch {
	case date.IsZero():
		writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
	case date.After(today.AddDays(EntryHorizonDays)):
		writeError(w, http.StatusUnprocessableEntity, "entry_too_far_ahead", "Entries may be at most one year in the future")
	case records && date.Before(EarliestEntry):
		// The year is passed as a string so the client does not format it as
		// a number.
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("entry_too_early",
			"Entries may not be dated before {year}", "year", strconv.Itoa(EarliestEntry.Year)))
	default:
		return true
	}
	return false
}
