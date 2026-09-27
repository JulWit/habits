package domain

// StreakRun is an unbroken run of completed scheduled days, from its first to
// its last day.
type StreakRun struct {
	From Date `json:"from"`
	To   Date `json:"to"`
}

// StreakRuns returns all streak runs of a habit up to today, oldest first. An
// open today does not end a run.
func StreakRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	if h.Frequency.Kind == FreqTimesPerWeek {
		return weeklyRuns(h, entries, today)
	}
	return dailyRuns(h, entries, today)
}

// dailyRuns returns the runs of a habit with fixed due days.
func dailyRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	start := HistoryStart(h, entries)
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
		case h.IsComplete(d, entries[d]):
			if open == nil {
				open = &StreakRun{From: d}
			}
			open.To = d
		case d == today:
			// Today is still open and does not end the run.
		default:
			if open != nil {
				runs = append(runs, *open)
				open = nil
			}
		}
	}
	if open != nil {
		// A current run extends to today, including unscheduled days.
		open.To = today
		runs = append(runs, *open)
	}
	return runs
}

// weeklyRuns returns the runs of a times-per-week habit, based on completed
// weeks but expressed in days.
func weeklyRuns(h Habit, entries map[Date]int, today Date) []StreakRun {
	start := HistoryStart(h, entries)
	if start.IsZero() || start.After(today) {
		return nil
	}
	currentWeek := today.StartOfWeek()

	var runs []StreakRun
	var open *StreakRun
	for week := start.StartOfWeek(); !week.After(currentWeek); week = week.AddDays(7) {
		w := tallyWeek(h, entries, week, start, today)
		switch {
		case w.target == 0:
			// Nothing was due: the week neither extends nor ends the run.
			continue
		case w.done >= w.target:
			if open == nil {
				// A run does not start before the habit's history.
				first := week
				if first.Before(start) {
					first = start
				}
				open = &StreakRun{From: first}
			}
			open.To = week.AddDays(6).Min(today)
		case week == currentWeek:
			// The current week can still be completed and does not end the run.
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
