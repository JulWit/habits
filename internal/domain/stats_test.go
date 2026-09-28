package domain

import (
	"testing"
	"time"
)

// Fixtures are relative to Friday, 2026-09-18.
var (
	friday   = Date{2026, time.September, 18}
	monday   = Date{2026, time.September, 14}
	sunday   = Date{2026, time.September, 20}
	longAgo  = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	rateDays = DefaultRateWindowDays
)

// since returns a single schedule from the day of created on.
func since(created time.Time, target int, f Frequency) []Schedule {
	return []Schedule{{From: DateFromTime(created), TargetValue: target, Frequency: f}}
}

func weeklyHabit(timesPerWeek int) Habit {
	return Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: timesPerWeek}),
	}
}

func dailyHabit() Habit {
	return Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqDaily}),
	}
}

// fillWeekly ticks the first n days of every week between from and today.
func fillWeekly(from, today Date, n int) map[Date]int {
	entries := map[Date]int{}
	for week := from.StartOfWeek(); !week.After(today); week = week.AddDays(7) {
		for i := range n {
			if d := week.AddDays(i); !d.After(today) {
				entries[d] = 1
			}
		}
	}
	return entries
}

// A user who meets the weekly target every week reaches a rate of 100%.
func TestWeeklyRateReaches100ForAPerfectUser(t *testing.T) {
	for _, tc := range []struct {
		name  string
		today Date
	}{
		{"mid-week", friday},
		{"first day of the week", monday},
		{"last day of the week", sunday},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := weeklyHabit(3)
			entries := fillWeekly(tc.today.AddDays(-400), tc.today, 3)

			st := ComputeStats(h, valued(entries), tc.today, rateDays)
			if st.CompletionRate != 1 {
				t.Errorf("perfect user: rate = %.3f (%d/%d), want 1.000",
					st.CompletionRate, st.Achieved, st.Expected)
			}
			if st.StreakUnit != "weeks" {
				t.Errorf("streakUnit = %q, want weeks", st.StreakUnit)
			}
		})
	}
}

// The weekly rate does not depend on which days of the week are completed.
func TestWeeklyRateIgnoresWhereInTheWeekTheDaysFall(t *testing.T) {
	h := weeklyHabit(3)

	early := fillWeekly(friday.AddDays(-400), friday, 3) // Mon, Tue, Wed
	late := map[Date]int{}                               // Thu, Fri, Sat
	for week := friday.AddDays(-400).StartOfWeek(); !week.After(friday); week = week.AddDays(7) {
		for _, i := range []int{3, 4, 5} {
			if d := week.AddDays(i); !d.After(friday) {
				late[d] = 1
			}
		}
	}

	a := ComputeStats(h, valued(early), friday, rateDays)
	b := ComputeStats(h, valued(late), friday, rateDays)
	// Only the current week may differ.
	if a.Expected != b.Expected {
		t.Errorf("expected differs by placement: %d vs %d", a.Expected, b.Expected)
	}
	if a.CompletionRate != 1 {
		t.Errorf("Mon/Tue/Wed: rate = %.3f (%d/%d), want 1.000",
			a.CompletionRate, a.Achieved, a.Expected)
	}
}

// A missed week lowers the weekly rate.
func TestWeeklyRateCountsAMissedWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 3)
	// Wipe the week before last.
	missed := friday.StartOfWeek().AddDays(-14)
	for i := range 7 {
		delete(entries, missed.AddDays(i))
	}

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CompletionRate >= 1 {
		t.Errorf("missed week: rate = %.3f, want < 1", st.CompletionRate)
	}
	if st.Achieved >= st.Expected {
		t.Errorf("achieved %d should be below expected %d", st.Achieved, st.Expected)
	}
}

// Completions above the weekly target are not counted.
func TestWeeklyRateCapsAWeekAtItsTarget(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 7) // every single day
	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f (%d/%d), want exactly 1.000",
			st.CompletionRate, st.Achieved, st.Expected)
	}
}

// An incomplete current week does not break the weekly streak.
func TestWeeklyStreakSurvivesAnOpenCurrentWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 3)
	// Clear the current week.
	for i := range 7 {
		delete(entries, friday.StartOfWeek().AddDays(i))
	}

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CurrentStreak == 0 {
		t.Error("an open current week must not break the streak")
	}
}

