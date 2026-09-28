package domain

import "strings"

// Entry is what is recorded for a habit on one day: a value, or that the day
// is skipped, and a note either way. A day without a record is the zero
// Entry.
type Entry struct {
	// Value is 0 if nothing was recorded or the day is skipped.
	Value int `json:"value"`
	// Skipped days count as not due: they neither extend nor break a streak
	// and are left out of the completion rate. A skipped day has no value.
	Skipped bool   `json:"skipped"`
	Note    string `json:"note"`
}

// MaxNoteLen is the maximum length of a note, in characters.
const MaxNoteLen = 500

// IsZero reports whether nothing is recorded, so the day needs no record.
func (e Entry) IsZero() bool { return e == Entry{} }

// Validate normalises e in place and returns a validation error if it is not
// a valid entry of a habit of kind k.
func (e *Entry) Validate(k Kind) error {
	e.Note = strings.TrimSpace(e.Note)
	if err := ValidateEntryValue(k, e.Value); err != nil {
		return err
	}
	if e.Skipped && e.Value > 0 {
		return Invalid("skipped_with_value", "a skipped day cannot have a value")
	}
	if len([]rune(e.Note)) > MaxNoteLen {
		return Invalid("note_too_long", "note is longer than {max} characters", "max", MaxNoteLen)
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
	Skipped *bool   `json:"skipped"`
	Note    *string `json:"note"`
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
	if c.Note != nil {
		e.Note = *c.Note
	}
	return e
}

// Records reports whether the change records something: a value, a skip or a
// note. Such a change needs a due day; one that only removes does not.
func (c EntryChange) Records() bool {
	return (c.Value != nil && *c.Value > 0) ||
		(c.Skipped != nil && *c.Skipped) ||
		(c.Note != nil && strings.TrimSpace(*c.Note) != "")
}
