package domain

import (
	"cmp"
	"errors"
	"fmt"
	"strconv"
	"time"
)

// Date is a calendar date without time of day or time zone.
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// DateLayout is the ISO 8601 format used for Date in JSON and in the database.
const DateLayout = "2006-01-02"

// ErrInvalidDate is returned for strings that are not valid dates.
var ErrInvalidDate = errors.New("invalid date")

// DateFromTime returns the calendar date of t in t's location.
func DateFromTime(t time.Time) Date {
	y, m, d := t.Date()
	return Date{Year: y, Month: m, Day: d}
}

// Today returns the current date in loc, or in the local zone if loc is nil.
func Today(loc *time.Location) Date {
	if loc == nil {
		loc = time.Local
	}
	return DateFromTime(time.Now().In(loc))
}

// UntilTomorrow returns the time from now until the next day begins in loc.
func UntilTomorrow(now time.Time, loc *time.Location) time.Duration {
	local := now.In(loc)
	y, m, d := local.Date()
	// time.Date normalises day d+1 into the next month or year.
	return time.Date(y, m, d+1, 0, 0, 0, 0, loc).Sub(local)
}

// ParseDate parses a date in DateLayout format.
func ParseDate(s string) (Date, error) {
	invalid := fmt.Errorf("%w: %q", ErrInvalidDate, s)
	if len(s) != len(DateLayout) || s[4] != '-' || s[7] != '-' {
		return Date{}, invalid
	}
	year, okY := digits(s[0:4])
	month, okM := digits(s[5:7])
	day, okD := digits(s[8:10])
	if !okY || !okM || !okD || month < 1 || month > 12 || day < 1 || day > daysIn(year, time.Month(month)) {
		return Date{}, invalid
	}
	return Date{Year: year, Month: time.Month(month), Day: day}, nil
}

// digits returns the number written by the decimal digits of s, and false if
// s holds anything else.
func digits(s string) (int, bool) {
	n := 0
	for _, c := range []byte(s) {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}

// daysIn returns the number of days of month m in year.
func daysIn(year int, m time.Month) int {
	switch m {
	case time.February:
		if year%4 == 0 && (year%100 != 0 || year%400 == 0) {
			return 29
		}
		return 28
	case time.April, time.June, time.September, time.November:
		return 30
	}
	return 31
}

// IsZero reports whether d is the zero Date.
func (d Date) IsZero() bool { return d == Date{} }

// String formats d in DateLayout, or returns "" for the zero Date.
func (d Date) String() string {
	if d.IsZero() {
		return ""
	}
	b := make([]byte, 0, len(DateLayout))
	b = appendPadded(b, d.Year, 4)
	b = append(b, '-')
	b = appendPadded(b, int(d.Month), 2)
	b = append(b, '-')
	b = appendPadded(b, d.Day, 2)
	return string(b)
}

// appendPadded appends n to b with at least width digits, padded with zeros.
func appendPadded(b []byte, n, width int) []byte {
	s := strconv.Itoa(n)
	for range width - len(s) {
		b = append(b, '0')
	}
	return append(b, s...)
}

// Time returns d at midnight UTC.
func (d Date) Time() time.Time {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
}

// AddDays returns d shifted by n days. A step within the month, the common
// case of the day-by-day loops of the statistics, is computed directly.
func (d Date) AddDays(n int) Date {
	if day := d.Day + n; !d.IsZero() && day >= 1 && day <= daysIn(d.Year, d.Month) {
		return Date{Year: d.Year, Month: d.Month, Day: day}
	}
	return DateFromTime(d.Time().AddDate(0, 0, n))
}

// Weekday returns the day of the week of d.
func (d Date) Weekday() time.Weekday { return d.Time().Weekday() }

// DaysSince returns the number of days from other to d; negative if d is
// earlier.
func (d Date) DaysSince(other Date) int {
	return int(d.Time().Sub(other.Time()) / (24 * time.Hour))
}

// Compare returns -1 if d is earlier than o, 1 if it is later, and 0 if they
// are the same day.
func (d Date) Compare(o Date) int {
	if c := cmp.Compare(d.Year, o.Year); c != 0 {
		return c
	}
	if c := cmp.Compare(d.Month, o.Month); c != 0 {
		return c
	}
	return cmp.Compare(d.Day, o.Day)
}

// Before reports whether d is earlier than o.
func (d Date) Before(o Date) bool { return d.Compare(o) < 0 }

// After reports whether d is later than o.
func (d Date) After(o Date) bool { return d.Compare(o) > 0 }

// Min returns the earlier of d and o.
func (d Date) Min(o Date) Date {
	if d.Before(o) {
		return d
	}
	return o
}

// StartOfWeek returns the Monday of d's week.
func (d Date) StartOfWeek() Date {
	return d.AddDays(-((int(d.Weekday()) + 6) % 7))
}

// MarshalJSON encodes d as a DateLayout string.
func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.String() + `"`), nil
}

// UnmarshalJSON decodes a DateLayout string; "" yields the zero Date.
func (d *Date) UnmarshalJSON(b []byte) error {
	if len(b) < 2 || b[0] != '"' || b[len(b)-1] != '"' {
		return ErrInvalidDate
	}
	s := string(b[1 : len(b)-1])
	if s == "" {
		*d = Date{}
		return nil
	}
	parsed, err := ParseDate(s)
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}
