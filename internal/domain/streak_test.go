package domain

import (
	"testing"
	"time"
)

// want compares a run list against dates given as offsets from friday, which is
// how every case below is easiest to read: {-10, -6} is "ten days ago until six
// days ago".
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

	// Today is empty but still open, so the second run stands and reaches to it.
	// Nothing is painted there — an empty day is never coloured — but a tick
	// arriving later joins the run without the board having to be told twice.
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

// The reason runs are dates and not counts: a run is as long as the stretch of
// calendar it covers, so a habit due three times a week reaches "a week" after
// a week rather than after seven of its own days.
func TestWeekdayRunIsMeasuredInCalendarDays(t *testing.T) {
	h := Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 0b0010101}, // Mon, Wed, Fri
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
	// Nine ticked days, but three weeks of keeping it up.
	if days := runs[0].To.DaysSince(runs[0].From) + 1; days != 19 {
		t.Errorf("run length = %d days, want 19", days)
	}
	if st := ComputeStats(h, entries, friday, rateDays); st.CurrentStreak != 9 {
		t.Errorf("currentStreak = %d, want 9 — the counter still counts due days", st.CurrentStreak)
	}
}

// Doing more than the rhythm asks for must not fall outside the run: the
// Saturday tick of a Mon–Fri habit is part of the streak it extends.
func TestRunCoversAnExtraDayTheHabitIsNotDueOn(t *testing.T) {
	saturday := friday.AddDays(1)
	h := Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}, // Mon–Fri
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

// A day off in a rhythm that never asked for it leaves the run whole.
func TestWeekdayRunIgnoresDaysItIsNotDueOn(t *testing.T) {
	h := Habit{
		Kind: KindCheck, TargetValue: 1, CreatedAt: longAgo,
		Frequency: Frequency{Kind: FreqWeekdays, Weekdays: 0b0011111}, // Mon–Fri
	}
	entries := map[Date]int{}
	for d := monday.AddDays(-7); !d.After(friday); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			entries[d] = 1
		}
	}

	// Starts on the Monday a fortnight back and runs across the weekend in
	// between without breaking.
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
	// The run starts on a Monday even though the entries do not: a week is met
	// as a whole, so it counts from its first day.
	if runs[0].From.Weekday() != time.Monday {
		t.Errorf("run starts on %s, want a Monday", runs[0].From.Weekday())
	}
	if days := runs[0].To.DaysSince(runs[0].From) + 1; days < 28 {
		t.Errorf("run length = %d days, want at least 28", days)
	}
}

// An unfinished current week does not end the run — the same rule the streak
// counter follows — so the days already ticked off in it stay coloured.
func TestWeeklyRunSurvivesAnOpenCurrentWeek(t *testing.T) {
	h := weeklyHabit(3)
	entries := fillWeekly(friday.AddDays(-27), friday, 3)
	for i := 0; i < 7; i++ {
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
	for i := 0; i < 7; i++ {
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

// A run may not claim days from before the habit existed: the week it was
// created in starts at the habit, not at its Monday.
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
