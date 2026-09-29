package domain

import (
	"testing"
	"time"
)

// limitHabit returns a count habit that may be done at most limit times a
// day, created on friday.
func limitHabit(limit int) Habit {
	created := friday.Time()
	return Habit{
		Kind: KindCount, CreatedAt: created,
		Schedules: []Schedule{{
			From: friday, TargetValue: limit, TargetType: TargetAtMost,
			Frequency: Frequency{Kind: FreqDaily},
		}},
	}
}

func TestStatusOfATarget(t *testing.T) {
	h := Habit{
		Kind: KindCount, CreatedAt: longAgo,
		Schedules: since(longAgo, 30, Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}),
	}
	start := DateFromTime(longAgo)
	saturday := friday.AddDays(1)
	for _, tc := range []struct {
		name string
		day  Date
		e    Entry
		want DayStatus
	}{
		{"nothing recorded", friday, Entry{}, StatusOpen},
		{"below the target", friday, Entry{Value: 10}, StatusOpen},
		{"target reached", friday, Entry{Value: 30}, StatusDone},
		{"planned ahead", friday.AddDays(3), Entry{Value: 30}, StatusDone},
		{"skipped", friday, Entry{Skipped: true}, StatusSkipped},
		{"not due", saturday, Entry{}, StatusOff},
		{"not due, but reached", saturday, Entry{Value: 40}, StatusOffDone},
		{"not due, below the target", saturday, Entry{Value: 10}, StatusOff},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := h.Status(tc.day, tc.e, start, friday); got != tc.want {
				t.Errorf("Status = %c, want %c", got, tc.want)
			}
		})
	}
}

func TestStatusOfALimit(t *testing.T) {
	h := limitHabit(20)
	for _, tc := range []struct {
		name string
		day  Date
		e    Entry
		want DayStatus
	}{
		{"today without a value", friday, Entry{}, StatusDone},
		{"within the limit", friday, Entry{Value: 20}, StatusDone},
		{"over the limit", friday, Entry{Value: 30}, StatusOver},
		{"before the history", friday.AddDays(-1), Entry{}, StatusOpen},
		{"ahead without a value", friday.AddDays(1), Entry{}, StatusOpen},
		{"ahead over the limit", friday.AddDays(1), Entry{Value: 30}, StatusOpen},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := h.Status(tc.day, tc.e, friday, friday); got != tc.want {
				t.Errorf("Status = %c, want %c", got, tc.want)
			}
		})
	}
}

func TestDayStatusesCoverTheRange(t *testing.T) {
	h := dailyHabit()
	entries := valued(map[Date]int{friday.AddDays(-1): 1})
	got := DayStatuses(h, entries, HistoryStart(h, entries), friday.AddDays(-2), friday.AddDays(1), friday)
	if want := "ocoo"; got != want {
		t.Errorf("DayStatuses = %q, want %q", got, want)
	}
}

func TestLastDone(t *testing.T) {
	h := dailyHabit()
	if got := LastDone(h, nil, friday); !got.IsZero() {
		t.Errorf("LastDone without entries = %v, want none", got)
	}
	entries := valued(map[Date]int{monday: 1, friday.AddDays(2): 1})
	if got := LastDone(h, entries, friday); got != monday {
		t.Errorf("LastDone = %v, want %v, as days ahead do not count", got, monday)
	}
	// A limit is kept by today without a value.
	if got := LastDone(limitHabit(0), nil, friday); got != friday {
		t.Errorf("LastDone of a limit = %v, want %v", got, friday)
	}
}

