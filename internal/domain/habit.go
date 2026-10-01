// Package domain holds the rules of the habit tracker: habits and their
// schedules, the status of each day, streaks, statistics and totals, and the
// validation errors shown to the user. It does no I/O; the store persists its
// types and the HTTP API sends them.
package domain

import (
	"slices"
	"strings"
	"time"
)

// Kind is how a habit is measured on a given day.
type Kind string

const (
	// KindCheck is a plain "did it / did not" habit.
	KindCheck Kind = "check"
	// KindCount counts occurrences, e.g. 8 glasses of water.
	KindCount Kind = "count"
	// KindTime counts minutes, e.g. 20 minutes of reading.
	KindTime Kind = "time"
	// KindDistance measures a distance, stored in metres.
	KindDistance Kind = "distance"
)

// allKinds lists all kinds in the order the editor offers them.
var allKinds = []Kind{KindCheck, KindCount, KindTime, KindDistance}

// Valid reports whether k is a known kind.
func (k Kind) Valid() bool { return slices.Contains(allKinds, k) }

// KindInfo describes a kind's value range for the client.
type KindInfo struct {
	// Scale is the number of stored units per displayed unit.
	Scale int `json:"scale"`
	// Step is the default increment per tap, in stored units.
	Step int `json:"step"`
	// Max is the upper bound for a target or a day's value.
	Max int `json:"max"`
	// Unit is the fixed unit, or "" if the user chooses one.
	Unit string `json:"unit"`
}

// KindDescriptors returns the KindInfo of every kind. It is sent to the client
// so that the client does not keep its own copy of these values.
func KindDescriptors() map[Kind]KindInfo {
	out := make(map[Kind]KindInfo, len(allKinds))
	for _, k := range allKinds {
		out[k] = KindInfo{Scale: k.Scale(), Step: k.Step(), Max: k.MaxTarget(), Unit: k.Unit()}
	}
	return out
}

// Scale returns the number of stored units per displayed unit. Values are
// stored as integers: counts and minutes in tenths, distances in metres.
func (k Kind) Scale() int {
	switch k {
	case KindCount, KindTime:
		return 10
	case KindDistance:
		return 1000
	}
	return 1
}

// MaxTarget returns the largest daily target of the kind, in stored units.
func (k Kind) MaxTarget() int {
	switch k {
	case KindCount:
		return 10000 // 1000 of whatever is being counted
	case KindTime:
		return 14400 // minutes in a day
	case KindDistance:
		return 200000 // 200 km
	}
	return 1
}

// Step returns the default increment per tap, in stored units.
func (k Kind) Step() int {
	switch k {
	case KindTime:
		return 50 // 5 minutes
	case KindDistance:
		return 500 // half a kilometre
	case KindCount:
		return 10 // one of whatever is being counted
	}
	return 1
}

// Unit returns the fixed unit of the kind, or "" if the user chooses one.
func (k Kind) Unit() string {
	switch k {
	case KindTime:
		return "min"
	case KindDistance:
		return "m"
	}
	return ""
}

// FrequencyKind is the type of a habit's schedule.
type FrequencyKind string

const (
	// FreqDaily is due every day.
	FreqDaily FrequencyKind = "daily"
	// FreqTimesPerWeek is due a number of times per week, on any days.
	FreqTimesPerWeek FrequencyKind = "times_per_week"
	// FreqWeekdays is due on selected weekdays.
	FreqWeekdays FrequencyKind = "weekdays"
	// FreqCustomInterval is due every n days.
	FreqCustomInterval FrequencyKind = "custom_interval"
	// FreqTimesPerMonth is due a number of times per calendar month, on any
	// days.
	FreqTimesPerMonth FrequencyKind = "times_per_month"
)

// TargetType says whether a day's value has to reach the target or stay
// within it.
type TargetType string

const (
	// TargetAtLeast completes a day once its value reaches the target.
	TargetAtLeast TargetType = "at_least"
	// TargetAtMost is a limit: a day is complete while its value stays at or
	// below the target, a day without a value included. Only for measured
	// kinds with fixed due days.
	TargetAtMost TargetType = "at_most"
)

// Weekdays is a set of weekdays as a bitmask: bit 0 is Monday, bit 6 Sunday.
type Weekdays uint8

// Has reports whether d is in the set.
func (w Weekdays) Has(d time.Weekday) bool {
	mondayFirst := (int(d) + 6) % 7
	return w&(1<<mondayFirst) != 0
}

