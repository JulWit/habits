package domain

import "testing"

// Converting to check keeps the days that reached their target of the day.
func TestConvertToCheckKeepsCompletedDays(t *testing.T) {
	h := countHabit() // target 6
	if err := h.Reschedule(Schedule{TargetValue: 80, Frequency: h.Current().Frequency}, friday, false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	entries := map[Date]int{
		friday.AddDays(-2): 60, // reached the old target
		friday.AddDays(-1): 30, // did not
		friday:             70, // below the new target
	}

	schedules, got := ConvertKind(h, valued(entries), KindCheck, 1)
	if len(got) != 1 || got[friday.AddDays(-2)].Value != 1 {
		t.Errorf("entries = %v, want only the completed day, ticked", got)
	}
	for _, s := range schedules {
		if s.TargetValue != 1 {
			t.Errorf("schedule %+v, want target 1", s)
		}
	}
}

// Converting from check gives every ticked day the new target.
func TestConvertFromCheckUsesTheTarget(t *testing.T) {
	h := dailyHabit()
	entries := map[Date]int{friday: 1, friday.AddDays(-1): 1}
	schedules, got := ConvertKind(h, valued(entries), KindTime, 200)
	if got[friday].Value != 200 || got[friday.AddDays(-1)].Value != 200 {
		t.Errorf("entries = %v, want the target on both days", got)
	}
	if schedules[0].TargetValue != 200 {
		t.Errorf("target = %d, want 200", schedules[0].TargetValue)
	}
}

// Between measured kinds, values keep their displayed number and completion
// stays the same.
func TestConvertBetweenMeasuredKindsKeepsTheNumbers(t *testing.T) {
	h := countHabit() // 6 glasses, in tenths
	entries := map[Date]int{friday: 60, friday.AddDays(-1): 35}
	schedules, got := ConvertKind(h, valued(entries), KindDistance, 0)
	// 6 glasses become 6 km, 3.5 become 3.5 km.
	if got[friday].Value != 6000 || got[friday.AddDays(-1)].Value != 3500 {
		t.Errorf("entries = %v, want 6000 on friday and 3500 the day before", got)
	}
	if schedules[0].TargetValue != 6000 {
		t.Errorf("target = %d, want 6000", schedules[0].TargetValue)
	}

	// Values beyond the new kind's range are capped: 1000 glasses are more
	// than the 200 km a distance may have.
	_, capped := ConvertKind(h, valued(map[Date]int{friday: KindCount.MaxTarget()}), KindDistance, 0)
	if capped[friday].Value != KindDistance.MaxTarget() {
		t.Errorf("value = %d, want the distance maximum %d", capped[friday].Value, KindDistance.MaxTarget())
	}
}

// A change of kind keeps skipped days, and drops days whose value is dropped.
func TestConvertKeepsSkips(t *testing.T) {
	h := countHabit() // target 6
	entries := map[Date]Entry{
		friday:             {Value: 30}, // below the target
		friday.AddDays(-1): {Skipped: true},
	}
	_, got := ConvertKind(h, entries, KindCheck, 1)
	if _, kept := got[friday]; kept {
		t.Errorf("friday = %+v, want no entry", got[friday])
	}
	if want := (Entry{Skipped: true}); got[friday.AddDays(-1)] != want {
		t.Errorf("thursday = %+v, want %+v", got[friday.AddDays(-1)], want)
	}
}

// A limit becomes a plain target when the habit turns into a check habit.
func TestConvertToCheckDropsTheLimit(t *testing.T) {
	h := countHabit()
	h.Schedules[0].TargetType = TargetAtMost
	schedules, _ := ConvertKind(h, nil, KindCheck, 1)
	if schedules[0].TargetType != TargetAtLeast {
		t.Errorf("target type = %q, want at_least", schedules[0].TargetType)
	}
}
