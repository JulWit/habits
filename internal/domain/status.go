package domain

// DayStatus is how a habit stands on one day, as the client shows it. The
// client renders a day from its status and value and never judges a day
// itself.
type DayStatus byte

const (
	// StatusOff is a day the habit is not due on.
	StatusOff DayStatus = '-'
	// StatusOffDone is a day the habit is not due on whose value still meets
	// the target, e.g. recorded before the schedule changed.
	StatusOffDone DayStatus = '+'
	// StatusOpen is a due day that is not complete (yet), including days
	// ahead and days with a value below the target.
	StatusOpen DayStatus = 'o'
	// StatusDone is a due day that is complete. A day ahead is complete when
	// a value meeting the target is planned on it.
	StatusDone DayStatus = 'c'
	// StatusOver is a due day up to today whose value exceeds its limit.
	StatusOver DayStatus = 'x'
	// StatusSkipped is a skipped day.
	StatusSkipped DayStatus = 's'
)

// Status returns the status of the habit on d with the entry e. start is the
// first day of its history (HistoryStart). A limit is kept by a day without a
// value from start up to today, as the statistics count it; a day ahead only
// keeps a limit once it has come.
func (h *Habit) Status(d Date, e Entry, start, today Date) DayStatus {
	if e.Skipped {
		return StatusSkipped
	}
	done := h.isDone(d, e.Value, start, today)
	if !h.IsScheduled(d) {
		if done && e.Value > 0 {
			return StatusOffDone
		}
		return StatusOff
	}
	switch {
	case done:
		return StatusDone
	case h.ScheduleOn(d).isLimit() && !d.After(today) && e.Value > h.Target(d):
		return StatusOver
	}
	return StatusOpen
}

// isDone reports whether value completes d, as Status judges it.
func (h *Habit) isDone(d Date, value int, start, today Date) bool {
	if h.ScheduleOn(d).isLimit() {
		return !d.After(today) && !d.Before(start) && h.IsComplete(d, value)
	}
	return h.IsComplete(d, value)
}

// DayStatuses returns the status of every day from from to to, one character
// per day. start is the first day of the habit's history (HistoryStart);
// entries need to cover the days from from to to only.
func DayStatuses(h Habit, entries map[Date]Entry, start, from, to, today Date) string {
	if to.Before(from) {
		return ""
	}
	out := make([]byte, 0, to.DaysSince(from)+1)
	for d := from; !d.After(to); d = d.AddDays(1) {
		out = append(out, byte(h.Status(d, entries[d], start, today)))
	}
	return string(out)
}

// LastDone returns the latest day up to today that is due and complete, or
// the zero Date.
func LastDone(h Habit, entries map[Date]Entry, today Date) Date {
	start := HistoryStart(h, entries)
	if start.IsZero() {
		return Date{}
	}
	for d := today; !d.Before(start); d = d.AddDays(-1) {
		if h.Status(d, entries[d], start, today) == StatusDone {
			return d
		}
	}
	return Date{}
}
