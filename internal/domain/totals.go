package domain

import "time"

// Grain is the size of the periods a habit's values are summed in.
type Grain string

// The grains of SumValues.
const (
	GrainDay   Grain = "day"
	GrainWeek  Grain = "week"
	GrainMonth Grain = "month"
)

// Valid reports whether g is a known grain.
func (g Grain) Valid() bool { return g == GrainDay || g == GrainWeek || g == GrainMonth }

// Bucket is the sum of a habit's values in one period, and the running total
// at its end.
type Bucket struct {
	Start      Date `json:"start"`
	Sum        int  `json:"sum"`
	Cumulative int  `json:"cumulative"`
}

// Totals sums a habit's values over a range of days.
type Totals struct {
	Buckets []Bucket `json:"buckets"`
	// Total is the sum of all values, Best the largest value of a day.
	Total int `json:"total"`
	Best  int `json:"best"`
	// ActiveDays is the number of days with a value.
	ActiveDays int `json:"activeDays"`
}

// SumValues sums the values from from to to per period of grain g. Weeks
// start on Monday; the first bucket starts on the period of from.
func SumValues(entries map[Date]Entry, from, to Date, g Grain) Totals {
	out := Totals{Buckets: []Bucket{}}
	if to.Before(from) {
		return out
	}
	for start := firstBucket(from, g); !start.After(to); start = nextBucket(start, g) {
		out.Buckets = append(out.Buckets, Bucket{Start: start})
	}
	for d, e := range entries {
		if e.Value <= 0 || d.Before(from) || d.After(to) {
			continue
		}
		out.Buckets[bucketIndex(out.Buckets, d)].Sum += e.Value
		out.Total += e.Value
		out.ActiveDays++
		out.Best = max(out.Best, e.Value)
	}
	running := 0
	for i := range out.Buckets {
		running += out.Buckets[i].Sum
		out.Buckets[i].Cumulative = running
	}
	return out
}

// firstBucket returns the start of the first bucket of a range from d: the
// Monday of its week for the week grain, otherwise d itself, so that a month
// bucket covers the rest of d's month.
func firstBucket(d Date, g Grain) Date {
	if g == GrainWeek {
		return d.StartOfWeek()
	}
	return d
}

// nextBucket returns the start of the period after the one starting on start.
func nextBucket(start Date, g Grain) Date {
	switch g {
	case GrainWeek:
		return start.AddDays(7)
	case GrainMonth:
		return DateFromTime(time.Date(start.Year, start.Month+1, 1, 0, 0, 0, 0, time.UTC))
	}
	return start.AddDays(1)
}

// bucketIndex returns the index of the bucket containing d, the last one
// starting on or before it.
func bucketIndex(buckets []Bucket, d Date) int {
	i := len(buckets) - 1
	for i > 0 && d.Before(buckets[i].Start) {
		i--
	}
	return i
}
