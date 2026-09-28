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
	Value   int         `json:"value"`
	// Previous is the replaced value; writing it back undoes the change.
	Previous   int                `json:"previous"`
	Stats      domain.Stats       `json:"stats"`
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// UpdatedAt is the habit's updated_at after the change.
	UpdatedAt time.Time `json:"updatedAt"`
}

// handleSetEntry sets the value of a habit on a date. Values other than 0 are
// only accepted on scheduled days between EarliestEntry and EntryHorizonDays
// after today; 0 clears the entry.
func (s *Server) handleSetEntry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Value int `json:"value"`
		// Expect makes the write conditional: it only happens while the stored
		// value (0 without an entry) is still Expect, otherwise the answer is
		// 409. Undo sends the value it wants to take back.
		Expect *int `json:"expect"`
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

	today := s.todayFor(r.Context(), user.ID)
	if date.After(today.AddDays(EntryHorizonDays)) {
		writeError(w, http.StatusUnprocessableEntity, "entry_too_far_ahead", "Entries may be at most one year in the future")
		return
	}
	if body.Value > 0 && date.Before(EarliestEntry) {
		// The year is passed as a string so the client does not format it as
		// a number.
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("entry_too_early",
			"Entries may not be dated before {year}", "year", strconv.Itoa(EarliestEntry.Year)))
		return
	}

	// Loaded before the write, as a value needs a due day; the write does not
	// change the habit's rules, so its statistics are computed from it after.
	habit, err := s.store.GetHabit(r.Context(), user.ID, habitID)
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	// Clearing an entry is allowed on any day.
	if body.Value > 0 && !habit.IsScheduled(date) {
		writeError(w, http.StatusUnprocessableEntity, "not_scheduled", "The habit is not scheduled on this day")
		return
	}

	previous, updatedAt, err := s.store.SetEntry(r.Context(), user.ID, habitID, date, body.Value, body.Expect)
	if errors.Is(err, store.ErrConflict) {
		writeProblemBody(w, problemBody{
			Status: http.StatusConflict,
			Code:   "entry_changed",
			Detail: "The entry was changed in the meantime",
			Params: map[string]any{"current": previous},
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
		Value:      body.Value,
		Previous:   previous,
		Stats:      domain.ComputeStats(habit, entries, today, domain.DefaultRateWindowDays),
		StreakRuns: runs,
		UpdatedAt:  updatedAt,
	})
}
