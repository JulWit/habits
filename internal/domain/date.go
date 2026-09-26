package domain

import (
	"errors"
	"fmt"
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

// ParseDate parses a date in DateLayout format.
func ParseDate(s string) (Date, error) {
	t, err := time.ParseInLocation(DateLayout, s, time.UTC)
	if err != nil {
		return Date{}, fmt.Errorf("%w: %q", ErrInvalidDate, s)
	}
	return DateFromTime(t), nil
}

// IsZero reports whether d is the zero Date.
func (d Date) IsZero() bool { return d == Date{} }

// String formats d in DateLayout, or returns "" for the zero Date.
func (d Date) String() string {
	if d.IsZero() {
		return ""
	}
	return fmt.Sprintf("%04d-%02d-%02d", d.Year, int(d.Month), d.Day)
}

// Time returns d at midnight UTC.
func (d Date) Time() time.Time {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
}

// AddDays returns d shifted by n days.
func (d Date) AddDays(n int) Date { return DateFromTime(d.Time().AddDate(0, 0, n)) }

// Weekday returns the day of the week of d.
func (d Date) Weekday() time.Weekday { return d.Time().Weekday() }

// DaysSince returns the number of days from other to d; negative if d is
// earlier.
func (d Date) DaysSince(other Date) int {
	return int(d.Time().Sub(other.Time()) / (24 * time.Hour))
}

// Before reports whether d is earlier than o.
func (d Date) Before(o Date) bool { return d.Time().Before(o.Time()) }

// After reports whether d is later than o.
func (d Date) After(o Date) bool { return d.Time().After(o.Time()) }

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
