package domain

import (
	"errors"
	"fmt"
	"time"
)

// Date is a calendar date without a time or a zone. Habit tracking is a
// calendar-day concept: "did I read yesterday" must not change meaning when the
// process restarts in a different zone, so dates are deliberately kept free of
// wall-clock information instead of being time.Time values that happen to be
// truncated to midnight.
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// DateLayout is the wire and storage format for a Date (ISO 8601, sortable as
// plain text, which is what lets SQLite range-query the entries table).
const DateLayout = "2006-01-02"

var ErrInvalidDate = errors.New("ungültiges Datum")

func DateFromTime(t time.Time) Date {
	y, m, d := t.Date()
	return Date{Year: y, Month: m, Day: d}
}

// Today resolves the current calendar date in loc. The location comes from
// configuration rather than from the request, so a self-hosted instance has one
// unambiguous notion of "today".
func Today(loc *time.Location) Date {
	if loc == nil {
		loc = time.Local
	}
	return DateFromTime(time.Now().In(loc))
}

func ParseDate(s string) (Date, error) {
	t, err := time.ParseInLocation(DateLayout, s, time.UTC)
	if err != nil {
		return Date{}, fmt.Errorf("%w: %q", ErrInvalidDate, s)
	}
	return DateFromTime(t), nil
}

func (d Date) IsZero() bool { return d == Date{} }

func (d Date) String() string {
	if d.IsZero() {
		return ""
	}
	return fmt.Sprintf("%04d-%02d-%02d", d.Year, int(d.Month), d.Day)
}

// Time anchors the date at UTC midnight. UTC has no DST transitions, so day
// arithmetic built on top of it is exact.
func (d Date) Time() time.Time {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
}

func (d Date) AddDays(n int) Date { return DateFromTime(d.Time().AddDate(0, 0, n)) }

func (d Date) Weekday() time.Weekday { return d.Time().Weekday() }

// DaysSince returns the whole number of days from other to d, negative if d is
// earlier.
func (d Date) DaysSince(other Date) int {
	return int(d.Time().Sub(other.Time()) / (24 * time.Hour))
}

func (d Date) Before(o Date) bool { return d.Time().Before(o.Time()) }
func (d Date) After(o Date) bool  { return d.Time().After(o.Time()) }

func (d Date) Min(o Date) Date {
	if d.Before(o) {
		return d
	}
	return o
}

// StartOfWeek returns the Monday of d's week. Weeks start on Monday throughout
// the application, including in the times-per-week frequency.
func (d Date) StartOfWeek() Date {
	return d.AddDays(-((int(d.Weekday()) + 6) % 7))
}

func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.String() + `"`), nil
}

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
