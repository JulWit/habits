package domain

import (
	"errors"
	"math/bits"
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

// AllKinds lists all kinds in the order the editor offers them.
var AllKinds = []Kind{KindCheck, KindCount, KindTime, KindDistance}

// Valid reports whether k is one of AllKinds.
func (k Kind) Valid() bool { return slices.Contains(AllKinds, k) }

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
	out := make(map[Kind]KindInfo, len(AllKinds))
	for _, k := range AllKinds {
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

// Label returns the display name of the kind, as shown in the editor.
func (k Kind) Label() string {
	switch k {
	case KindCheck:
		return "Check"
	case KindCount:
		return "Count"
	case KindTime:
		return "Time"
	case KindDistance:
		return "Distance"
	}
	return string(k)
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
)

// Weekdays is a set of weekdays as a bitmask: bit 0 is Monday, bit 6 Sunday.
type Weekdays uint8

func weekdayBit(d time.Weekday) Weekdays { return 1 << uint((int(d)+6)%7) }

// Has reports whether d is in the set.
func (w Weekdays) Has(d time.Weekday) bool { return w&weekdayBit(d) != 0 }

// Count returns the number of weekdays in the set.
func (w Weekdays) Count() int { return bits.OnesCount8(uint8(w)) }

// Frequency is the schedule of a habit. Only the fields used by Kind are set;
// Validate resets the others to zero.
type Frequency struct {
	Kind         FrequencyKind `json:"kind"`
	TimesPerWeek int           `json:"timesPerWeek"`
	Weekdays     Weekdays      `json:"weekdays"`
	IntervalDays int           `json:"intervalDays"`
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
//
// TargetValue and Frequency are the current schedule, which applies from
// Since on. Earlier days are judged by the schedule they had then (see
// Previous and ScheduleOn), so changing the target does not rewrite the past.
type Habit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	// Icon is one of HabitIcons, or "" for no icon.
	Icon string `json:"icon"`
	Kind Kind   `json:"kind"`
	// CategoryID is "" for no category. If it refers to a deleted category,
	// the habit is shown as uncategorised.
	CategoryID  string `json:"categoryId"`
	TargetValue int    `json:"targetValue"`
	// StepValue is the increment per tap, in stored units. Always 1 for
	// KindCheck.
	StepValue int       `json:"stepValue"`
	Unit      string    `json:"unit"`
	Frequency Frequency `json:"frequency"`
	// Since is the first day of the current schedule. Zero means the creation
	// day.
	Since Date `json:"-"`
	// Previous are the earlier schedules, oldest first. Each applies from its
	// From until the next one starts; the first one also covers the days
	// before its From.
	Previous   []Schedule `json:"-"`
	Position   int        `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

var (
	// ErrValidation is matched by every validation error (see Problem).
	ErrValidation = errors.New("validation error")
)

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

// tooLarge returns the error for a value above the maximum of k, stated in
// display units. what names the value, e.g. "target" or "step".
func tooLarge(what string, k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return Invalid(what+"_too_large_minutes", what+" may be at most {max} minutes", "max", limit)
	case KindDistance:
		return Invalid(what+"_too_large_km", what+" may be at most {max} kilometres", "max", limit)
	}
	return Invalid(what+"_too_large", what+" may be at most {max}", "max", limit)
}

func targetTooLarge(k Kind) error {
	switch k {
	case KindTime:
		return tooLarge("time", k)
	case KindDistance:
		return tooLarge("distance", k)
	}
	return tooLarge("target", k)
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
		h.Color = Colors[0]
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
	if h.Kind == KindCheck {
		h.StepValue = 1
	} else if h.StepValue < 1 {
		h.StepValue = h.Kind.Step()
	} else if h.StepValue > h.Kind.MaxTarget() {
		return tooLarge("step", h.Kind)
	}
	// Only KindCount has a user-defined unit.
	if u := h.Kind.Unit(); u != "" || h.Kind == KindCheck {
		h.Unit = u
	}

	if h.Since.IsZero() {
		h.Since = DateFromTime(h.CreatedAt)
	}
	for i := range h.Previous {
		if err := h.Previous[i].normalise(h.Kind); err != nil {
			return err
		}
		if i > 0 && !h.Previous[i-1].From.Before(h.Previous[i].From) {
			return Invalid("schedules_unordered", "schedules must start on different days, oldest first")
		}
	}
	if n := len(h.Previous); n > 0 && !h.Previous[n-1].From.Before(h.Since) {
		return Invalid("schedules_unordered", "schedules must start on different days, oldest first")
	}
	current := h.Current()
	if err := current.normalise(h.Kind); err != nil {
		return err
	}
	h.TargetValue, h.Frequency = current.TargetValue, current.Frequency
	return nil
}

// Current returns the current schedule.
func (h Habit) Current() Schedule {
	since := h.Since
	if since.IsZero() {
		since = DateFromTime(h.CreatedAt)
	}
	return Schedule{From: since, TargetValue: h.TargetValue, Frequency: h.Frequency}
}

// Schedules returns all schedules of the habit, oldest first. The last one is
// the current schedule.
func (h Habit) Schedules() []Schedule {
	return append(slices.Clone(h.Previous), h.Current())
}

// SetSchedules replaces the schedule history. The last schedule becomes the
// current one. An empty list changes nothing.
func (h *Habit) SetSchedules(all []Schedule) {
	if len(all) == 0 {
		return
	}
	last := all[len(all)-1]
	h.Previous = slices.Clone(all[:len(all)-1])
	h.Since, h.TargetValue, h.Frequency = last.From, last.TargetValue, last.Frequency
}

// Reschedule is called after the caller has set a new TargetValue or
// Frequency; prev is the schedule before that change. The new schedule applies
// from day on and earlier days keep prev. With retroactive, the new schedule
// replaces the whole history instead. Otherwise nothing changes if the
// new schedule equals prev.
func (h *Habit) Reschedule(prev Schedule, day Date, retroactive bool) error {
	next := Schedule{From: day, TargetValue: h.TargetValue, Frequency: h.Frequency}
	if err := next.normalise(h.Kind); err != nil {
		return err
	}
	switch {
	case retroactive:
		next.From = prev.From
		if len(h.Previous) > 0 {
			next.From = h.Previous[0].From
		}
		h.Previous = nil
	case next.sameRules(prev):
		next = prev
	case !day.After(prev.From):
		// The current schedule starts today or later: replace it.
		next.From = prev.From
	default:
		h.Previous = append(h.Previous, prev)
	}
	// Changing back to the previous schedule merges both.
	if n := len(h.Previous); n > 0 && h.Previous[n-1].sameRules(next) {
		next = h.Previous[n-1]
		h.Previous = h.Previous[:n-1]
	}
	h.Since, h.TargetValue, h.Frequency = next.From, next.TargetValue, next.Frequency
	return nil
}

// ScheduleOn returns the schedule that applies on d.
func (h Habit) ScheduleOn(d Date) Schedule {
	current := h.Current()
	if len(h.Previous) == 0 || !d.Before(current.From) {
		return current
	}
	for i := len(h.Previous) - 1; i > 0; i-- {
		if !d.Before(h.Previous[i].From) {
			return h.Previous[i]
		}
	}
	return h.Previous[0]
}

// ValidateEntryValue checks that a day's value lies between 0 and the kind's
// MaxTarget.
func ValidateEntryValue(k Kind, value int) error {
	if !k.Valid() {
		return Invalid("unknown_kind", `unknown habit kind "{kind}"`, "kind", k)
	}
	if value < 0 {
		return Invalid("value_negative", "value must not be negative")
	}
	if value > k.MaxTarget() {
		return tooLarge("value", k)
	}
	return nil
}

// Target returns the value at which d counts as completed.
func (h Habit) Target(d Date) int {
	if h.Kind == KindCheck {
		return 1
	}
	return max(h.ScheduleOn(d).TargetValue, 1)
}

// IsComplete reports whether value reaches the target that applies on d.
func (h Habit) IsComplete(d Date, value int) bool { return value >= h.Target(d) }

// IsScheduled reports whether the habit is due on d, by the schedule that
// applies on d. Values can only be recorded on scheduled days.
func (h Habit) IsScheduled(d Date) bool { return h.ScheduleOn(d).IsScheduled(d) }

// IsArchived reports whether the habit is archived.
func (h Habit) IsArchived() bool { return h.ArchivedAt != nil }

// Colors is the colour palette offered in the editor. Colours are stored as
// these names; the client maps each to a CSS custom property (--c-red, …),
// so the shades can change, or differ per theme, without touching the data.
var Colors = []string{
	"red", "orange", "yellow", "lime", "green", "teal",
	"sky", "blue", "indigo", "violet", "pink", "slate",
}

// ValidColor reports whether name is one of Colors.
func ValidColor(name string) bool { return slices.Contains(Colors, name) }

// HabitIcons lists the valid icon names, in the order the editor offers them.
// The icons themselves are defined in the client.
var HabitIcons = []string{
	"droplet", "apple", "utensils", "coffee", "pill", "heart", "dumbbell", "bike",
	"mountain", "flame", "bed", "moon", "sun", "book", "pencil", "lightbulb",
	"code", "globe", "music", "palette", "camera", "leaf", "home", "wallet",
	"users", "smartphone", "ban", "smile", "star", "target", "clock", "check",
}

// ValidIcon reports whether name is one of HabitIcons.
func ValidIcon(name string) bool { return slices.Contains(HabitIcons, name) }
