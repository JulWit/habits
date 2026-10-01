package domain

import "time"

// DayTotal counts, for one day, the habits due and how many of them are
// complete. A habit counts from the first day of its history; skipped days
// are not due. Days ahead have nothing done.
type DayTotal struct {
	Date Date `json:"date"`
	Due  int  `json:"due"`
	Done int  `json:"done"`
	// Bonus counts the habits done beyond what their week or month needs
	// (StatusBonus). They are neither due nor part of Done.
	Bonus int `json:"bonus"`
}

// Perfect reports whether every habit due on the day is complete.
func (t DayTotal) Perfect() bool { return t.Due > 0 && t.Done == t.Due }

// rate returns the share of the due habits that are complete, and false if
// nothing is due.
func (t DayTotal) rate() (float64, bool) {
	if t.Due == 0 {
		return 0, false
	}
	return float64(t.Done) / float64(t.Due), true
}

// DayTotals returns a DayTotal for every day from from to to, oldest first.
// entries holds the entries of each habit, keyed by habit ID.
func DayTotals(habits []Habit, entries map[string]map[Date]Entry, from, to, today Date) []DayTotal {
	if to.Before(from) {
		return nil
	}
	totals := make([]DayTotal, 0, to.DaysSince(from)+1)
	for d := from; !d.After(to); d = d.AddDays(1) {
		totals = append(totals, DayTotal{Date: d})
	}
	for _, h := range habits {
		own := entries[h.ID]
		start := HistoryStart(h, own)
		for i := range totals {
			d := totals[i].Date
			if d.Before(start) {
				continue
			}
			switch h.Status(d, own, start, today) {
			case StatusDone:
				totals[i].Due++
				if !d.After(today) {
					totals[i].Done++
				}
			case StatusBonus:
				if !d.After(today) {
					totals[i].Bonus++
				}
			case StatusOpen, StatusOver:
				totals[i].Due++
			}
		}
	}
	return totals
}

// PerfectStreaks returns the current and the longest run of perfect days in
// totals. Days without due habits neither extend nor end a run; an open today
// does not end the current one.
func PerfectStreaks(totals []DayTotal, today Date) (current, best int) {
	run := 0
	for _, t := range totals {
		if t.Due == 0 {
			continue
		}
		switch {
		case t.Perfect():
			run++
			best = max(best, run)
		case t.Date != today:
			run = 0
		}
	}
	return run, best
}

// DayGroup summarises the days of a weekday or month: the average share of
// completed habits (nil if nothing was due) and the number of perfect days.
type DayGroup struct {
	Rate    *float64 `json:"rate"`
	Perfect int      `json:"perfect"`
}

// DayStats are the statistics of the days view over a range of days up to
// today.
type DayStats struct {
	// Perfect is the number of perfect days, Counted the number of days with
	// a due habit.
	Perfect int `json:"perfect"`
	Counted int `json:"counted"`
	// CurrentStreak and BestStreak are runs of perfect days.
	CurrentStreak int `json:"currentStreak"`
	BestStreak    int `json:"bestStreak"`
	// Average is the average share of completed habits per day, nil if
	// nothing was due.
	Average *float64 `json:"average"`
	// Completed is the number of completed habit days.
	Completed int `json:"completed"`
	// EmptyDays is the number of days before today with due habits and none
	// completed.
	EmptyDays int `json:"emptyDays"`
	// Weekdays holds a group per weekday, Monday first.
	Weekdays [7]DayGroup `json:"weekdays"`
	// Months holds a group per month from FirstMonth to the month of the
	// last day.
	FirstMonth time.Month `json:"firstMonth"`
	Months     []DayGroup `json:"months"`
	// BestWeekday (0 = Monday) and BestMonth (1 = January) have the highest
	// average; -1 and 0 if nothing was due.
	BestWeekday int        `json:"bestWeekday"`
	BestMonth   time.Month `json:"bestMonth"`
}

// ComputeDayStats computes the statistics of totals, days of one year up to
// today at the latest.
func ComputeDayStats(totals []DayTotal, today Date) DayStats {
	st := DayStats{BestWeekday: -1}
	current, best := PerfectStreaks(totals, today)
	st.CurrentStreak, st.BestStreak = current, best
	for _, t := range totals {
		st.Completed += t.Done
		if t.Due == 0 {
			continue
		}
		st.Counted++
		if t.Perfect() {
			st.Perfect++
		}
		if t.Done == 0 && t.Date != today {
			st.EmptyDays++
		}
	}
	st.Average = averageRate(totals, today)

	var bestWeekdayRate float64
	for i := range 7 {
		days := filterTotals(totals, func(d Date) bool { return mondayIndex(d) == i })
		st.Weekdays[i] = group(days, today)
		if r := st.Weekdays[i].Rate; r != nil && (st.BestWeekday < 0 || *r > bestWeekdayRate) {
			st.BestWeekday, bestWeekdayRate = i, *r
		}
	}

	if len(totals) == 0 {
		return st
	}
	lastMonth := totals[len(totals)-1].Date.Month
	st.FirstMonth = lastMonth
	for _, t := range totals {
		if t.Due > 0 {
			st.FirstMonth = t.Date.Month
			break
		}
	}
	var bestMonthRate float64
	for m := st.FirstMonth; m <= lastMonth; m++ {
		days := filterTotals(totals, func(d Date) bool { return d.Month == m })
		g := group(days, today)
		st.Months = append(st.Months, g)
		if g.Rate != nil && (st.BestMonth == 0 || *g.Rate > bestMonthRate) {
			st.BestMonth, bestMonthRate = m, *g.Rate
		}
	}
	return st
}

// averageRate returns the average share of completed habits of the days with
// due habits before today, or of today alone if there are none; nil if
// nothing was due.
func averageRate(totals []DayTotal, today Date) *float64 {
	sum, n := 0.0, 0
	add := func(t DayTotal) {
		if r, ok := t.rate(); ok {
			sum += r
			n++
		}
	}
	for _, t := range totals {
		if t.Date != today {
			add(t)
		}
	}
	if n == 0 {
		for _, t := range totals {
			if t.Date == today {
				add(t)
			}
		}
	}
	if n == 0 {
		return nil
	}
	avg := sum / float64(n)
	return &avg
}

// group summarises days as a DayGroup.
func group(days []DayTotal, today Date) DayGroup {
	g := DayGroup{Rate: averageRate(days, today)}
	for _, t := range days {
		if t.Perfect() {
			g.Perfect++
		}
	}
	return g
}

// filterTotals returns the totals whose day matches keep.
func filterTotals(totals []DayTotal, keep func(Date) bool) []DayTotal {
	var out []DayTotal
	for _, t := range totals {
		if keep(t.Date) {
			out = append(out, t)
		}
	}
	return out
}

// mondayIndex returns the weekday of d, 0 for Monday.
func mondayIndex(d Date) int { return (int(d.Weekday()) + 6) % 7 }
