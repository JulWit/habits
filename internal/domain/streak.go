package domain

// StreakRun is an unbroken run of completed due days, from its first to its
// last day. Skipped days inside a run belong to it.
type StreakRun struct {
	From Date `json:"from"`
	To   Date `json:"to"`
}

// StreakRuns returns all streak runs of a habit up to today, oldest first. An
// open today does not end a run.
func StreakRuns(h Habit, entries map[Date]Entry, today Date) []StreakRun {
	if p, ok := periodOf(h.Current().Frequency.Kind); ok {
		return periodicRuns(h, entries, today, p)
	}
	return dailyRuns(h, entries, today)
}

// dailyRuns returns the runs of a habit with fixed due days.
func dailyRuns(h Habit, entries map[Date]Entry, today Date) []StreakRun {
	start := HistoryStart(h, entries)
	if start.IsZero() || start.After(today) {
		return nil
	}

	var runs []StreakRun
	var open *StreakRun
	for d := start; !d.After(today); d = d.AddDays(1) {
		if !isDue(h, entries, d) {
			continue
		}
		switch {
		case h.IsComplete(d, entries[d].Value):
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
		// A current run extends to today, including days that are not due.
		open.To = today
		runs = append(runs, *open)
	}
	return runs
}

// periodicRuns returns the runs of a times-per-week or times-per-month habit,
// based on completed periods but expressed in days.
func periodicRuns(h Habit, entries map[Date]Entry, today Date, p period) []StreakRun {
	start := HistoryStart(h, entries)
	if start.IsZero() || start.After(today) {
		return nil
	}
	current := p.startOf(today)

	var runs []StreakRun
	var open *StreakRun
	for first := p.startOf(start); !first.After(current); first = p.next(first) {
		t := p.tally(h, entries, first, start, today)
		switch {
		case t.target == 0:
			// Nothing was due: the period neither extends nor ends the run.
			continue
		case t.done >= t.target:
			if open == nil {
				// A run does not start before the habit's history.
				open = &StreakRun{From: first}
				if first.Before(start) {
					open.From = start
				}
			}
			open.To = p.next(first).AddDays(-1).Min(today)
		case first == current:
			// The current period can still be completed and does not end the
			// run.
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
