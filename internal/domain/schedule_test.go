package domain

import (
	"errors"
	"testing"
)

// countHabit returns a count habit with a target of six, created long ago.
func countHabit() Habit {
	return Habit{
		Name: "Water", Color: "sky", Kind: KindCount, TargetValue: 60,
		CreatedAt: longAgo, Frequency: Frequency{Kind: FreqDaily},
	}
}

// Raising the target does not rewrite the days before the change.
func TestRaisingTheTargetKeepsThePast(t *testing.T) {
	h := countHabit()
	entries := map[Date]int{}
	for i := 1; i <= 10; i++ {
		entries[friday.AddDays(-i)] = 60
	}

	prev := h.Current()
	h.TargetValue = 80
	if err := h.Reschedule(prev, friday, false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}

	if got := h.Target(friday.AddDays(-1)); got != 60 {
		t.Errorf("target yesterday = %d, want 60", got)
	}
	if got := h.Target(friday); got != 80 {
		t.Errorf("target today = %d, want 80", got)
	}
	st := ComputeStats(h, entries, friday, rateDays)
	if st.CurrentStreak != 10 {
		t.Errorf("current streak = %d, want 10", st.CurrentStreak)
	}
}

// A retroactive change applies the new schedule to every day.
func TestRetroactiveRescheduleReplacesTheHistory(t *testing.T) {
	h := countHabit()
	prev := h.Current()
	h.TargetValue = 80
	if err := h.Reschedule(prev, friday.AddDays(-5), false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}

	prev = h.Current()
	h.TargetValue = 100
	if err := h.Reschedule(prev, friday, true); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	if len(h.Previous) != 0 {
		t.Fatalf("previous = %v, want none", h.Previous)
	}
	if got := h.Target(friday.AddDays(-100)); got != 100 {
		t.Errorf("target long ago = %d, want 100", got)
	}
	if h.Since != DateFromTime(longAgo) {
		t.Errorf("since = %v, want the creation day", h.Since)
	}
}

// Two changes on the same day leave one schedule for that day, and changing
// back to the old schedule merges both.
func TestReschedulingTwiceOnADayKeepsOneVersion(t *testing.T) {
	h := countHabit()
	original := h.Current()

	h.TargetValue = 80
	if err := h.Reschedule(original, friday, false); err != nil {
		t.Fatal(err)
	}
	prev := h.Current()
	h.TargetValue = 90
	if err := h.Reschedule(prev, friday, false); err != nil {
		t.Fatal(err)
	}
	if len(h.Previous) != 1 || h.Since != friday || h.TargetValue != 90 {
		t.Fatalf("got previous %v, since %v, target %d; want one previous, today, 90",
			h.Previous, h.Since, h.TargetValue)
	}

	prev = h.Current()
	h.TargetValue = 60
	if err := h.Reschedule(prev, friday, false); err != nil {
		t.Fatal(err)
	}
	if len(h.Previous) != 0 || h.Current() != original {
		t.Errorf("got previous %v, current %+v; want the original schedule alone",
			h.Previous, h.Current())
	}
}

// An unchanged schedule does not start a new version.
func TestRescheduleWithoutAChangeKeepsTheSchedule(t *testing.T) {
	h := countHabit()
	prev := h.Current()
	if err := h.Reschedule(prev, friday, false); err != nil {
		t.Fatal(err)
	}
	if len(h.Previous) != 0 || h.Since != prev.From {
		t.Errorf("got previous %v, since %v; want no new version", h.Previous, h.Since)
	}
}

// Days before a change of frequency are due by the old frequency.
func TestFrequencyChangeKeepsThePastDueDays(t *testing.T) {
	h := dailyHabit()
	prev := h.Current()
	// Mondays only, from this Monday on.
	h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 1}
	if err := h.Reschedule(prev, monday, false); err != nil {
		t.Fatal(err)
	}
	if !h.IsScheduled(monday.AddDays(-2)) {
		t.Error("last Saturday was due daily and must stay due")
	}
	if h.IsScheduled(monday.AddDays(1)) {
		t.Error("Tuesday is not due any more")
	}
	if !h.IsScheduled(monday.AddDays(7)) {
		t.Error("next Monday is due")
	}
}

// A times-per-week habit judges the weeks before its switch from daily by the
// daily schedule: a week is met when every day was completed.
func TestWeeklyHabitJudgesOlderWeeksByTheirSchedule(t *testing.T) {
	h := dailyHabit()
	prev := h.Current()
	h.Frequency = Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 2}
	if err := h.Reschedule(prev, monday, false); err != nil {
		t.Fatal(err)
	}

	entries := map[Date]int{}
	// Last week: every day, which meets the daily schedule.
	for i := 1; i <= 7; i++ {
		entries[monday.AddDays(-i)] = 1
	}
	// The week before: two days, which does not.
	entries[monday.AddDays(-14)] = 1
	entries[monday.AddDays(-13)] = 1
	// This week: two days, which meets the new target.
	entries[monday] = 1
	entries[monday.AddDays(1)] = 1

	st := ComputeStats(h, entries, friday, rateDays)
	if st.StreakUnit != "weeks" || st.CurrentStreak != 2 {
		t.Errorf("streak = %d %s, want 2 weeks", st.CurrentStreak, st.StreakUnit)
	}
}

// Validate rejects schedules that are not in order.
func TestValidateRejectsUnorderedSchedules(t *testing.T) {
	h := baseHabit()
	h.SetSchedules([]Schedule{
		{From: Date{2026, 9, 10}, TargetValue: 1, Frequency: Frequency{Kind: FreqDaily}},
		{From: Date{2026, 9, 10}, TargetValue: 1, Frequency: Frequency{Kind: FreqDaily}},
	})
	if err := h.Validate(); !errors.Is(err, ErrValidation) {
		t.Errorf("Validate = %v, want a validation error", err)
	}
}

// A custom interval without an anchor in a later schedule is anchored at the
// schedule's first day, not at the habit's creation.
func TestLaterScheduleAnchorsAtItsStart(t *testing.T) {
	h := baseHabit()
	start := h.Current().From.AddDays(10)
	h.SetSchedules([]Schedule{
		h.Current(),
		{From: start, Frequency: Frequency{Kind: FreqCustomInterval, IntervalDays: 3}},
	})
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.Frequency.AnchorDate != start {
		t.Errorf("anchor = %v, want %v", h.Frequency.AnchorDate, start)
	}
}

// DueDays marks the due days by the schedule of each day.
func TestDueDays(t *testing.T) {
	h := dailyHabit()
	prev := h.Current()
	// Mondays only, from this Monday on.
	h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 1}
	if err := h.Reschedule(prev, monday, false); err != nil {
		t.Fatal(err)
	}
	// Saturday and Sunday before, then Monday to Wednesday.
	if got := DueDays(h, monday.AddDays(-2), monday.AddDays(2)); got != "11100" {
		t.Errorf("DueDays = %q, want 11100", got)
	}
	if got := DueDays(h, monday, monday.AddDays(-1)); got != "" {
		t.Errorf("empty range: %q", got)
	}
}
