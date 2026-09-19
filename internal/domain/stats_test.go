package domain

import (
	"testing"
	"time"
)

// 2026-09-18 is a Friday; every fixture below is anchored to it so the weekday
// a case depends on is visible in the test rather than in the calendar.
var (
	friday   = Date{2026, time.September, 18}
	monday   = Date{2026, time.September, 14}
	sunday   = Date{2026, time.September, 20}
	longAgo  = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	rateDays = DefaultRateWindowDays
)

func weeklyHabit(timesPerWeek int) Habit {
	return Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: timesPerWeek},
	}
}

func dailyHabit() Habit {
	return Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqDaily},
	}
}

// fillWeekly ticks the first n days of every week between from and today.
func fillWeekly(from, today Date, n int) map[Date]int {
	entries := map[Date]int{}
	for week := from.StartOfWeek(); !week.After(today); week = week.AddDays(7) {
		for i := 0; i < n; i++ {
			if d := week.AddDays(i); !d.After(today) {
				entries[d] = 1
			}
		}
	}
	return entries
}

// The regression this file exists for: the rate used to be measured over a raw
// 30-day window, which cut a week in half and then judged that week on the days
// that happened to land inside the cut. Someone who met the target every single
// week saw 80%.
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

			st := ComputeStats(h, entries, tc.today, rateDays)
			if st.CompletionRate != 1 {
				t.Errorf("perfekter Nutzer: rate = %.3f (%d/%d), want 1.000",
					st.CompletionRate, st.Achieved, st.Expected)
			}
			if st.StreakUnit != "weeks" {
				t.Errorf("streakUnit = %q, want weeks", st.StreakUnit)
			}
		})
	}
}

// The completed days sit on the far side of the window edge. Before the fix
// this was the case that produced a missed week out of a met one.
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

	a := ComputeStats(h, early, friday, rateDays)
	b := ComputeStats(h, late, friday, rateDays)
	// The current week is short either way, so both are judged on what it can
	// still offer; what must not differ is the verdict on the weeks behind it.
	if a.Expected != b.Expected {
		t.Errorf("expected differs by placement: %d vs %d", a.Expected, b.Expected)
	}
	if a.CompletionRate != 1 {
		t.Errorf("Mo/Di/Mi: rate = %.3f (%d/%d), want 1.000",
			a.CompletionRate, a.Achieved, a.Expected)
	}
}

// A week the user genuinely missed still has to cost them.
func TestWeeklyRateCountsAMissedWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 3)
	// Wipe the week before last.
	missed := friday.StartOfWeek().AddDays(-14)
	for i := 0; i < 7; i++ {
		delete(entries, missed.AddDays(i))
	}

	st := ComputeStats(h, entries, friday, rateDays)
	if st.CompletionRate >= 1 {
		t.Errorf("verpasste Woche: rate = %.3f, want < 1", st.CompletionRate)
	}
	if st.Achieved >= st.Expected {
		t.Errorf("achieved %d should be below expected %d", st.Achieved, st.Expected)
	}
}

// Overshooting a weekly target does not bank credit against other weeks.
func TestWeeklyRateCapsAWeekAtItsTarget(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 7) // every single day
	st := ComputeStats(h, entries, friday, rateDays)
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f (%d/%d), want exactly 1.000",
			st.CompletionRate, st.Achieved, st.Expected)
	}
}

// An unfinished week never breaks the run, matching the daily rule for today.
func TestWeeklyStreakSurvivesAnOpenCurrentWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-400), friday, 3)
	// Clear only the current week: it is open, not failed.
	for i := 0; i < 7; i++ {
		delete(entries, friday.StartOfWeek().AddDays(i))
	}

	st := ComputeStats(h, entries, friday, rateDays)
	if st.CurrentStreak == 0 {
		t.Error("offene laufende Woche darf die Serie nicht abreißen lassen")
	}
}

func TestDailyRateAndStreak(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for d := friday.AddDays(-400); !d.After(friday); d = d.AddDays(1) {
		entries[d] = 1
	}

	st := ComputeStats(h, entries, friday, rateDays)
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

// Today is still open: it must not reset the run, but a gap before it must.
func TestDailyStreakTreatsTodayAsOpen(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for d := friday.AddDays(-10); d.Before(friday); d = d.AddDays(1) {
		entries[d] = 1
	}
	if st := ComputeStats(h, entries, friday, rateDays); st.CurrentStreak != 10 {
		t.Errorf("heute offen: currentStreak = %d, want 10", st.CurrentStreak)
	}

	delete(entries, friday.AddDays(-1))
	if st := ComputeStats(h, entries, friday, rateDays); st.CurrentStreak != 0 {
		t.Errorf("gestern verpasst: currentStreak = %d, want 0", st.CurrentStreak)
	}
}

// Only scheduled days count, so a weekday habit is not punished for Sundays.
func TestWeekdayHabitOnlyCountsItsOwnDays(t *testing.T) {
	h := Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}, // Mo–Fr
	}
	entries := map[Date]int{}
	for d := friday.AddDays(-60); !d.After(friday); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			entries[d] = 1
		}
	}

	st := ComputeStats(h, entries, friday, rateDays)
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f (%d/%d), want 1.000", st.CompletionRate, st.Achieved, st.Expected)
	}
	if st.Expected >= rateDays {
		t.Errorf("expected = %d, should be below %d — weekends are not due", st.Expected, rateDays)
	}
}

// A planned run tomorrow is not an achievement today.
func TestTotalExcludesTheFuture(t *testing.T) {
	h := Habit{
		Kind: KindDistance, TargetValue: 5000, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqDaily},
	}
	entries := map[Date]int{
		friday:              5000,
		friday.AddDays(1):   9000, // planned
		friday.AddDays(-1):  3000,
		friday.AddDays(300): 1,
	}
	if st := ComputeStats(h, entries, friday, rateDays); st.Total != 8000 {
		t.Errorf("total = %d, want 8000 (Zukunft zählt nicht mit)", st.Total)
	}
}

// A habit with no history at all must not report a phantom streak.
func TestEmptyHistory(t *testing.T) {
	h := dailyHabit()
	st := ComputeStats(h, map[Date]int{}, friday, rateDays)
	if st.CurrentStreak != 0 || st.BestStreak != 0 || st.Total != 0 {
		t.Errorf("leere Historie: %+v", st)
	}
	if st.CompletionRate != 0 {
		t.Errorf("rate = %.3f, want 0", st.CompletionRate)
	}
}

// A habit created inside the window is judged only from its creation day on.
func TestHabitYoungerThanTheWindow(t *testing.T) {
	created := friday.AddDays(-4)
	h := Habit{
		Kind: KindCheck, TargetValue: 1,
		CreatedAt: created.Time(),
		Frequency: Frequency{Kind: FreqDaily},
	}
	entries := map[Date]int{}
	for d := created; !d.After(friday); d = d.AddDays(1) {
		entries[d] = 1
	}

	st := ComputeStats(h, entries, friday, rateDays)
	if st.Expected != 5 {
		t.Errorf("expected = %d, want 5 — nur die Tage seit der Anlage", st.Expected)
	}
	if st.CompletionRate != 1 {
		t.Errorf("rate = %.3f, want 1.000", st.CompletionRate)
	}
}
