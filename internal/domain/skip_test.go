package domain

import (
	"testing"
	"time"
)

// A skipped day neither breaks nor extends a streak, and it is left out of
// the completion rate.
func TestSkippedDayKeepsTheStreak(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]Entry{}
	for i := -5; i <= 0; i++ {
		entries[friday.AddDays(i)] = Entry{Value: 1}
	}
	entries[friday.AddDays(-2)] = Entry{Skipped: true}

	st := ComputeStats(h, entries, friday, 6)
	if st.CurrentStreak != 5 {
		t.Errorf("streak = %d, want 5 (the skipped day does not count)", st.CurrentStreak)
	}
	if st.Expected != 5 || st.Achieved != 5 {
		t.Errorf("rate counts %d of %d, want 5 of 5", st.Achieved, st.Expected)
	}
	// The run spans the skipped day.
	wantRuns(t, StreakRuns(h, entries, friday), [][2]int{{-5, 0}})
}

// Skipping days of a times-per-week habit lowers the week's target in
// proportion, rounded up; a week skipped entirely neither extends nor breaks
// the streak.
func TestSkippedDaysLowerTheWeeklyTarget(t *testing.T) {
	h := weeklyHabit(3)
	lastWeek := monday.AddDays(-7)
	entries := map[Date]Entry{}
	// Last week: four days skipped leave three, so 3×3/7 rounds up to 2.
	for i := range 4 {
		entries[lastWeek.AddDays(i)] = Entry{Skipped: true}
	}
	entries[lastWeek.AddDays(4)] = Entry{Value: 1}
	entries[lastWeek.AddDays(5)] = Entry{Value: 1}
	// The week before is skipped entirely, the one before that is met.
	for i := range 7 {
		entries[lastWeek.AddDays(-7+i)] = Entry{Skipped: true}
	}
	for i := range 3 {
		entries[lastWeek.AddDays(-14+i)] = Entry{Value: 1}
	}

	st := ComputeStats(h, entries, sunday, rateDays)
	// This week has nothing yet and is still open.
	if st.CurrentStreak != 2 {
		t.Errorf("streak = %d, want 2 weeks", st.CurrentStreak)
	}

	w := weekPeriod.tally(h, entries, lastWeek, DateFromTime(longAgo), sunday)
	if w.target != 2 || w.done != 2 {
		t.Errorf("last week: %d of %d, want 2 of 2", w.done, w.target)
	}
}

// A limit is met while the value stays at or below it, and a day without a
// value meets it too.
func TestLimitCompletesDaysWithinIt(t *testing.T) {
	h := countHabit()
	h.Schedules[0].TargetType = TargetAtMost
	h.Schedules[0].TargetValue = 20 // at most 2

	for value, want := range map[int]bool{0: true, 10: true, 20: true, 30: false} {
		if got := h.IsComplete(friday, value); got != want {
			t.Errorf("IsComplete(%d) = %v, want %v", value, got, want)
		}
	}

	h.CreatedAt = time.Date(2026, time.September, 14, 12, 0, 0, 0, time.UTC) // Monday
	entries := valued(map[Date]int{friday.AddDays(-3): 30})                  // over on Tuesday
	st := ComputeStats(h, entries, friday, rateDays)
	if st.CurrentStreak != 3 || st.BestStreak != 3 {
		t.Errorf("streak %d, best %d; want 3 and 3 (Wednesday to Friday)", st.CurrentStreak, st.BestStreak)
	}
	if st.Expected != 5 || st.Achieved != 4 {
		t.Errorf("rate counts %d of %d, want 4 of 5", st.Achieved, st.Expected)
	}
}

// A limit of 0 means none at all.
func TestLimitOfZero(t *testing.T) {
	h := countHabit()
	h.Schedules[0] = Schedule{From: friday, TargetValue: 0, TargetType: TargetAtMost, Frequency: Frequency{Kind: FreqDaily}}
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if !h.IsComplete(friday, 0) || h.IsComplete(friday, 10) {
		t.Error("a limit of 0 should be met by nothing and broken by anything")
	}
}
