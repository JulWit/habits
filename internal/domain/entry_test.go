package domain

import (
	"errors"
	"testing"
)

// A value ends a skip, and a skip clears the value.
func TestEntryChangeApply(t *testing.T) {
	for _, tc := range []struct {
		name   string
		before Entry
		change EntryChange
		want   Entry
	}{
		{"value", Entry{}, EntryChange{Value: new(30)}, Entry{Value: 30}},
		{"value ends a skip", Entry{Skipped: true}, EntryChange{Value: new(10)}, Entry{Value: 10}},
		{"skip clears the value", Entry{Value: 30}, EntryChange{Skipped: new(true)}, Entry{Skipped: true}},
		{"unskip", Entry{Skipped: true}, EntryChange{Skipped: new(false)}, Entry{}},
		{"nothing", Entry{Value: 30}, EntryChange{}, Entry{Value: 30}},
	} {
		if got := tc.change.Apply(tc.before); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// Only a change that records something needs a due day.
func TestEntryChangeRecords(t *testing.T) {
	for _, tc := range []struct {
		change EntryChange
		want   bool
	}{
		{EntryChange{Value: new(1)}, true},
		{EntryChange{Value: new(0)}, false},
		{EntryChange{Skipped: new(true)}, true},
		{EntryChange{Skipped: new(false)}, false},
		{EntryChange{Value: new(0), Skipped: new(false)}, false},
	} {
		if got := tc.change.Records(); got != tc.want {
			t.Errorf("%+v: Records = %v, want %v", tc.change, got, tc.want)
		}
	}
}

func TestEntryValidate(t *testing.T) {
	if err := (Entry{Value: 10}).Validate(KindCount); err != nil {
		t.Errorf("Validate = %v, want nil", err)
	}
	for name, bad := range map[string]Entry{
		"skipped with value": {Value: 10, Skipped: true},
		"negative":           {Value: -1},
	} {
		if err := bad.Validate(KindCount); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: Validate = %v, want a validation error", name, err)
		}
	}
}

// A change must change something, and cannot set a value and skip the day.
func TestEntryChangeValidate(t *testing.T) {
	for _, ok := range []EntryChange{
		{Value: new(30)},
		{Skipped: new(true)},
		{Value: new(30), Skipped: new(false)},
		{Value: new(0), Skipped: new(true)},
	} {
		if err := ok.Validate(); err != nil {
			t.Errorf("%+v: Validate = %v, want nil", ok, err)
		}
	}
	for name, bad := range map[string]EntryChange{
		"empty":          {},
		"value and skip": {Value: new(30), Skipped: new(true)},
		"step of zero":   {Add: new(0)},
		"step and value": {Add: new(10), Value: new(5)},
	} {
		if err := bad.Validate(); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: Validate = %v, want a validation error", name, err)
		}
	}
}

// A step adds to the stored value, ends a skip and stops at the maximum.
func TestEntryChangeResolve(t *testing.T) {
	for _, tc := range []struct {
		name  string
		entry Entry
		add   int
		want  Entry
	}{
		{"adds to the stored value", Entry{Value: 30}, 10, Entry{Value: 40}},
		{"ends a skip", Entry{Skipped: true}, 10, Entry{Value: 10}},
		{"stops at the maximum", Entry{Value: KindCount.MaxTarget() - 5}, 10, Entry{Value: KindCount.MaxTarget()}},
	} {
		change := EntryChange{Add: new(tc.add)}.Resolve(tc.entry, KindCount)
		if got := change.Apply(tc.entry); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// Skipping a range skips the due days without a value and leaves the others.
func TestDaysToSkip(t *testing.T) {
	// Due on Mondays, Wednesdays and Fridays.
	h := Habit{
		Kind: KindCheck, CreatedAt: longAgo,
		Schedules: since(longAgo, 1, Frequency{Kind: FreqWeekdays, Weekdays: 0b10101}),
	}
	entries := map[Date]Entry{
		monday:            {Value: 1},      // done: kept
		monday.AddDays(2): {Skipped: true}, // skipped already
	}
	got := DaysToSkip(h, entries, monday, sunday)
	if len(got) != 1 || got[0] != friday {
		t.Errorf("DaysToSkip = %v, want only friday", got)
	}
}
