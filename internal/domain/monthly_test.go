package domain

import (
	"errors"
	"testing"
	"time"
)

func monthlyHabit(times int, created time.Time) Habit {
	return Habit{
		Name: "Call home", Color: "sky", Kind: KindCheck, CreatedAt: created,
		Schedules: since(created, 1, Frequency{Kind: FreqTimesPerMonth, TimesPerMonth: times}),
	}
}

// A times-per-month habit counts its streak in months. The current month does
// not break it while it can still be met.
func TestMonthlyStreakCountsMonths(t *testing.T) {
	h := monthlyHabit(2, time.Date(2026, time.June, 1, 0, 0, 0, 0, time.UTC))
	entries := valued(map[Date]int{
		{2026, time.June, 3}: 1, {2026, time.June, 20}: 1, // met
		{2026, time.July, 9}:   1,                             // missed: one of two
		{2026, time.August, 1}: 1, {2026, time.August, 31}: 1, // met
		{2026, time.September, 2}: 1, // current month, open
	})
	st := ComputeStats(h, entries, friday, rateDays)
	if st.StreakUnit != "months" || st.CurrentStreak != 1 || st.BestStreak != 1 {
		t.Errorf("stats = %+v, want a current and best streak of 1 month", st)
	}
	runs := StreakRuns(h, entries, friday)
	want := []StreakRun{
		{From: Date{2026, time.June, 1}, To: Date{2026, time.June, 30}},
		{From: Date{2026, time.August, 1}, To: friday},
	}
	if len(runs) != len(want) || runs[0] != want[0] || runs[1] != want[1] {
		t.Errorf("runs = %v, want %v", runs, want)
	}
}

// Every day is due, and a month has its own number of days.
func TestMonthPeriod(t *testing.T) {
	h := monthlyHabit(3, longAgo)
	if !h.IsScheduled(friday) {
		t.Error("a times-per-month habit is due every day")
	}
	for start, want := range map[Date]Date{
		{2026, time.January, 1}:  {2026, time.February, 1},
		{2026, time.December, 1}: {2027, time.January, 1},
	} {
		if got := monthPeriod.next(start); got != want {
			t.Errorf("next(%v) = %v, want %v", start, got, want)
		}
	}
	if got := monthPeriod.startOf(friday); got != (Date{2026, time.September, 1}) {
		t.Errorf("startOf = %v", got)
	}
}

// The schedule rules of the new target type and frequency.
func TestScheduleRulesForLimitsAndMonths(t *testing.T) {
	daily := Frequency{Kind: FreqDaily}
	for name, tc := range map[string]struct {
		kind Kind
		s    Schedule
		code string
	}{
		"limit per week":     {KindCount, Schedule{TargetValue: 20, TargetType: TargetAtMost, Frequency: Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 3}}, "limit_needs_fixed_days"},
		"limit per month":    {KindCount, Schedule{TargetValue: 20, TargetType: TargetAtMost, Frequency: Frequency{Kind: FreqTimesPerMonth, TimesPerMonth: 3}}, "limit_needs_fixed_days"},
		"negative limit":     {KindCount, Schedule{TargetValue: -1, TargetType: TargetAtMost, Frequency: daily}, "limit_negative"},
		"zero target":        {KindCount, Schedule{TargetValue: 0, Frequency: daily}, "target_too_small"},
		"unknown type":       {KindCount, Schedule{TargetValue: 10, TargetType: "about", Frequency: daily}, "unknown_target_type"},
		"too often a month":  {KindCheck, Schedule{Frequency: Frequency{Kind: FreqTimesPerMonth, TimesPerMonth: 29}}, "times_per_month_range"},
		"never in the month": {KindCheck, Schedule{Frequency: Frequency{Kind: FreqTimesPerMonth}}, "times_per_month_range"},
	} {
		tc.s.From = friday
		_, err := tc.s.normalized(tc.kind)
		var p *Problem
		if !errors.As(err, &p) || p.Code != tc.code {
			t.Errorf("%s: %v, want %s", name, err, tc.code)
		}
	}

	// A check habit has no limit, and a missing type is a plain target.
	s, err := Schedule{From: friday, TargetValue: 5, TargetType: TargetAtMost, Frequency: daily}.normalized(KindCheck)
	if err != nil || s.TargetType != TargetAtLeast || s.TargetValue != 1 {
		t.Errorf("check: %+v, %v; want a plain target of 1", s, err)
	}
	s, err = Schedule{From: friday, TargetValue: 5, Frequency: daily}.normalized(KindCount)
	if err != nil || s.TargetType != TargetAtLeast {
		t.Errorf("no type: %+v, %v; want at_least", s, err)
	}
}

// Turning a target into a limit starts a new version of the schedule, so
// past days keep being judged by their target.
func TestRescheduleToALimitStartsANewVersion(t *testing.T) {
	h := countHabit()
	limit := h.Current()
	limit.TargetType = TargetAtMost
	if err := h.Reschedule(limit, friday, false); err != nil {
		t.Fatal(err)
	}
	if len(h.Schedules) != 2 || !h.Current().isLimit() || h.Schedules[0].isLimit() {
		t.Errorf("schedules = %+v, want the old target and a limit from friday on", h.Schedules)
	}
	if h.IsComplete(friday.AddDays(-1), 0) || !h.IsComplete(friday, 0) {
		t.Error("an empty day before friday should miss the target and one on friday meet the limit")
	}
}