func TestDailyRateAndStreak(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for d := friday.AddDays(-400); !d.After(friday); d = d.AddDays(1) {
		entries[d] = 1
	}

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f, want 1.000", st.CompletionRate)
	}
	if st.Expected != rateDays {
		t.Errorf("expected = %d, want %d", st.Expected, rateDays)
	}
	if st.CurrentStreak != 401 {
		t.Errorf("currentStreak = %d, want 401", st.CurrentStreak)
	}
	if st.StreakUnit != "days" {
		t.Errorf("streakUnit = %q, want days", st.StreakUnit)
	}
}

// An open today does not break the streak, but a missed day before it does.
func TestDailyStreakTreatsTodayAsOpen(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for d := friday.AddDays(-10); d.Before(friday); d = d.AddDays(1) {
		entries[d] = 1
	}
	if st := ComputeStats(h, valued(entries), friday, rateDays); st.CurrentStreak != 10 {
		t.Errorf("today still open: currentStreak = %d, want 10", st.CurrentStreak)
	}

	delete(entries, friday.AddDays(-1))
	if st := ComputeStats(h, valued(entries), friday, rateDays); st.CurrentStreak != 0 {
		t.Errorf("yesterday missed: currentStreak = %d, want 0", st.CurrentStreak)
	}
}

// Only scheduled days count.
func TestWeekdayHabitOnlyCountsItsOwnDays(t *testing.T) {
	h := Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}), // Mo–Fr
	}
	entries := map[Date]int{}
	for d := friday.AddDays(-60); !d.After(friday); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			entries[d] = 1
		}
	}

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f (%d/%d), want 1.000", st.CompletionRate, st.Achieved, st.Expected)
	}
	if st.Expected >= rateDays {
		t.Errorf("expected = %d, should be below %d — weekends are not due", st.Expected, rateDays)
	}
}

// Future entries are not included in the total.
func TestTotalExcludesTheFuture(t *testing.T) {
	h := Habit{
		Kind: KindDistance, CreatedAt: longAgo,
		Schedules: since(longAgo, 5000, Frequency{Kind: FreqDaily}),
	}
	entries := map[Date]int{
		friday:              5000,
		friday.AddDays(1):   9000, // planned
		friday.AddDays(-1):  3000,
		friday.AddDays(300): 1,
	}
	if st := ComputeStats(h, valued(entries), friday, rateDays); st.Total != 8000 {
		t.Errorf("total = %d, want 8000 (the future does not count)", st.Total)
	}
}

// A habit without entries has no streak.
func TestEmptyHistory(t *testing.T) {
	h := dailyHabit()
	st := ComputeStats(h, valued(map[Date]int{}), friday, rateDays)
	if st.CurrentStreak != 0 || st.BestStreak != 0 || st.Total != 0 {
		t.Errorf("empty history: %+v", st)
	}
	if st.CompletionRate != 0 {
		t.Errorf("rate = %.3f, want 0", st.CompletionRate)
	}
}

// The rate of a habit younger than the window starts at its creation day.
func TestHabitYoungerThanTheWindow(t *testing.T) {
	created := friday.AddDays(-4)
	h := Habit{
		Kind: KindCheck, CreatedAt: created.Time(),
		Schedules: since(created.Time(), 1, Frequency{Kind: FreqDaily}),
	}
	entries := map[Date]int{}
	for d := created; !d.After(friday); d = d.AddDays(1) {
		entries[d] = 1
	}

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.Expected != 5 {
		t.Errorf("expected = %d, want 5 — only the days since creation", st.Expected)
	}
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f, want 1.000", st.CompletionRate)
	}
}

// A window of 0 covers the whole history, a shorter one only its last days.
func TestRateWindow(t *testing.T) {
	h := dailyHabit()
	h.CreatedAt = friday.AddDays(-9).Time() // ten days of history
	entries := map[Date]int{}
	for i := range 5 {
		entries[friday.AddDays(-i)] = 1 // the last five days done
	}
	for window, want := range map[int][2]int{0: {5, 10}, 5: {5, 5}, 30: {5, 10}} {
		st := ComputeStats(h, valued(entries), friday, window)
		if st.Achieved != want[0] || st.Expected != want[1] {
			t.Errorf("window %d: %d of %d, want %d of %d", window, st.Achieved, st.Expected, want[0], want[1])
		}
	}
}
