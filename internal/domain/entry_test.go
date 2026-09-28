package domain

import (
	"errors"
	"testing"
)

func ptr[T any](v T) *T { return &v }

// A value ends a skip, and a skip clears the value.
func TestEntryChangeApply(t *testing.T) {
	for _, tc := range []struct {
		name   string
		before Entry
		change EntryChange
		want   Entry
	}{
		{"value", Entry{}, EntryChange{Value: ptr(30)}, Entry{Value: 30}},
		{"value ends a skip", Entry{Skipped: true}, EntryChange{Value: ptr(10)}, Entry{Value: 10}},
		{"skip clears the value", Entry{Value: 30}, EntryChange{Skipped: ptr(true)}, Entry{Skipped: true}},
		{"unskip", Entry{Skipped: true}, EntryChange{Skipped: ptr(false)}, Entry{}},
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
		{EntryChange{Value: ptr(1)}, true},
		{EntryChange{Value: ptr(0)}, false},
		{EntryChange{Skipped: ptr(true)}, true},
		{EntryChange{Skipped: ptr(false)}, false},
		{EntryChange{Value: ptr(0), Skipped: ptr(false)}, false},
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
