package domain

// StreakRun is one unbroken stretch of a habit being kept up, as the first and
// the last calendar day it covers.
//
// The board paints the days inside a run by how long the run had been going at
// that point, which is why the run is shipped as a pair of dates rather than as
// a count: the first day is often older than the history the client was sent,
// and a count would have to be recomputed for every single cell.
type StreakRun struct {
	From Date `json:"from"`
	To   Date `json:"to"`
}

// StreakRuns lists every unbroken run in a habit's history, oldest first.
//
// A run is measured in calendar days rather than in the units the streak
// counter uses. The levels the board paints are stated in weeks and months, and
// a Mon/Wed/Fri habit should reach "a week" after a week rather than after
// seven of its own days — a run of seven Mondays is over six weeks of history,
// and colouring it as one week would say the opposite of what it is.
//
// The current run is included while it stands: today being still open never
// ends a run, exactly as it never breaks the streak counter.
func StreakRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	if h.Frequency.Kind == FreqTimesPerWeek {
		return weeklyRuns(h, entries, today)
	}
	return dailyRuns(h, entries, today)
}

func dailyRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	start := historyStart(h, entries)
	if start.IsZero() || start.After(today) {
		return nil
	}

	var runs []StreakRun
	var open *StreakRun
	for d := start; !d.After(today); d = d.AddDays(1) {
		if !h.IsScheduled(d) {
			continue
		}
		switch {
		case h.IsComplete(entries[d]):
			if open == nil {
				open = &StreakRun{From: d}
			}
			open.To = d
		case d == today:
			// Today is still open; leave the run standing.
		default:
			if open != nil {
				runs = append(runs, *open)
				open = nil
			}
		}
	}
	if open != nil {
		// A run that is still standing reaches to today rather than to the last
		// day the habit was due. Otherwise a Mon–Fri habit ticked off on the
		// Saturday as well would show that extra day in plain colour, as though
		// doing more than was asked had ended the run.
		open.To = today
		runs = append(runs, *open)
	}
	return runs
}

// weeklyRuns works in whole weeks, the unit an x-times-per-week habit is judged
// in, and then reports the run in days so the caller does not have to know
// which of the two a habit uses.
func weeklyRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	target := h.Frequency.TimesPerWeek
	if target < 1 {
		target = 1
	}
	start := historyStart(h, entries)
	if start.IsZero() || start.After(today) {
		return nil
	}
	currentWeek := today.StartOfWeek()

	var runs []StreakRun
	var open *StreakRun
	for week := start.StartOfWeek(); !week.After(currentWeek); week = week.AddDays(7) {
		done := 0
		for i := 0; i < 7; i++ {
			d := week.AddDays(i)
			if d.Before(start) || d.After(today) {
				continue
			}
			if h.IsComplete(entries[d]) {
				done++
			}
		}
		switch {
		case done >= target:
			if open == nil {
				// The week the habit was created in starts at the habit, not at
				// its Monday: a run may not claim days that predate its owner.
				first := week
				if first.Before(start) {
					first = start
				}
				open = &StreakRun{From: first}
			}
			open.To = week.AddDays(6).Min(today)
		case week == currentWeek:
			// The current week can still be met, so a run reaching into it
			// keeps colouring the days already ticked off in it.
			if open != nil {
				open.To = today
			}
		default:
			if open != nil {
				runs = append(runs, *open)
				open = nil
			}
		}
	}
	if open != nil {
		runs = append(runs, *open)
	}
	return runs
}
