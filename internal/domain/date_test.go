package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseDateRoundTrip(t *testing.T) {
	for _, s := range []string{"2026-01-01", "2026-09-18", "2024-02-29", "1999-12-31"} {
		d, err := ParseDate(s)
		if err != nil {
			t.Errorf("ParseDate(%q): %v", s, err)
			continue
		}
		if d.String() != s {
			t.Errorf("round trip: %q -> %q", s, d.String())
		}
	}
}

func TestParseDateRejects(t *testing.T) {
	for _, s := range []string{"", "2026-13-01", "2026-02-30", "18.09.2026", "2026-9-8", "heute"} {
		if _, err := ParseDate(s); err == nil {
			t.Errorf("ParseDate(%q) was accepted", s)
		}
	}
}

// The reason Date exists at all: day arithmetic must not shift when the wall
// clock does. Germany's 2026 transitions are 29 March and 25 October.
func TestDayArithmeticIgnoresDaylightSaving(t *testing.T) {
	for _, around := range []Date{
		{2026, time.March, 28},
		{2026, time.October, 24},
	} {
		next := around.AddDays(1)
		if next.DaysSince(around) != 1 {
			t.Errorf("%v -> %v is not one day", around, next)
		}
		if back := next.AddDays(-1); back != around {
			t.Errorf("round trip across the changeover: %v != %v", back, around)
		}
	}
}

func TestDaysSince(t *testing.T) {
	a := Date{2026, time.September, 14}
	if got := a.AddDays(30).DaysSince(a); got != 30 {
		t.Errorf("DaysSince = %d, want 30", got)
	}
	if got := a.DaysSince(a.AddDays(30)); got != -30 {
		t.Errorf("backwards: DaysSince = %d, want -30", got)
	}
	if got := a.DaysSince(a); got != 0 {
		t.Errorf("same day: DaysSince = %d, want 0", got)
	}
	// Across a year boundary and a leap day.
	if got := (Date{2024, time.March, 1}).DaysSince(Date{2024, time.February, 28}); got != 2 {
		t.Errorf("across the leap day: %d, want 2", got)
	}
}

// Weeks start on Monday throughout, including in the times-per-week frequency.
func TestStartOfWeek(t *testing.T) {
	monday := Date{2026, time.September, 14}
	for offset := 0; offset < 7; offset++ {
		d := monday.AddDays(offset)
		if got := d.StartOfWeek(); got != monday {
			t.Errorf("%v (%v): StartOfWeek = %v, want %v", d, d.Weekday(), got, monday)
		}
	}
	if monday.Weekday() != time.Monday {
		t.Fatalf("fixture is not a Monday but %v", monday.Weekday())
	}
}

func TestWeekdayBitmaskIsMondayFirst(t *testing.T) {
	monday := Date{2026, time.September, 14}
	var all Weekdays = 0b1111111
	for offset := 0; offset < 7; offset++ {
		if !all.Has(monday.AddDays(offset).Weekday()) {
			t.Errorf("the full mask does not cover %v", monday.AddDays(offset).Weekday())
		}
	}
	// Bit 0 is Monday, bit 6 is Sunday.
	var mondayOnly Weekdays = 1 << 0
	if !mondayOnly.Has(time.Monday) || mondayOnly.Has(time.Sunday) {
		t.Error("bit 0 must be Monday")
	}
	var sundayOnly Weekdays = 1 << 6
	if !sundayOnly.Has(time.Sunday) || sundayOnly.Has(time.Monday) {
		t.Error("bit 6 must be Sunday")
	}
	if all.Count() != 7 {
		t.Errorf("Count = %d, want 7", all.Count())
	}
}

// The wire format: a Date is a bare ISO string, and the zero Date is "".
func TestDateJSON(t *testing.T) {
	type wrapper struct {
		D Date `json:"d"`
	}
	raw, err := json.Marshal(wrapper{Date{2026, time.September, 18}})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(raw) != `{"d":"2026-09-18"}` {
		t.Errorf("Marshal = %s", raw)
	}

	var back wrapper
	if err := json.Unmarshal([]byte(`{"d":"2026-09-18"}`), &back); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if back.D != (Date{2026, time.September, 18}) {
		t.Errorf("Unmarshal = %v", back.D)
	}

	// An empty string is the zero date, not an error: that is how the client
	// says "no anchor".
	if err := json.Unmarshal([]byte(`{"d":""}`), &back); err != nil {
		t.Fatalf(`Unmarshal(""): %v`, err)
	}
	if !back.D.IsZero() {
		t.Errorf(`"" gave %v, want zero`, back.D)
	}

	if err := json.Unmarshal([]byte(`{"d":"not-a-date"}`), &back); err == nil {
		t.Error("a broken date was accepted")
	}
}

func TestTodayUsesTheGivenLocation(t *testing.T) {
	// Compared against the clock read on either side of the call, so a midnight
	// passing in between cannot fail the test: the answer must be the date in
	// the given zone at one of the two instants.
	for _, loc := range []*time.Location{
		time.FixedZone("UTC+14", 14*60*60),
		time.FixedZone("UTC-12", -12*60*60),
	} {
		before := DateFromTime(time.Now().In(loc))
		got := Today(loc)
		after := DateFromTime(time.Now().In(loc))
		if got != before && got != after {
			t.Errorf("Today(%s) = %v, want %v or %v", loc, got, before, after)
		}
	}

	// The two ends of the offset range lie 26 hours apart, so their dates are
	// always one or two days apart - never the same, never more. Only the zone
	// argument being honoured can produce that.
	east := Today(time.FixedZone("UTC+14", 14*60*60))
	west := Today(time.FixedZone("UTC-12", -12*60*60))
	if d := east.DaysSince(west); d < 1 || d > 2 {
		t.Errorf("UTC+14 is %d days ahead of UTC-12, want 1 or 2", d)
	}
	// A nil location must not panic.
	_ = Today(nil)
}
