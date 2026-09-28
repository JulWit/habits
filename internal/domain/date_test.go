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
	for _, s := range []string{
		"", "2026-13-01", "2026-00-10", "2026-02-30", "2026-02-29", "1900-02-29", "2026-04-31",
		"18.09.2026", "2026-9-8", "2026-09-8x", "+026-09-08", "heute",
	} {
		if _, err := ParseDate(s); err == nil {
			t.Errorf("ParseDate(%q) was accepted", s)
		}
	}
}

// Day arithmetic is unaffected by DST transitions (in Germany in 2026: 29 March
// and 25 October).
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
	for offset := range 7 {
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
	for offset := range 7 {
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
}

// A Date is encoded as "YYYY-MM-DD", the zero Date as "".
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

	// "" decodes to the zero Date.
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
	// The result must match the date in loc before or after the call, in case
	// midnight passes in between.
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

	// UTC+14 and UTC-12 are 26 hours apart, so their dates always differ by one
	// or two days.
	east := Today(time.FixedZone("UTC+14", 14*60*60))
	west := Today(time.FixedZone("UTC-12", -12*60*60))
	if d := east.DaysSince(west); d < 1 || d > 2 {
		t.Errorf("UTC+14 is %d days ahead of UTC-12, want 1 or 2", d)
	}
	// A nil location must not panic.
	_ = Today(nil)
}

func TestUntilTomorrow(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		now  time.Time
		want time.Duration
	}{
		{"evening", time.Date(2026, time.May, 4, 22, 30, 0, 0, berlin), 90 * time.Minute},
		{"midnight", time.Date(2026, time.May, 4, 0, 0, 0, 0, berlin), 24 * time.Hour},
		{"end of year", time.Date(2026, time.December, 31, 23, 59, 0, 0, berlin), time.Minute},
		// The clocks go forward at 2:00 on 29 March 2026: the day has 23 hours.
		{"short day", time.Date(2026, time.March, 29, 0, 0, 0, 0, berlin), 23 * time.Hour},
		// The time is converted into the zone first: 23:00 UTC is 1:00 the
		// next day in Berlin in summer.
		{"other zone", time.Date(2026, time.May, 4, 23, 0, 0, 0, time.UTC), 23 * time.Hour},
	} {
		if got := UntilTomorrow(tc.now, berlin); got != tc.want {
			t.Errorf("%s: UntilTomorrow = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// AddDays crosses month and year ends, including leap days.
func TestAddDaysAcrossMonths(t *testing.T) {
	for _, tc := range []struct {
		from Date
		n    int
		want Date
	}{
		{Date{2026, time.January, 31}, 1, Date{2026, time.February, 1}},
		{Date{2024, time.February, 28}, 1, Date{2024, time.February, 29}},
		{Date{2026, time.February, 28}, 1, Date{2026, time.March, 1}},
		{Date{2026, time.December, 31}, 1, Date{2027, time.January, 1}},
		{Date{2026, time.March, 1}, -1, Date{2026, time.February, 28}},
		{Date{2026, time.September, 18}, 10, Date{2026, time.September, 28}},
		{Date{2026, time.September, 18}, -400, Date{2025, time.August, 14}},
	} {
		if got := tc.from.AddDays(tc.n); got != tc.want {
			t.Errorf("%v + %d = %v, want %v", tc.from, tc.n, got, tc.want)
		}
	}
}

// Dates compare by year, month and day.
func TestCompare(t *testing.T) {
	a, b := Date{2025, time.December, 31}, Date{2026, time.January, 1}
	if a.Compare(b) != -1 || b.Compare(a) != 1 || a.Compare(a) != 0 || !a.Before(b) || !b.After(a) {
		t.Errorf("comparing %v and %v", a, b)
	}
}