func TestDayTotalsCountFromTheHistoryStart(t *testing.T) {
	older := dailyHabit()
	older.ID = "older"
	newer := dailyHabit()
	newer.ID = "newer"
	newer.CreatedAt = friday.Time()
	entries := map[string]map[Date]Entry{
		"older": valued(map[Date]int{friday.AddDays(-1): 1, friday: 1}),
		"newer": {friday: {Skipped: true}},
	}
	got := DayTotals([]Habit{older, newer}, entries, friday.AddDays(-1), friday.AddDays(1), friday)
	want := []DayTotal{
		{Date: friday.AddDays(-1), Due: 1, Done: 1},
		{Date: friday, Due: 1, Done: 1},
		{Date: friday.AddDays(1), Due: 2, Done: 0},
	}
	if len(got) != len(want) {
		t.Fatalf("DayTotals = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("day %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestPerfectStreaksKeepAnOpenToday(t *testing.T) {
	totals := []DayTotal{
		{Date: friday.AddDays(-4), Due: 2, Done: 2},
		{Date: friday.AddDays(-3), Due: 2, Done: 1},
		{Date: friday.AddDays(-2), Due: 1, Done: 1},
		{Date: friday.AddDays(-1), Due: 0},
		{Date: friday, Due: 2, Done: 0},
	}
	current, best := PerfectStreaks(totals, friday)
	if current != 1 || best != 1 {
		t.Errorf("PerfectStreaks = %d, %d, want 1, 1", current, best)
	}
}

func TestComputeDayStats(t *testing.T) {
	// Monday to Friday: three perfect days, one half done, Friday (today)
	// open.
	totals := []DayTotal{
		{Date: monday, Due: 2, Done: 2},
		{Date: monday.AddDays(1), Due: 2, Done: 1},
		{Date: monday.AddDays(2), Due: 2, Done: 2},
		{Date: monday.AddDays(3), Due: 2, Done: 2},
		{Date: friday, Due: 2, Done: 0},
	}
	st := ComputeDayStats(totals, friday)
	if st.Perfect != 3 || st.Counted != 5 || st.Completed != 7 || st.EmptyDays != 0 {
		t.Errorf("counts = %+v, want 3 perfect of 5 counted days, 7 completed, none empty", st)
	}
	if st.CurrentStreak != 2 || st.BestStreak != 2 {
		t.Errorf("streaks = %d, %d, want 2, 2", st.CurrentStreak, st.BestStreak)
	}
	// Today is left out of the average.
	if st.Average == nil || *st.Average != 0.875 {
		t.Errorf("Average = %v, want 0.875", st.Average)
	}
	if st.BestWeekday != 0 || st.Weekdays[4].Rate == nil || *st.Weekdays[4].Rate != 0 {
		t.Errorf("BestWeekday, Weekdays = %d, %+v; want Monday best and Friday at 0", st.BestWeekday, st.Weekdays)
	}
	if st.FirstMonth != time.September || len(st.Months) != 1 || st.BestMonth != time.September {
		t.Errorf("FirstMonth, Months, BestMonth = %v, %+v, %v; want September, one month, September", st.FirstMonth, st.Months, st.BestMonth)
	}
}

func TestSumValuesPerWeek(t *testing.T) {
	entries := valued(map[Date]int{monday: 10, friday: 30, sunday.AddDays(1): 5})
	got := SumValues(entries, monday.AddDays(-7), sunday.AddDays(1), GrainWeek)
	if got.Total != 45 || got.Best != 30 || got.ActiveDays != 3 {
		t.Errorf("totals = %+v, want a total of 45, best 30 and 3 active days", got)
	}
	want := []Bucket{
		{Start: monday.AddDays(-7), Sum: 0, Cumulative: 0},
		{Start: monday, Sum: 40, Cumulative: 40},
		{Start: monday.AddDays(7), Sum: 5, Cumulative: 45},
	}
	if len(got.Buckets) != len(want) {
		t.Fatalf("buckets = %+v, want %+v", got.Buckets, want)
	}
	for i := range want {
		if got.Buckets[i] != want[i] {
			t.Errorf("bucket %d = %+v, want %+v", i, got.Buckets[i], want[i])
		}
	}
}

func TestSumValuesPerMonthStartsOnTheFirstDay(t *testing.T) {
	from := Date{2026, time.January, 1}
	got := SumValues(nil, from, Date{2026, time.March, 10}, GrainMonth)
	if len(got.Buckets) != 3 || got.Buckets[2].Start != (Date{2026, time.March, 1}) {
		t.Errorf("buckets = %+v, want 3 months, the last from 1 March", got.Buckets)
	}
}
