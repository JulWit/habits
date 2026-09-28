package domain

import (
	"errors"
	"testing"
)

// countHabit returns a count habit with a target of six, created long ago.
func countHabit() Habit {
	return Habit{
		Name: "Water", Color: "sky", Kind: KindCount, CreatedAt: longAgo,
		Schedules: since(longAgo, 60, Frequency{Kind: FreqDaily}),
	}
}

// retarget changes the target of h from day on.
func retarget(t *testing.T, h *Habit, target int, day Date, retroactive bool) {
	t.Helper()
	if err := h.Reschedule(Schedule{TargetValue: target, Frequency: h.Current().Frequency}, day, retroactive); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
}

// Raising the target does not rewrite the days before the change.
func TestRaisingTheTargetKeepsThePast(t *testing.T) {
	h := countHabit()
	entries := map[Date]int{}
	for i := 1; i <= 10; i++ {
		entries[friday.AddDays(-i)] = 60
	}

	retarget(t, &h, 80, friday, false)

	if got := h.Target(friday.AddDays(-1)); got != 60 {
		t.Errorf("target yesterday = %d, want 60", got)
	}
	if got := h.Target(friday); got != 80 {
		t.Errorf("target today = %d, want 80", got)
	}
	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.CurrentStreak != 10 {
		t.Errorf("current streak = %d, want 10", st.CurrentStreak)
	}
}

// A retroactive change applies the new schedule to every day.
func TestRetroactiveRescheduleReplacesTheHistory(t *testing.T) {
	h := countHabit()
	retarget(t, &h, 80, friday.AddDays(-5), false)
	retarget(t, &h, 100, friday, true)

	if len(h.Schedules) != 1 {
		t.Fatalf("schedules = %v, want one", h.Schedules)
	}
	if got := h.Target(friday.AddDays(-100)); got != 100 {
		t.Errorf("target long ago = %d, want 100", got)
	}
	if h.Current().From != DateFromTime(longAgo) {
		t.Errorf("from = %v, want the first schedule's day", h.Current().From)
	}
}

// Two changes on the same day leave one schedule for that day, and changing
// back to the old schedule merges both.
func TestReschedulingTwiceOnADayKeepsOneVersion(t *testing.T) {
	h := countHabit()
	original := h.Current()

	retarget(t, &h, 80, friday, false)
	retarget(t, &h, 90, friday, false)
	if len(h.Schedules) != 2 || h.Current().From != friday || h.Current().TargetValue != 90 {
		t.Fatalf("schedules = %v; want the original and one from today with 90", h.Schedules)
	}

	retarget(t, &h, 60, friday, false)
	if len(h.Schedules) != 1 || h.Current() != original {
		t.Errorf("schedules = %v; want the original schedule alone", h.Schedules)
	}
}

// An unchanged schedule does not start a new version.
func TestRescheduleWithoutAChangeKeepsTheSchedule(t *testing.T) {
	h := countHabit()
	before := h.Current()
	retarget(t, &h, before.TargetValue, friday, false)
	if len(h.Schedules) != 1 || h.Current() != before {
		t.Errorf("schedules = %v; want no new version", h.Schedules)
	}
}

// Reschedule does not change the history of other copies of the habit.
func TestRescheduleLeavesCopiesAlone(t *testing.T) {
	h := countHabit()
	retarget(t, &h, 80, friday.AddDays(-1), false)
	copied := h
	retarget(t, &h, 90, friday.AddDays(-1), false)
	if copied.Current().TargetValue != 80 {
		t.Errorf("the copy's target changed to %d", copied.Current().TargetValue)
	}
}

// Days before a change of frequency are due by the old frequency.
func TestFrequencyChangeKeepsThePastDueDays(t *testing.T) {
	h := dailyHabit()
	// Mondays only, from this Monday on.
	if err := h.Reschedule(Schedule{TargetValue: 1, Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 1}}, monday, false); err != nil {
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
	if err := h.Reschedule(Schedule{TargetValue: 1, Frequency: Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 2}}, monday, false); err != nil {
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

	st := ComputeStats(h, valued(entries), friday, rateDays)
	if st.StreakUnit != "weeks" || st.CurrentStreak != 2 {
		t.Errorf("streak = %d %s, want 2 weeks", st.CurrentStreak, st.StreakUnit)
	}
}

// Validate rejects schedules that are not in order, and a habit without any.
func TestValidateRejectsUnorderedSchedules(t *testing.T) {
	h := baseHabit()
	h.Schedules = []Schedule{
		{From: Date{2026, 9, 10}, TargetValue: 1, Frequency: Frequency{Kind: FreqDaily}},
		{From: Date{2026, 9, 10}, TargetValue: 1, Frequency: Frequency{Kind: FreqDaily}},
	}
	if err := h.Validate(); !errors.Is(err, ErrValidation) {
		t.Errorf("Validate = %v, want a validation error", err)
	}

	h.Schedules = nil
	if err := h.Validate(); !errors.Is(err, ErrValidation) {
		t.Errorf("no schedule: Validate = %v, want a validation error", err)
	}
}

// A custom interval without an anchor in a later schedule is anchored at the
// schedule's first day, not at the habit's first schedule.
func TestLaterScheduleAnchorsAtItsStart(t *testing.T) {
	h := baseHabit()
	start := h.Current().From.AddDays(10)
	h.Schedules = append(h.Schedules,
		Schedule{From: start, Frequency: Frequency{Kind: FreqCustomInterval, IntervalDays: 3}})
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.Current().Frequency.AnchorDate != start {
		t.Errorf("anchor = %v, want %v", h.Current().Frequency.AnchorDate, start)
	}
}

// DayStatuses judge each day by the schedule of that day.
func TestDayStatusesFollowTheSchedules(t *testing.T) {
	h := dailyHabit()
	// Mondays only, from this Monday on.
	if err := h.Reschedule(Schedule{TargetValue: 1, Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 1}}, monday, false); err != nil {
		t.Fatal(err)
	}
	// Saturday and Sunday before, then Monday to Wednesday.
	if got := DayStatuses(h, nil, HistoryStart(h, nil), monday.AddDays(-2), monday.AddDays(2), monday); got != "ooo--" {
		t.Errorf("DayStatuses = %q, want ooo--", got)
	}
	if got := DayStatuses(h, nil, HistoryStart(h, nil), monday, monday.AddDays(-1), monday); got != "" {
		t.Errorf("empty range: %q", got)
	}
}
