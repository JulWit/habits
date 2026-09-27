package domain

import (
	"testing"
	"time"
)

// wantRuns compares got with runs given as day offsets from friday, e.g.
// {-10, -6} for ten to six days ago.
func wantRuns(t *testing.T, got []StreakRun, want [][2]int) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d runs %v, want %d %v", len(got), got, len(want), want)
	}
	for i, w := range want {
		expect := StreakRun{From: friday.AddDays(w[0]), To: friday.AddDays(w[1])}
		if got[i] != expect {
			t.Errorf("run %d = %s…%s, want %s…%s",
				i, got[i].From, got[i].To, expect.From, expect.To)
		}
	}
}

func TestDailyRunsSplitAtAGap(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for _, back := range []int{10, 9, 8, 7, 6, 4, 3, 2, 1} {
		entries[friday.AddDays(-back)] = 1
	}

	// Today is still open, so the second run extends to it.
	wantRuns(t, StreakRuns(h, entries, friday), [][2]int{{-10, -6}, {-4, 0}})
}

func TestDailyRunReachesToday(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{}
	for back := 3; back >= 0; back-- {
		entries[friday.AddDays(-back)] = 1
	}

	wantRuns(t, StreakRuns(h, entries, friday), [][2]int{{-3, 0}})
}

// Runs of weekday habits are measured in calendar days.
func TestWeekdayRunIsMeasuredInCalendarDays(t *testing.T) {
	h := Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqWeekdays, Weekdays: 0b0010101}), // Mon, Wed, Fri
	}
	entries := map[Date]int{}
	for d := friday.AddDays(-20); !d.After(friday); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			entries[d] = 1
		}
	}

	runs := StreakRuns(h, entries, friday)
	if len(runs) != 1 {
		t.Fatalf("got %d runs %v, want 1", len(runs), runs)
	}
	// Nine completed days span 19 calendar days.
	if days := runs[0].To.DaysSince(runs[0].From) + 1; days != 19 {
		t.Errorf("run length = %d days, want 19", days)
	}
	if st := ComputeStats(h, entries, friday, rateDays); st.CurrentStreak != 9 {
		t.Errorf("currentStreak = %d, want 9 — the counter still counts due days", st.CurrentStreak)
	}
}

// A completion on an unscheduled day is part of the run.
func TestRunCoversAnExtraDayTheHabitIsNotDueOn(t *testing.T) {
	saturday := friday.AddDays(1)
	h := Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}), // Mon–Fri
	}
	entries := map[Date]int{}
	for d := friday.AddDays(-4); !d.After(saturday); d = d.AddDays(1) {
		entries[d] = 1
	}

	runs := StreakRuns(h, entries, saturday)
	if len(runs) != 1 {
		t.Fatalf("got %d runs %v, want 1", len(runs), runs)
	}
	if runs[0].To != saturday {
		t.Errorf("run ends %s, want the extra day %s", runs[0].To, saturday)
	}
}

// Unscheduled days do not break a run.
func TestWeekdayRunIgnoresDaysItIsNotDueOn(t *testing.T) {
	h := Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}), // Mon–Fri
	}
	entries := map[Date]int{}
	for d := monday.AddDays(-7); !d.After(friday); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			entries[d] = 1
		}
	}

	// From Monday two weeks ago until today, including the weekend.
	wantRuns(t, StreakRuns(h, entries, friday), [][2]int{{-11, 0}})
}

func TestWeeklyRunsCoverWholeWeeks(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-27), friday, 3)

	runs := StreakRuns(h, entries, friday)
	if len(runs) != 1 {
		t.Fatalf("got %d runs %v, want 1", len(runs), runs)
	}
	if runs[0].To != friday {
		t.Errorf("run ends %s, want today (%s)", runs[0].To, friday)
	}
	// A weekly run starts on the Monday of its first week.
	if runs[0].From.Weekday() != time.Monday {
		t.Errorf("run starts on %s, want a Monday", runs[0].From.Weekday())
	}
	if days := runs[0].To.DaysSince(runs[0].From) + 1; days < 28 {
		t.Errorf("run length = %d days, want at least 28", days)
	}
}

// An incomplete current week does not end a weekly run.
func TestWeeklyRunSurvivesAnOpenCurrentWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-27), friday, 3)
	for i := range 7 {
		delete(entries, friday.StartOfWeek().AddDays(i))
	}

	runs := StreakRuns(h, entries, friday)
	if len(runs) != 1 {
		t.Fatalf("got %d runs %v, want 1", len(runs), runs)
	}
	if runs[0].To != friday {
		t.Errorf("run ends %s, want today (%s) — the week is open, not failed", runs[0].To, friday)
	}
}

func TestWeeklyRunEndsAtAMissedWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-27), friday, 3)
	lastWeek := friday.StartOfWeek().AddDays(-7)
	for i := range 7 {
		delete(entries, lastWeek.AddDays(i))
	}

	runs := StreakRuns(h, entries, friday)
	if len(runs) != 2 {
		t.Fatalf("got %d runs %v, want 2", len(runs), runs)
	}
	if runs[0].To != lastWeek.AddDays(-1) {
		t.Errorf("first run ends %s, want %s", runs[0].To, lastWeek.AddDays(-1))
	}
	if runs[1].From != friday.StartOfWeek() {
		t.Errorf("second run starts %s, want %s", runs[1].From, friday.StartOfWeek())
	}
}

// A weekly run does not start before the habit's history.
func TestWeeklyRunStartsNoEarlierThanTheHabit(t *testing.T) {
	created := friday.AddDays(-10) // a Tuesday
	h := weeklyHabit(2)
	h.CreatedAt = created.Time()
	entries := map[Date]int{}
	for _, back := range []int{10, 9, 3, 2} {
		entries[friday.AddDays(-back)] = 1
	}

	runs := StreakRuns(h, entries, friday)
	if len(runs) != 1 {
		t.Fatalf("got %d runs %v, want 1", len(runs), runs)
	}
	if runs[0].From != created {
		t.Errorf("run starts %s, want the habit's first day %s", runs[0].From, created)
	}
}

func TestRunsIgnoreThePlannedFuture(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{
		friday:             1,
		friday.AddDays(-1): 1,
		friday.AddDays(1):  1,
		friday.AddDays(2):  1,
	}

	wantRuns(t, StreakRuns(h, entries, friday), [][2]int{{-1, 0}})
}

func TestNoRunsWithoutHistory(t *testing.T) {
	if runs := StreakRuns(dailyHabit(), map[Date]int{}, friday); len(runs) != 0 {
		t.Errorf("got %v, want no runs", runs)
	}
	if runs := StreakRuns(weeklyHabit(3), map[Date]int{}, friday); len(runs) != 0 {
		t.Errorf("got %v, want no runs", runs)
	}
}