// Frequency is the schedule of a habit. Only the fields used by Kind are set;
// Validate resets the others to zero.
type Frequency struct {
	Kind          FrequencyKind `json:"kind"`
	TimesPerWeek  int           `json:"timesPerWeek"`
	TimesPerMonth int           `json:"timesPerMonth"`
	// TimesAtMost makes TimesPerWeek or TimesPerMonth a maximum: once a
	// period has that many completed days, no further day can be completed.
	// Otherwise they are a minimum, and further completed days are a bonus.
	TimesAtMost  bool     `json:"timesAtMost"`
	Weekdays     Weekdays `json:"weekdays"`
	IntervalDays int      `json:"intervalDays"`
	// WeekInterval limits FreqWeekdays to every n-th week, counted from the
	// week of AnchorDate. 1 means every week.
	WeekInterval int `json:"weekInterval"`
	// WeekOfMonth limits FreqWeekdays to the n-th occurrence of each weekday in
	// the month (1 to 4, or LastWeekOfMonth). 0 means every occurrence.
	// Cannot be combined with a WeekInterval greater than 1.
	WeekOfMonth int `json:"weekOfMonth"`
	// AnchorDate is the first due day of FreqCustomInterval, or the start week
	// of a WeekInterval greater than 1.
	AnchorDate Date `json:"anchorDate"`
}

// LastWeekOfMonth selects the last occurrence of a weekday in its month.
const LastWeekOfMonth = -1

