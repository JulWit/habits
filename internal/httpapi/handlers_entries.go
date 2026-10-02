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
func (s *server) handleSetEntry(w http.ResponseWriter, r *http.Request, user auth.User) {
	var change domain.EntryChange
	if !s.decodeJSON(w, r, &change) {
		return
	}
	if err := change.Validate(); err != nil {
		s.writeProblem(w, http.StatusUnprocessableEntity, err)
		return
	}
	date, err := domain.ParseDate(r.PathValue("date"))
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
		return
	}
	ctx := r.Context()

	var data habitData
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		b, err := s.basis(ctx, tx)
		if err != nil {
			return err
		}
		h, err := tx.Habit(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if err := checkEntryDay(h, date, b.today, change); err != nil {
			return err
		}
		// The other days of its week or month decide whether a day can be
		// completed (Habit.CheckRecord).
		entries, err := tx.HabitEntries(ctx, h.ID)
		if err != nil {
			return err
		}
		next := change.Apply(entries[date])
		if change.Records() {
			entries[date] = next
			if err := h.CheckRecord(date, entries); err != nil {
				return err
			}
		}
		if err := tx.SetEntries(ctx, h, map[domain.Date]domain.Entry{date: next}); err != nil {
			return err
		}
		tx.Record("{name} — {date}", "name", h.Name, "date", date.String())
		data, err = s.loadHabit(ctx, tx, h.ID)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "saving entry")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusOK, data.fullView())
}

// checkEntryDay returns an error unless change may be applied to the entry of
// h on date. A change that records something (EntryChange.Records) needs a
// due day within the bounds of checkRecordDate; removing is allowed on any day
// up to the horizon of checkEntryHorizon.
func checkEntryDay(h domain.Habit, date, today domain.Date, change domain.EntryChange) error {
	if !change.Records() {
		return checkEntryHorizon(date, today)
	}
	if err := checkRecordDate(date, today); err != nil {
		return err
	}
	if !h.IsScheduled(date) {
		return domain.Invalid("not_scheduled", "the habit is not scheduled on this day")
	}
	return nil
}

// checkRecordDate returns an error unless something may be recorded on date:
// not before domain.EarliestEntry and within checkEntryHorizon.
func checkRecordDate(date, today domain.Date) error {
	if date.Before(domain.EarliestEntry) {
		// The year is passed as a string so the client does not format it as
		// a number.
		return domain.Invalid("entry_too_early",
			"entries may not be dated before {year}", "year", strconv.Itoa(domain.EarliestEntry.Year))
	}
	return checkEntryHorizon(date, today)
}

// checkEntryHorizon returns an error if date lies more than
// domain.EntryHorizonDays after today.
func checkEntryHorizon(date, today domain.Date) error {
	if date.After(today.AddDays(domain.EntryHorizonDays)) {
		return domain.Invalid("entry_too_far_ahead", "entries may be at most one year in the future")
	}
	return nil
}
