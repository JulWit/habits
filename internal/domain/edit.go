package domain

import "time"

// EntryHorizonDays is how many days after today an entry may be dated.
const EntryHorizonDays = 365

// EarliestEntry is the earliest date an entry may have.
var EarliestEntry = Date{Year: 2000, Month: time.January, Day: 1}

// HabitEdit is a change of a habit as the editor saves it, and the request
// body of creating and editing one. Nil fields are left unchanged.
type HabitEdit struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
	// Icon "" removes the icon.
	Icon *string `json:"icon"`
	Kind *Kind   `json:"kind"`
	// CategoryID "" removes the habit from its category.
	CategoryID *string `json:"categoryId"`
	StepValue  *int    `json:"stepValue"`
	Unit       *string `json:"unit"`
	// TargetValue, TargetType and Frequency change the current schedule.
	TargetValue *int        `json:"targetValue"`
	TargetType  *TargetType `json:"targetType"`
	Frequency   *Frequency  `json:"frequency"`
	// Retroactive applies a new target or frequency to the past days as well,
	// instead of from today on.
	Retroactive bool `json:"retroactive"`
	// Archived archives the habit or reactivates it. It is applied with
	// Habit.SetArchived, as archiving records the time.
	Archived *bool `json:"archived"`
}

// SetArchived archives h at now, or reactivates it, and reports whether that
// changed it. An archived habit keeps the time it was archived at.
func (h *Habit) SetArchived(archived bool, now time.Time) bool {
	if archived == (h.ArchivedAt != nil) {
		return false
	}
	if archived {
		h.ArchivedAt = &now
	} else {
		h.ArchivedAt = nil
	}
	return true
}

// changesSchedule reports whether e changes the current schedule.
func (e HabitEdit) changesSchedule() bool {
	return e.TargetValue != nil || e.TargetType != nil || e.Frequency != nil
}

// applyFields copies the fields of e to h, except those of the schedule.
func (e HabitEdit) applyFields(h *Habit) {
	setIf(&h.Name, e.Name)
	setIf(&h.Color, e.Color)
	setIf(&h.Icon, e.Icon)
	setIf(&h.Kind, e.Kind)
	setIf(&h.CategoryID, e.CategoryID)
	setIf(&h.StepValue, e.StepValue)
	setIf(&h.Unit, e.Unit)
}

// setIf sets *dst to *src unless src is nil.
func setIf[T any](dst *T, src *T) {
	if src != nil {
		*dst = *src
	}
}

// NewHabit returns a habit set up by e, whose first schedule starts today.
// The target defaults to 1; the frequency is required and validated with the
// habit (Habit.Validate).
func NewHabit(e HabitEdit, today Date) Habit {
	var h Habit
	e.applyFields(&h)
	first := Schedule{From: today, TargetValue: 1}
	setIf(&first.TargetValue, e.TargetValue)
	setIf(&first.TargetType, e.TargetType)
	setIf(&first.Frequency, e.Frequency)
	h.Schedules = []Schedule{first}
	return h
}

// Apply changes h by e on today and returns the entries converted to a new
// kind, or nil if the kind stays. entries are the habit's entries.
//
// A change of kind converts the history (ConvertKind): ticked days get the
// new target, and the step and unit of the old kind are reset unless e sets
// them. A new target or frequency starts a new schedule from today on, or
// replaces the history with Retroactive (Reschedule). h is validated when it
// is saved.
func (h *Habit) Apply(e HabitEdit, entries map[Date]Entry, today Date) (map[Date]Entry, error) {
	before := *h
	e.applyFields(h)

	var converted map[Date]Entry
	if h.Kind != before.Kind {
		if !h.Kind.Valid() {
			return nil, Invalid("unknown_kind", `unknown habit kind "{kind}"`, "kind", h.Kind)
		}
		target := h.Current().TargetValue
		setIf(&target, e.TargetValue)
		h.Schedules, converted = ConvertKind(before, entries, h.Kind, target)
		if e.StepValue == nil {
			h.StepValue = 0
		}
		if e.Unit == nil {
			h.Unit = ""
		}
	}
	if !e.changesSchedule() {
		return converted, nil
	}
	rules := h.Current()
	setIf(&rules.TargetValue, e.TargetValue)
	setIf(&rules.TargetType, e.TargetType)
	setIf(&rules.Frequency, e.Frequency)
	if err := h.Reschedule(rules, today, e.Retroactive); err != nil {
		return nil, err
	}
	return converted, nil
}
