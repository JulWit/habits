package domain

// Entry is what is recorded for a habit on one day: a value, or that the day
// is skipped. A day without a record is the zero Entry.
type Entry struct {
	// Value is 0 if nothing was recorded or the day is skipped.
	Value int `json:"value"`
	// Skipped days count as not due: they neither extend nor break a streak
	// and are left out of the completion rate. A skipped day has no value.
	Skipped bool `json:"skipped"`
}

// IsZero reports whether nothing is recorded, so the day needs no record.
func (e Entry) IsZero() bool { return e == Entry{} }

// Validate returns a validation error if e is not a valid entry of a habit of
// kind k.
func (e Entry) Validate(k Kind) error {
	if err := ValidateEntryValue(k, e.Value); err != nil {
		return err
	}
	if e.Skipped && e.Value > 0 {
		return Invalid("skipped_with_value", "a skipped day cannot have a value")
	}
	return nil
}

// EntryChange changes some parts of a day's entry; nil fields are left as
// they are.
type EntryChange struct {
	// Value sets the value and ends a skip, as a value means the day was not
	// skipped.
	Value *int `json:"value"`
	// Skipped true skips the day and clears its value.
	Skipped *bool `json:"skipped"`
}

// Apply returns e with the change applied.
func (c EntryChange) Apply(e Entry) Entry {
	if c.Value != nil {
		e.Value = *c.Value
		e.Skipped = false
	}
	if c.Skipped != nil {
		e.Skipped = *c.Skipped
		if e.Skipped {
			e.Value = 0
		}
	}
	return e
}

// Records reports whether the change records something: a value or a skip.
// Such a change needs a due day; one that only removes does not.
func (c EntryChange) Records() bool {
	return (c.Value != nil && *c.Value > 0) || (c.Skipped != nil && *c.Skipped)
}

// DaysToSkip returns the days from from to to, oldest first, that skipping
// them for a holiday or an illness changes: the due days that are not skipped
// yet and have no value. Days with a value keep it, as skipping a range of
// days should not erase what was done on them.
func DaysToSkip(h Habit, entries map[Date]Entry, from, to Date) []Date {
	var days []Date
	for d := from; !d.After(to); d = d.AddDays(1) {
		e := entries[d]
		if h.IsScheduled(d) && !e.Skipped && e.Value == 0 {
			days = append(days, d)
		}
	}
	return days
}
