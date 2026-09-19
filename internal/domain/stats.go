package domain

// Stats summarises a habit's history. Streaks are computed over the full
// history while the completion rate is windowed, because a streak that is two
// years old is still the honest answer to "best streak" whereas a completion
// rate over all time stops reacting to recent effort.
type Stats struct {
	CurrentStreak  int     `json:"currentStreak"`
	BestStreak     int     `json:"bestStreak"`
	CompletionRate float64 `json:"completionRate"`
	// Expected and Achieved are the raw numbers behind CompletionRate, in days
	// for daily-style habits and in single completions for times-per-week.
	Expected int `json:"expected"`
	Achieved int `json:"achieved"`
	// Total is the sum of all recorded values: check-marks, glasses, minutes.
	Total int `json:"total"`
	// StreakUnit is "days" or "weeks" and tells the UI how to label a streak.
	StreakUnit string `json:"streakUnit"`
}

// DefaultRateWindowDays is the window the overview uses for completion rates.
const DefaultRateWindowDays = 30

// ComputeStats derives the statistics for a habit from its complete entry map.
//
// A day still open (today) never breaks a streak: an unfinished day is not yet
// a failed day, so the run is carried forward instead of reset. This matches
// what Loop does and is the behaviour users expect from a tracker they open in
// the morning.
func ComputeStats(h Habit, entries map[Date]int, today Date, windowDays int) Stats {
	if windowDays < 1 {
		windowDays = DefaultRateWindowDays
	}
	if h.Frequency.Kind == FreqTimesPerWeek {
		return weeklyStats(h, entries, today, windowDays)
	}
	return dailyStats(h, entries, today, windowDays)
}

// historyStart is the first day worth walking: the habit's creation day, or an
// earlier entry if history was backfilled.
func historyStart(h Habit, entries map[Date]int) Date {
	start := DateFromTime(h.CreatedAt)
	for d := range entries {
		if start.IsZero() || d.Before(start) {
			start = d
		}
	}
	return start
}

// totalValue sums what has actually happened. Days ahead of today can hold
// entries - a planned run, a week filled in before a holiday - but a plan is
// not an achievement, so it stays out of the total until its day arrives.
func totalValue(entries map[Date]int, today Date) int {
	sum := 0
	for d, v := range entries {
		if d.After(today) {
			continue
		}
		sum += v
	}
	return sum
}

func dailyStats(h Habit, entries map[Date]int, today Date, windowDays int) Stats {
	st := Stats{StreakUnit: "days", Total: totalValue(entries, today)}
	start := historyStart(h, entries)
	if start.IsZero() || start.After(today) {
		return st
	}

	run := 0
	for d := start; !d.After(today); d = d.AddDays(1) {
		if !h.IsScheduled(d) {
			continue
		}
		switch {
		case h.IsComplete(entries[d]):
			run++
			if run > st.BestStreak {
				st.BestStreak = run
			}
		case d == today:
			// Today is still open; leave the run standing.
		default:
			run = 0
		}
	}
	st.CurrentStreak = run

	from := today.AddDays(-(windowDays - 1))
	if from.Before(start) {
		from = start
	}
	for d := from; !d.After(today); d = d.AddDays(1) {
		if !h.IsScheduled(d) {
			continue
		}
		st.Expected++
		if h.IsComplete(entries[d]) {
			st.Achieved++
		}
	}
	if st.Expected > 0 {
		st.CompletionRate = float64(st.Achieved) / float64(st.Expected)
	}
	return st
}

// weeklyStats treats an x-times-per-week habit as a sequence of weeks: a week
// counts once the target number of days is reached, no matter which days those
// were.
//
// The rate is therefore measured in whole weeks rather than in the raw day
// window. A window ending mid-week would report a met week as missed whenever
// its completed days fell on the far side of the cut, so someone who never
// misses could never reach 100%.
func weeklyStats(h Habit, entries map[Date]int, today Date, windowDays int) Stats {
	st := Stats{StreakUnit: "weeks", Total: totalValue(entries, today)}
	target := h.Frequency.TimesPerWeek
	if target < 1 {
		target = 1
	}
	start := historyStart(h, entries)
	if start.IsZero() || start.After(today) {
		return st
	}

	firstWeek := start.StartOfWeek()
	currentWeek := today.StartOfWeek()
	// The window rounded up to whole weeks, ending with the current one.
	windowWeeks := (windowDays + 6) / 7
	windowFirstWeek := currentWeek.AddDays(-7 * (windowWeeks - 1))

	run := 0
	for week := firstWeek; !week.After(currentWeek); week = week.AddDays(7) {
		// open is how many days of the week the habit was around for: seven for
		// an ordinary week, fewer for the current one and for the week the
		// habit was created in.
		done, open := 0, 0
		for i := 0; i < 7; i++ {
			d := week.AddDays(i)
			if d.Before(start) || d.After(today) {
				continue
			}
			open++
			if h.IsComplete(entries[d]) {
				done++
			}
		}
		switch {
		case done >= target:
			run++
			if run > st.BestStreak {
				st.BestStreak = run
			}
		case week == currentWeek:
			// The current week can still be completed.
		default:
			run = 0
		}

		if week.Before(windowFirstWeek) {
			continue
		}
		// A week offering fewer days expects proportionally less of its target,
		// rounded up so some effort is always asked for. Without this the
		// current week would be judged on days that have not happened yet — the
		// daily rate never judges tomorrow either.
		expected := target
		if open < 7 {
			expected = (target*open + 6) / 7
		}
		st.Expected += expected
		st.Achieved += min(done, expected)
	}
	st.CurrentStreak = run
	if st.Expected > 0 {
		st.CompletionRate = float64(st.Achieved) / float64(st.Expected)
	}
	return st
}