// Habit is a tracked habit of a single user.
type Habit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	// Icon is one of HabitIcons, or "" for no icon.
	Icon string `json:"icon"`
	Kind Kind   `json:"kind"`
	// CategoryID is "" for no category. If it refers to a deleted category,
	// the habit is shown as uncategorised.
	CategoryID string `json:"categoryId"`
	// StepValue is the increment per tap, in stored units. Always 1 for
	// KindCheck.
	StepValue int    `json:"stepValue"`
	Unit      string `json:"unit"`
	// Schedules are the versions of target and frequency, oldest first; a
	// valid habit has at least one. Each applies from its From until the next
	// one starts, and the first one also covers the days before its From. The
	// last one is the current schedule. So changing the target does not
	// rewrite the past.
	Schedules  []Schedule `json:"schedules"`
	Position   int        `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// Maximum lengths of a habit's name and unit, in characters.
const (
	MaxNameLen = 80
	MaxUnitLen = 16
)

// targetTooSmall returns the error for a target below the minimum of k.
func targetTooSmall(k Kind) error {
	switch k {
	case KindTime:
		return Invalid("time_too_small", "time must be at least 0.1 minutes")
	case KindDistance:
		return Invalid("distance_too_small", "distance must be at least 1 metre")
	}
	return Invalid("target_too_small", "target must be at least 0.1")
}

// targetTooLarge returns the error for a target above the maximum of k,
// stated in display units.
func targetTooLarge(k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return Invalid("time_too_large_minutes", "time may be at most {max} minutes", "max", limit)
	case KindDistance:
		return Invalid("distance_too_large_km", "distance may be at most {max} kilometres", "max", limit)
	}
	return Invalid("target_too_large", "target may be at most {max}", "max", limit)
}

// stepTooLarge returns the error for a step above the maximum of k.
func stepTooLarge(k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return Invalid("step_too_large_minutes", "step may be at most {max} minutes", "max", limit)
	case KindDistance:
		return Invalid("step_too_large_km", "step may be at most {max} kilometres", "max", limit)
	}
	return Invalid("step_too_large", "step may be at most {max}", "max", limit)
}

// valueTooLarge returns the error for a day's value above the maximum of k.
func valueTooLarge(k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return Invalid("value_too_large_minutes", "value may be at most {max} minutes", "max", limit)
	case KindDistance:
		return Invalid("value_too_large_km", "value may be at most {max} kilometres", "max", limit)
	}
	return Invalid("value_too_large", "value may be at most {max}", "max", limit)
}

// Validate normalises h in place and returns a validation error if h is
// invalid.
func (h *Habit) Validate() error {
	h.Name = strings.TrimSpace(h.Name)
	h.Unit = strings.TrimSpace(h.Unit)

	if h.Name == "" {
		return Invalid("name_empty", "name must not be empty")
	}
	if len([]rune(h.Name)) > MaxNameLen {
		return Invalid("name_too_long", "name is longer than {max} characters", "max", MaxNameLen)
	}
	if len([]rune(h.Unit)) > MaxUnitLen {
		return Invalid("unit_too_long", "unit is longer than {max} characters", "max", MaxUnitLen)
	}
	h.Color = strings.ToLower(strings.TrimSpace(h.Color))
	if h.Color == "" {
		h.Color = colors[0]
	}
	if !ValidColor(h.Color) {
		return Invalid("unknown_color", `unknown colour "{color}"`, "color", h.Color)
	}

	h.Icon = strings.TrimSpace(h.Icon)
	if h.Icon != "" && !ValidIcon(h.Icon) {
		return Invalid("unknown_icon", `unknown icon "{icon}"`, "icon", h.Icon)
	}

	if !h.Kind.Valid() {
		return Invalid("unknown_kind", `unknown habit kind "{kind}"`, "kind", h.Kind)
	}
	// The step defaults to the kind's step and is fixed at 1 for KindCheck.
	switch {
	case h.Kind == KindCheck:
		h.StepValue = 1
	case h.StepValue < 1:
		h.StepValue = h.Kind.Step()
	case h.StepValue > h.Kind.MaxTarget():
		return stepTooLarge(h.Kind)
	}
	// Only KindCount has a user-defined unit.
	if h.Kind != KindCount {
		h.Unit = h.Kind.Unit()
	}

	if len(h.Schedules) == 0 {
		return Invalid("schedules_empty", "at least one schedule is required")
	}
	for i, s := range h.Schedules {
		normalized, err := s.normalized(h.Kind)
		if err != nil {
			return err
		}
		h.Schedules[i] = normalized
		if i > 0 && !h.Schedules[i-1].From.Before(h.Schedules[i].From) {
			return Invalid("schedules_unordered", "schedules must start on different days, oldest first")
		}
	}
	return nil
}

// Current returns the current schedule, the last one.
func (h *Habit) Current() Schedule { return h.Schedules[len(h.Schedules)-1] }

// Reschedule makes the target, target type and frequency of rules the habit's
// schedule from day on; rules.From is ignored. Earlier days keep the schedule
// they had. With retroactive, the new schedule replaces the whole history
// instead.
//
// Several changes on one day leave one schedule for that day, and changing
// back to the previous schedule merges both.
func (h *Habit) Reschedule(rules Schedule, day Date, retroactive bool) error {
	rules.From = day
	next, err := rules.normalized(h.Kind)
	if err != nil {
		return err
	}
	// A copy, so that other copies of the habit keep their history.
	schedules := slices.Clone(h.Schedules)
	current := schedules[len(schedules)-1]

	switch {
	case retroactive:
		next.From = schedules[0].From
		schedules = []Schedule{next}
	case next.sameRules(current):
		// Nothing changes.
	case !day.After(current.From):
		// The current schedule starts on day or later: replace it.
		next.From = current.From
		schedules[len(schedules)-1] = next
	default:
		schedules = append(schedules, next)
	}

	if n := len(schedules); n >= 2 && schedules[n-2].sameRules(schedules[n-1]) {
		schedules = schedules[:n-1]
	}
	h.Schedules = schedules
	return nil
}

// ScheduleOn returns the schedule that applies on d.
func (h *Habit) ScheduleOn(d Date) Schedule {
	for i := len(h.Schedules) - 1; i > 0; i-- {
		if !d.Before(h.Schedules[i].From) {
			return h.Schedules[i]
		}
	}
	return h.Schedules[0]
}

// validateEntryValue checks that a day's value lies between 0 and the kind's
// MaxTarget.
func validateEntryValue(k Kind, value int) error {
	if !k.Valid() {
		return Invalid("unknown_kind", `unknown habit kind "{kind}"`, "kind", k)
	}
	if value < 0 {
		return Invalid("value_negative", "value must not be negative")
	}
	if value > k.MaxTarget() {
		return valueTooLarge(k)
	}
	return nil
}

// Target returns the target that applies on d: the value at which d counts
// as completed, or for a limit the largest value that still does.
func (h *Habit) Target(d Date) int {
	if h.Kind == KindCheck {
		return 1
	}
	s := h.ScheduleOn(d)
	if s.isLimit() {
		return s.TargetValue
	}
	return max(s.TargetValue, 1)
}

// IsComplete reports whether value meets the target that applies on d:
// reaches it, or for a limit stays within it.
func (h *Habit) IsComplete(d Date, value int) bool {
	if h.ScheduleOn(d).isLimit() {
		return value <= h.Target(d)
	}
	return value >= h.Target(d)
}

// IsScheduled reports whether the habit is due on d, by the schedule that
// applies on d. Values can only be recorded on scheduled days.
func (h *Habit) IsScheduled(d Date) bool { return h.ScheduleOn(d).IsScheduled(d) }

// colors is the colour palette offered in the editor. Colours are stored as
// these names; the client maps each to a CSS custom property (--c-red, …),
// so the shades can change, or differ per theme, without touching the data.
var colors = []string{
	"red", "orange", "yellow", "lime", "green", "teal",
	"sky", "blue", "indigo", "violet", "pink", "slate",
}

// Colors returns the colour palette offered in the editor, in its order.
func Colors() []string { return slices.Clone(colors) }

// ValidColor reports whether name is one of Colors.
func ValidColor(name string) bool { return slices.Contains(colors, name) }

// habitIcons lists the valid icon names, in the order the editor offers them.
// The icons themselves are defined in the client.
var habitIcons = []string{
	"droplet", "apple", "utensils", "coffee", "pill", "heart", "dumbbell", "bike",
	"mountain", "flame", "bed", "alarm", "morning", "midday", "evening", "moon",
	"sun", "book", "pencil", "lightbulb", "code", "globe", "music", "palette",
	"camera", "leaf", "home", "wallet", "users", "smartphone", "ban", "smile",
	"star", "target", "clock", "hourglass", "calendar", "calendarcheck", "check",
}

// HabitIcons returns the valid icon names, in the order the editor offers
// them.
func HabitIcons() []string { return slices.Clone(habitIcons) }

// ValidIcon reports whether name is one of HabitIcons.
func ValidIcon(name string) bool { return slices.Contains(habitIcons, name) }
