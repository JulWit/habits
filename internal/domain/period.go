package domain

import "time"

// period is the span a times-per-week or times-per-month habit is counted
// in: a week from Monday, or a calendar month.
type period int

const (
	weekPeriod period = iota
	monthPeriod
)

// periodOf returns the period counted by a frequency, and false if the
// frequency fixes its due days instead.
func periodOf(f FrequencyKind) (period, bool) {
	switch f {
	case FreqTimesPerWeek:
		return weekPeriod, true
	case FreqTimesPerMonth:
		return monthPeriod, true
	}
	return 0, false
}

// startOf returns the first day of the period containing d.
func (p period) startOf(d Date) Date {
	if p == monthPeriod {
		return Date{Year: d.Year, Month: d.Month, Day: 1}
	}
	return d.StartOfWeek()
}

// next returns the first day of the period after the one starting on start.
func (p period) next(start Date) Date {
	if p == monthPeriod {
		return DateFromTime(time.Date(start.Year, start.Month+1, 1, 0, 0, 0, 0, time.UTC))
	}
	return start.AddDays(7)
}

// streakUnit is the unit of the streaks counted in periods, see Stats.
func (p period) streakUnit() string {
	if p == monthPeriod {
		return "months"
	}
	return "weeks"
}

// times returns how many completed days f asks for per period.
func (p period) times(f Frequency) int {
	if p == monthPeriod {
		return f.TimesPerMonth
	}
	return f.TimesPerWeek
}

// periodTally is the outcome of one period of a times-per-period habit.
type periodTally struct {
	// done is the number of completed days, target the number the period
	// needs. A target of 0 means nothing was due.
	done, target int
	// expected is the target's share for the days of the period that lie in
	// the habit's history up to today, rounded up.
	expected int
}

// tally counts the period starting on first, from start (the habit's first
// day) to today. The period is judged by the schedule of its first day in the
// history. Under a schedule counting this kind of period, it needs that many
// completed days; under any other schedule (from before a change of
// frequency) it needs every due day.
//
// Skipped days count as not due. A counting period asks for proportionally
// fewer days, rounded up, for each day skipped in it, future ones included,
// so a planned holiday lowers the target of the current week.
func (p period) tally(h Habit, entries map[Date]Entry, first, start, today Date) periodTally {
	from := first
	if from.Before(start) {
		from = start
	}
	schedule := h.ScheduleOn(from)
	own, ok := periodOf(schedule.Frequency.Kind)
	counting := ok && own == p

	end := p.next(first)
	var t periodTally
	available, open := 0, 0
	for d := first; d.Before(end); d = d.AddDays(1) {
		e := entries[d]
		if e.Skipped {
			continue
		}
		available++
		if d.Before(start) || d.After(today) {
			continue
		}
		open++
		due := counting || schedule.IsScheduled(d)
		if due && !counting {
			t.target++
		}
		if due && h.IsComplete(d, e.Value) {
			t.done++
		}
	}
	if !counting {
		t.expected = t.target
		return t
	}
	t.target = p.needed(schedule.Frequency, entries, first)
	t.expected = t.target
	if open < available {
		// Partial periods expect a proportional share of the target.
		t.expected = (t.target*open + available - 1) / available
	}
	return t
}

// needed returns how many completed days the period starting on first asks
// for under f: the times of f, lowered in proportion to the days skipped in
// the period and rounded up, so skipping a single day of a week rarely lowers
// it. 0 if every day is skipped.
func (p period) needed(f Frequency, entries map[Date]Entry, first Date) int {
	end := p.next(first)
	available := 0
	for d := first; d.Before(end); d = d.AddDays(1) {
		if !entries[d].Skipped {
			available++
		}
	}
	length := end.DaysSince(first)
	return (max(p.times(f), 1)*available + length - 1) / length
}

// completedIn returns the number of completed days, skipped ones aside, of
// the period containing d that come before d, and of the whole period
// without d. Days ahead count as planned.
func (p period) completedIn(h Habit, entries map[Date]Entry, d Date) (before, others int) {
	first := p.startOf(d)
	for day := first; day.Before(p.next(first)); day = day.AddDays(1) {
		e := entries[day]
		if day == d || e.Skipped || !h.IsComplete(day, e.Value) {
			continue
		}
		others++
		if day.Before(d) {
			before++
		}
	}
	return before, others
}

// periodStatus returns the status of d, a due day of a times-per-week or
// times-per-month habit that is not skipped, counted in its period p. As many
// completed days as the period needs are done, the earliest first; further
// ones are a bonus, or for a maximum not counted. Once a period has enough,
// its other days are no longer due: a minimum leaves them free for a bonus, a
// maximum closes them.
func (h *Habit) periodStatus(d Date, entries map[Date]Entry, p period) DayStatus {
	f := h.ScheduleOn(d).Frequency
	needed := p.needed(f, entries, p.startOf(d))
	before, others := p.completedIn(*h, entries, d)
	if h.IsComplete(d, entries[d].Value) {
		switch {
		case before < needed:
			return StatusDone
		case f.TimesAtMost:
			return StatusOffDone
		}
		return StatusBonus
	}
	switch {
	case others < needed:
		return StatusOpen
	case f.TimesAtMost:
		return StatusOff
	}
	return StatusFree
}

// CheckRecord returns an error unless the entry of d in entries, which holds
// the change to record, may be recorded on d, a due day of h. A day of a
// habit with a maximum of times per week or month (Frequency.TimesAtMost)
// cannot be completed once the other days of its period have reached it.
func (h *Habit) CheckRecord(d Date, entries map[Date]Entry) error {
	f := h.ScheduleOn(d).Frequency
	p, ok := periodOf(f.Kind)
	if !ok || !f.TimesAtMost || entries[d].Skipped || !h.IsComplete(d, entries[d].Value) {
		return nil
	}
	if _, others := p.completedIn(*h, entries, d); others >= p.needed(f, entries, p.startOf(d)) {
		return Invalid("times_maximum_reached", "the habit has already been done as often as the period allows")
	}
	return nil
}
