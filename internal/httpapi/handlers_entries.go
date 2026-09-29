package httpapi

import (
	"net/http"
	"strconv"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// handleSetEntry changes the entry of a habit on a date: its value and
// whether the day is skipped; a field left out stays as it is. A change that
// records something (a value or a skip) is only accepted on due days between
// domain.EarliestEntry and domain.EntryHorizonDays after today; removing is
// allowed on any day. The answer is the habit with its full history, as an
// entry can change the status of other days too (see domain.HistoryStart).
func (s *server) handleSetEntry(w http.ResponseWriter, r *http.Request) {
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

	var view habitView
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
		if err := tx.SetEntries(h, map[domain.Date]domain.Entry{date: change.Apply(previous)}); err != nil {
			return err
		}
		tx.Record("{name} — {date}", "name", h.Name, "date", date.String())
		view, err = s.fullView(tx, h.ID)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "saving entry")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusOK, view)
}

// checkEntryDay returns an error unless the entry of h on date may be
// changed: within the bounds of checkEntryDate, and on a due day for
// recording something (records). Removing is allowed on any day.
func checkEntryDay(h domain.Habit, date, today domain.Date, records bool) error {
	if err := checkEntryDate(date, today, records); err != nil {
		return err
	}
	if records && !h.IsScheduled(date) {
		return domain.Invalid("not_scheduled", "the habit is not scheduled on this day")
	}
	return nil
}

// checkEntryDate returns an error unless an entry may be dated on date.
// Nothing may be dated more than domain.EntryHorizonDays after today, and
// nothing recorded (records) before domain.EarliestEntry.
func checkEntryDate(date, today domain.Date, records bool) error {
	switch {
	case date.After(today.AddDays(domain.EntryHorizonDays)):
		return domain.Invalid("entry_too_far_ahead", "entries may be at most one year in the future")
	case records && date.Before(domain.EarliestEntry):
		// The year is passed as a string so the client does not format it as
		// a number.
		return domain.Invalid("entry_too_early",
			"entries may not be dated before {year}", "year", strconv.Itoa(domain.EarliestEntry.Year))
	}
	return nil
}
