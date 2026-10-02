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
	if err := validateEntryValue(k, e.Value); err != nil {
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
	// Add raises the stored value by a step, up to the kind's maximum, and
	// ends a skip. A tap sends it rather than the new value, so taps on two
	// devices both count, whatever each of them showed (see Resolve).
	Add *int `json:"add"`
}

// Validate returns a validation error if c changes nothing, sets a value and
// skips the day at once, which contradict each other, or adds a step that is
// not positive or comes with a value or a skip.
func (c EntryChange) Validate() error {
	if c.Value == nil && c.Skipped == nil && c.Add == nil {
		return Invalid("entry_change_empty", "a change of a day needs a value or a skip")
	}
	if c.Value != nil && *c.Value > 0 && c.Skipped != nil && *c.Skipped {
		return Invalid("skipped_with_value", "a skipped day cannot have a value")
	}
	if c.Add != nil && (*c.Add < 1 || c.Value != nil || c.Skipped != nil) {
		return Invalid("entry_add_invalid", "a step must be positive and come without a value or a skip")
	}
	return nil
}

// Resolve returns c with Add turned into the value it leads to from e, the
// entry as stored, at most the largest value of kind k. Other changes are
// returned as they are.
func (c EntryChange) Resolve(e Entry, k Kind) EntryChange {
	if c.Add == nil {
		return c
	}
	value := min(e.Value+*c.Add, k.MaxTarget())
	return EntryChange{Value: &value}
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
	return (c.Value != nil && *c.Value > 0) || (c.Skipped != nil && *c.Skipped) ||
		(c.Add != nil && *c.Add > 0)
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
