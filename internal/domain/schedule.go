package domain

// Schedule is a habit's target and frequency from a given day on.
type Schedule struct {
	// From is the first day the schedule applies to.
	From        Date      `json:"from"`
	TargetValue int       `json:"targetValue"`
	Frequency   Frequency `json:"frequency"`
}

// sameRules reports whether s and o judge every day alike, whatever day they
// start on.
func (s Schedule) sameRules(o Schedule) bool {
	return s.TargetValue == o.TargetValue && s.Frequency == o.Frequency
}

// normalise validates s for a habit of kind k and keeps only the frequency
// fields its kind uses. A missing anchor defaults to From.
func (s *Schedule) normalise(k Kind) error {
	if s.From.IsZero() {
		return Invalid("schedule_start_missing", "a schedule needs a start day")
	}
	if k == KindCheck {
		s.TargetValue = 1
	} else if s.TargetValue < 1 {
		return targetTooSmall(k)
	}
	if s.TargetValue > k.MaxTarget() {
		return targetTooLarge(k)
	}

	f := s.Frequency
	switch f.Kind {
	case FreqDaily:
		s.Frequency = Frequency{Kind: FreqDaily}

	case FreqTimesPerWeek:
		if f.TimesPerWeek < 1 || f.TimesPerWeek > 7 {
			return Invalid("times_per_week_range", "times per week must be between 1 and 7")
		}
		s.Frequency = Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: f.TimesPerWeek}

	case FreqWeekdays:
		if f.Weekdays == 0 {
			return Invalid("weekday_missing", "at least one weekday must be selected")
		}
		if f.Weekdays > 0b1111111 {
			return Invalid("weekdays_invalid", "invalid weekday selection")
		}
		// 0 means every week, for clients that do not send a week interval.
		if f.WeekInterval == 0 {
			f.WeekInterval = 1
		}
		if f.WeekInterval < 1 || f.WeekInterval > 52 {
			return Invalid("week_interval_range", "week interval must be between 1 and 52 weeks")
		}
		if f.WeekOfMonth != LastWeekOfMonth && (f.WeekOfMonth < 0 || f.WeekOfMonth > 4) {
			return Invalid("week_of_month_invalid", "week of the month must be 1 to 4 or the last")
		}
		if f.WeekInterval > 1 && f.WeekOfMonth != 0 {
			return Invalid("week_interval_and_month", "a week interval and a week of the month cannot be combined")
		}
		// Only a week interval greater than 1 needs an anchor.
		anchor := Date{}
		if f.WeekInterval > 1 {
			anchor = s.anchorOr(f.AnchorDate)
		}
		s.Frequency = Frequency{
			Kind:         FreqWeekdays,
			Weekdays:     f.Weekdays,
			WeekInterval: f.WeekInterval,
			WeekOfMonth:  f.WeekOfMonth,
			AnchorDate:   anchor,
		}

	case FreqCustomInterval:
		if f.IntervalDays < 1 || f.IntervalDays > 365 {
			return Invalid("interval_range", "interval must be between 1 and 365 days")
		}
		s.Frequency = Frequency{
			Kind:         FreqCustomInterval,
			IntervalDays: f.IntervalDays,
			AnchorDate:   s.anchorOr(f.AnchorDate),
		}

	default:
		return Invalid("unknown_frequency", `unknown frequency "{frequency}"`, "frequency", f.Kind)
	}
	return nil
}

// anchorOr returns anchor, or the schedule's first day if anchor is zero.
func (s Schedule) anchorOr(anchor Date) Date {
	if anchor.IsZero() {
		return s.From
	}
	return anchor
}

// IsScheduled reports whether the schedule makes d a due day. FreqDaily and
// FreqTimesPerWeek are due every day.
func (s Schedule) IsScheduled(d Date) bool {
	f := s.Frequency
	switch f.Kind {
	case FreqDaily, FreqTimesPerWeek:
		return true
	case FreqWeekdays:
		return f.Weekdays.Has(d.Weekday()) && s.inScheduledWeek(d)
	case FreqCustomInterval:
		if f.IntervalDays < 1 {
			return false
		}
		diff := d.DaysSince(s.anchorOr(f.AnchorDate))
		return diff >= 0 && diff%f.IntervalDays == 0
	}
	return false
}

// inScheduledWeek reports whether d lies in a week selected by WeekInterval or
// WeekOfMonth.
func (s Schedule) inScheduledWeek(d Date) bool {
	f := s.Frequency
	if f.WeekOfMonth == LastWeekOfMonth {
		return d.AddDays(7).Month != d.Month
	}
	if f.WeekOfMonth > 0 {
		return (d.Day-1)/7+1 == f.WeekOfMonth
	}
	if f.WeekInterval > 1 {
		anchor := s.anchorOr(f.AnchorDate)
		if d.Before(anchor) {
			return false
		}
		weeks := d.StartOfWeek().DaysSince(anchor.StartOfWeek()) / 7
		return weeks%f.WeekInterval == 0
	}
	return true
}

// DueDays reports for every day from from to to whether the habit is due on
// it, as a string with one character per day: '1' for due, '0' for not. It
// lets clients show the schedule without knowing its rules.
func DueDays(h Habit, from, to Date) string {
	if to.Before(from) {
		return ""
	}
	out := make([]byte, 0, to.DaysSince(from)+1)
	for d := from; !d.After(to); d = d.AddDays(1) {
		if h.IsScheduled(d) {
			out = append(out, '1')
		} else {
			out = append(out, '0')
		}
	}
	return string(out)
}
