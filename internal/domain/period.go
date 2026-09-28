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
	length := end.DaysSince(first)
	// Rounded up: skipping a single day of a week rarely lowers the target.
	t.target = (max(p.times(schedule.Frequency), 1)*available + length - 1) / length
	t.expected = t.target
	if open < available {
		// Partial periods expect a proportional share of the target.
		t.expected = (t.target*open + available - 1) / available
	}
	return t
}
