package domain

// Stats summarises a habit's history. Streaks cover the full history; the
// completion rate covers a recent window only.
type Stats struct {
	CurrentStreak  int     `json:"currentStreak"`
	BestStreak     int     `json:"bestStreak"`
	CompletionRate float64 `json:"completionRate"`
	// Expected and Achieved are the counts behind CompletionRate: days, or
	// completions for times-per-week and times-per-month habits.
	Expected int `json:"expected"`
	Achieved int `json:"achieved"`
	// Total is the sum of all values recorded up to today.
	Total int `json:"total"`
	// StreakUnit is "days", "weeks" or "months".
	StreakUnit string `json:"streakUnit"`
	// LastDone is the latest complete due day up to today, "" if none.
	LastDone Date `json:"lastDone"`
}

// DefaultRateWindowDays is the default window for the completion rate.
const DefaultRateWindowDays = 30

// ComputeStats computes the statistics of a habit from all its entries. The
// completion rate covers the last windowDays days, or the whole history for
// 0. An open today does not break a streak, and skipped days count as not
// due.
func ComputeStats(h Habit, entries map[Date]Entry, today Date, windowDays int) Stats {
	var st Stats
	if p, ok := periodOf(h.Current().Frequency.Kind); ok {
		st = periodicStats(h, entries, today, windowDays, p)
	} else {
		st = dailyStats(h, entries, today, windowDays)
	}
	st.LastDone = LastDone(h, entries, today)
	return st
}

// HistoryStart returns the first day of the habit's history: its creation day,
// or its earliest entry if that is earlier.
func HistoryStart(h Habit, entries map[Date]Entry) Date {
	start := DateFromTime(h.CreatedAt)
	for d := range entries {
		if start.IsZero() || d.Before(start) {
			start = d
		}
	}
	return start
}

// rateStart returns the first day the completion rate covers: windowDays days
// back from today, but not before the habit's first day start. A window of
// 0 covers the whole history.
func rateStart(today, start Date, windowDays int) Date {
	if windowDays < 1 {
		return start
	}
	from := today.AddDays(-(windowDays - 1))
	if from.Before(start) {
		return start
	}
	return from
}

// isDue reports whether d is a due day of the habit: scheduled and not
// skipped.
func isDue(h Habit, entries map[Date]Entry, d Date) bool {
	return h.IsScheduled(d) && !entries[d].Skipped
}

// totalValue sums the values of all entries up to today.
func totalValue(entries map[Date]Entry, today Date) int {
	sum := 0
	for d, e := range entries {
		if d.After(today) {
			continue
		}
		sum += e.Value
	}
	return sum
}

// dailyStats computes the statistics of a habit with fixed due days.
func dailyStats(h Habit, entries map[Date]Entry, today Date, windowDays int) Stats {
	st := Stats{StreakUnit: "days", Total: totalValue(entries, today)}
	start := HistoryStart(h, entries)
	if start.IsZero() || start.After(today) {
		return st
	}

	run := 0
	for d := start; !d.After(today); d = d.AddDays(1) {
		if !isDue(h, entries, d) {
			continue
		}
		switch {
		case h.IsComplete(d, entries[d].Value):
			run++
			if run > st.BestStreak {
				st.BestStreak = run
			}
		case d == today:
			// Today is still open and does not break the streak.
		default:
			run = 0
		}
	}
	st.CurrentStreak = run

	from := rateStart(today, start, windowDays)
	for d := from; !d.After(today); d = d.AddDays(1) {
		if !isDue(h, entries, d) {
			continue
		}
		st.Expected++
		if h.IsComplete(d, entries[d].Value) {
			st.Achieved++
		}
	}
	if st.Expected > 0 {
		st.CompletionRate = float64(st.Achieved) / float64(st.Expected)
	}
	return st
}

// periodicStats computes the statistics of a times-per-week or
// times-per-month habit. A period counts as met once its target is reached
// (see period.tally). The rate window is extended to whole periods.
func periodicStats(h Habit, entries map[Date]Entry, today Date, windowDays int, p period) Stats {
	st := Stats{StreakUnit: p.streakUnit(), Total: totalValue(entries, today)}
	start := HistoryStart(h, entries)
	if start.IsZero() || start.After(today) {
		return st
	}

	current := p.startOf(today)
	windowFirst := p.startOf(rateStart(today, start, windowDays))

	run := 0
	for first := p.startOf(start); !first.After(current); first = p.next(first) {
		t := p.tally(h, entries, first, start, today)
		switch {
		case t.target == 0:
			// Nothing was due: the period neither extends nor breaks the
			// streak.
			continue
		case t.done >= t.target:
			run++
			if run > st.BestStreak {
				st.BestStreak = run
			}
		case first == current:
			// The current period can still be completed.
		default:
			run = 0
		}

		if first.Before(windowFirst) {
			continue
		}
		st.Expected += t.expected
		st.Achieved += min(t.done, t.expected)
	}
	st.CurrentStreak = run
	if st.Expected > 0 {
		st.CompletionRate = float64(st.Achieved) / float64(st.Expected)
	}
	return st
}
