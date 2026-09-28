package domain

import (
	"errors"
	"strings"
	"testing"
)

func ptr[T any](v T) *T { return &v }

// A value ends a skip, a skip clears the value, and a note is kept by both.
func TestEntryChangeApply(t *testing.T) {
	for _, tc := range []struct {
		name   string
		before Entry
		change EntryChange
		want   Entry
	}{
		{"value", Entry{Note: "n"}, EntryChange{Value: ptr(30)}, Entry{Value: 30, Note: "n"}},
		{"value ends a skip", Entry{Skipped: true}, EntryChange{Value: ptr(10)}, Entry{Value: 10}},
		{"skip clears the value", Entry{Value: 30, Note: "n"}, EntryChange{Skipped: ptr(true)}, Entry{Skipped: true, Note: "n"}},
		{"unskip", Entry{Skipped: true}, EntryChange{Skipped: ptr(false)}, Entry{}},
		{"note only", Entry{Value: 30}, EntryChange{Note: ptr("late")}, Entry{Value: 30, Note: "late"}},
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
		{EntryChange{Note: ptr(" x ")}, true},
		{EntryChange{Note: ptr("  ")}, false},
		{EntryChange{Value: ptr(0), Skipped: ptr(false), Note: ptr("")}, false},
	} {
		if got := tc.change.Records(); got != tc.want {
			t.Errorf("%+v: Records = %v, want %v", tc.change, got, tc.want)
		}
	}
}

func TestEntryValidate(t *testing.T) {
	e := Entry{Value: 10, Note: "  late  "}
	if err := e.Validate(KindCount); err != nil || e.Note != "late" {
		t.Errorf("Validate = %v, note %q; want nil and the trimmed note", err, e.Note)
	}
	for name, bad := range map[string]Entry{
		"skipped with value": {Value: 10, Skipped: true},
		"long note":          {Note: strings.Repeat("ä", MaxNoteLen+1)},
		"negative":           {Value: -1},
	} {
		if err := bad.Validate(KindCount); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: Validate = %v, want a validation error", name, err)
		}
	}
	// The limit counts characters, not bytes.
	long := Entry{Note: strings.Repeat("ä", MaxNoteLen)}
	if err := long.Validate(KindCheck); err != nil {
		t.Errorf("note of %d characters: %v", MaxNoteLen, err)
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
		monday:            {Value: 1},                     // done: kept
		monday.AddDays(2): {Skipped: true},                // skipped already
		friday:            {Note: "a note, but no value"}, // skipped
	}
	got := DaysToSkip(h, entries, monday, sunday)
	if len(got) != 1 || got[0] != friday {
		t.Errorf("DaysToSkip = %v, want only friday", got)
	}
}
