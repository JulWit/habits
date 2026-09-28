package httpapi

import (
	"net/http"
	"slices"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// maxSkipDays is the longest range of days that can be skipped at once.
const maxSkipDays = 366

// maxEntriesBytes bounds the body of POST /api/entries, which undoes a skipped
// range: a year of days for a few dozen habits.
const maxEntriesBytes = 4 << 20

// entryChange is a changed entry of a habit on a day, with the entry before.
// Writing Previous back with Entry expected undoes it.
type entryChange struct {
	HabitID  string       `json:"habitId"`
	Date     domain.Date  `json:"date"`
	Previous domain.Entry `json:"previous"`
	Entry    domain.Entry `json:"entry"`
}

// handleSkipDays skips the days from From to To of the given habits, or of
// all habits that are not archived, e.g. for a holiday. Only due days without
// a value are skipped (domain.DaysToSkip); a skipped day without a note gets
// Note. The answer lists the changed days.
func (s *Server) handleSkipDays(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From     domain.Date `json:"from"`
		To       domain.Date `json:"to"`
		HabitIDs []string    `json:"habitIds"`
		Note     string      `json:"note"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.From.IsZero() || body.To.IsZero() {
		writeError(w, http.StatusBadRequest, "missing_fields", "from and to are required")
		return
	}
	if body.To.Before(body.From) {
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("skip_range_reversed",
			"the last day lies before the first"))
		return
	}
	if body.To.DaysSince(body.From) >= maxSkipDays {
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("skip_range_too_long",
			"at most {max} days can be skipped at once", "max", maxSkipDays))
		return
	}
	ctx := r.Context()
	user := auth.MustUser(ctx)

	habits, err := s.skippedHabits(r, user.ID, body.HabitIDs)
	if err != nil {
		s.writeStoreError(w, err, "loading habits")
		return
	}
	today := s.todayFor(ctx, user.ID)
	if !checkEntryDate(w, body.From, today, true) || !checkEntryDate(w, body.To, today, true) {
		return
	}

	entries, err := s.store.EntriesForUser(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading entries")
		return
	}
	var writes []store.EntryWrite
	for _, h := range habits {
		for _, d := range domain.DaysToSkip(h, entries[h.ID], body.From, body.To) {
			before := entries[h.ID][d]
			after := domain.Entry{Skipped: true, Note: before.Note}
			if after.Note == "" {
				after.Note = body.Note
			}
			writes = append(writes, store.EntryWrite{HabitID: h.ID, Date: d, Expect: before, Entry: after})
		}
	}
	applied, err := s.store.WriteEntries(ctx, user.ID, writes)
	if err != nil {
		s.writeStoreError(w, err, "skipping days")
		return
	}
	changes := make([]entryChange, 0, len(applied))
	for _, a := range applied {
		changes = append(changes, entryChange{HabitID: a.HabitID, Date: a.Date, Previous: a.Expect, Entry: a.Entry})
	}
	writeJSON(w, http.StatusOK, map[string]any{"changes": changes})
}

// skippedHabits returns the habits of the user with the given IDs, or all
// that are not archived if there are none. An unknown ID is ErrNotFound.
func (s *Server) skippedHabits(r *http.Request, userID string, ids []string) ([]domain.Habit, error) {
	all, err := s.store.ListHabits(r.Context(), userID, true)
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

// handleWriteEntries writes whole entries of several days and habits at once,
// each only while its day still holds Expect; it undoes and redoes a skipped
// range. The same days are allowed as for a single entry (checkEntryDay). The
// answer counts the writes applied and those left out for a conflict.
func (s *Server) handleWriteEntries(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Changes []struct {
			HabitID string       `json:"habitId"`
			Date    domain.Date  `json:"date"`
			Expect  domain.Entry `json:"expect"`
			Entry   domain.Entry `json:"entry"`
		} `json:"changes"`
	}
	if !decodeJSONLimit(w, r, &body, maxEntriesBytes) {
		return
	}
	ctx := r.Context()
	user := auth.MustUser(ctx)
	habits, err := s.store.ListHabits(ctx, user.ID, true)
	if err != nil {
		s.writeStoreError(w, err, "loading habits")
		return
	}
	today := s.todayFor(ctx, user.ID)

	writes := make([]store.EntryWrite, 0, len(body.Changes))
	for _, c := range body.Changes {
		i := slices.IndexFunc(habits, func(h domain.Habit) bool { return h.ID == c.HabitID })
		if i == -1 {
			writeError(w, http.StatusNotFound, "not_found", "Not found")
			return
		}
		if !checkEntryDay(w, habits[i], c.Date, today, !c.Entry.IsZero()) {
			return
		}
		writes = append(writes, store.EntryWrite{HabitID: c.HabitID, Date: c.Date, Expect: c.Expect, Entry: c.Entry})
	}
	applied, err := s.store.WriteEntries(ctx, user.ID, writes)
	if err != nil {
		s.writeStoreError(w, err, "saving entries")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{
		"applied":   len(applied),
		"conflicts": len(writes) - len(applied),
	})
}
