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
// habit (Habit.Normalize).
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

// Apply changes h by e on today. The kind is fixed once the habit exists, as
// the recorded days and the targets are only meaningful in its unit; e may
// repeat it, as the editor sends every field. A new target or frequency
// starts a new schedule from today on, or replaces the history with
// Retroactive (Reschedule). h is normalised and validated when it is saved.
func (h *Habit) Apply(e HabitEdit, today Date) error {
	if e.Kind != nil && *e.Kind != h.Kind {
		return Invalid("kind_unchangeable", "the kind of a habit cannot be changed")
	}
	e.applyFields(h)
	if !e.changesSchedule() {
		return nil
	}
	rules := h.Current()
	setIf(&rules.TargetValue, e.TargetValue)
	setIf(&rules.TargetType, e.TargetType)
	setIf(&rules.Frequency, e.Frequency)
	return h.Reschedule(rules, today, e.Retroactive)
}
