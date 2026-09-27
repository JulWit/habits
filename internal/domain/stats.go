package domain

// Stats summarises a habit's history. Streaks cover the full history; the
// completion rate covers a recent window only.
type Stats struct {
	CurrentStreak  int     `json:"currentStreak"`
	BestStreak     int     `json:"bestStreak"`
	CompletionRate float64 `json:"completionRate"`
	// Expected and Achieved are the counts behind CompletionRate: days, or
	// completions for times-per-week habits.
	Expected int `json:"expected"`
	Achieved int `json:"achieved"`
	// Total is the sum of all values recorded up to today.
	Total int `json:"total"`
	// StreakUnit is "days" or "weeks".
	StreakUnit string `json:"streakUnit"`
}

// DefaultRateWindowDays is the default window for the completion rate.
const DefaultRateWindowDays = 30

// ComputeStats computes the statistics of a habit from all its entries. The
// completion rate covers the last windowDays days. An open today does not
// break a streak.
func ComputeStats(h Habit, entries map[Date]int, today Date, windowDays int) Stats {
	if windowDays < 1 {
		windowDays = DefaultRateWindowDays
	}
	if h.Frequency.Kind == FreqTimesPerWeek {
		return weeklyStats(h, entries, today, windowDays)
	}
	return dailyStats(h, entries, today, windowDays)
}

// historyStart returns the creation day of the habit, or the earliest entry if
// that is earlier.
func historyStart(h Habit, entries map[Date]int) Date {
	start := DateFromTime(h.CreatedAt)
	for d := range entries {
		if start.IsZero() || d.Before(start) {
			start = d
		}
	}
	return start
}

// totalValue sums the values of all entries up to today.
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

// dailyStats computes the statistics of a habit with fixed due days.
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
			// Today is still open and does not break the streak.
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

// weeklyStats computes the statistics of a times-per-week habit. A week counts
// as met once the target number of days is completed. The rate window is
// rounded up to whole weeks.
func weeklyStats(h Habit, entries map[Date]int, today Date, windowDays int) Stats {
	st := Stats{StreakUnit: "weeks", Total: totalValue(entries, today)}
	target := max(h.Frequency.TimesPerWeek, 1)
	start := historyStart(h, entries)
	if start.IsZero() || start.After(today) {
		return st
	}

	firstWeek := start.StartOfWeek()
	currentWeek := today.StartOfWeek()
	windowWeeks := (windowDays + 6) / 7
	windowFirstWeek := currentWeek.AddDays(-7 * (windowWeeks - 1))

	run := 0
	for week := firstWeek; !week.After(currentWeek); week = week.AddDays(7) {
		done, open := weekCompletions(h, entries, week, start, today)
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
		// Partial weeks expect a proportional share of the target, rounded up.
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

// weekCompletions returns the number of completed days in the week starting
// on week, and the number of its days that lie within the habit's history,
// i.e. between start and today.
func weekCompletions(h Habit, entries map[Date]int, week, start, today Date) (done, open int) {
	for i := range 7 {
		d := week.AddDays(i)
		if d.Before(start) || d.After(today) {
			continue
		}
		open++
		if h.IsComplete(entries[d]) {
			done++
		}
	}
	return done, open
}
