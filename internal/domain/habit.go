package domain

import (
	"errors"
	"math/bits"
	"regexp"
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
	StepValue  int        `json:"stepValue"`
	Unit       string     `json:"unit"`
	Frequency  Frequency  `json:"frequency"`
	Position   int        `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

var (
	// ErrValidation is matched by every validation error (see Problem).
	ErrValidation = errors.New("validation error")
	colorPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
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
		return Invalid("time must be at least 0.1 minutes")
	case KindDistance:
		return Invalid("distance must be at least 1 metre")
	}
	return Invalid("target must be at least 0.1")
}

// tooLarge returns the error for a value above the maximum of k, stated in
// display units. what names the value, e.g. "target" or "step".
func tooLarge(what string, k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return Invalid(what+" may be at most {max} minutes", "max", limit)
	case KindDistance:
		return Invalid(what+" may be at most {max} kilometres", "max", limit)
	}
	return Invalid(what+" may be at most {max}", "max", limit)
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
		return Invalid("name must not be empty")
	}
	if len([]rune(h.Name)) > MaxNameLen {
		return Invalid("name is longer than {max} characters", "max", MaxNameLen)
	}
	if len([]rune(h.Unit)) > MaxUnitLen {
		return Invalid("unit is longer than {max} characters", "max", MaxUnitLen)
	}
	if h.Color == "" {
		h.Color = DefaultColors[0]
	}
	if !colorPattern.MatchString(h.Color) {
		return Invalid("colour must be a hex value like #4caf50")
	}
	h.Color = strings.ToLower(h.Color)

	h.Icon = strings.TrimSpace(h.Icon)
	if h.Icon != "" && !ValidIcon(h.Icon) {
		return Invalid(`unknown icon "{icon}"`, "icon", h.Icon)
	}

	if !h.Kind.Valid() {
		return Invalid(`unknown habit kind "{kind}"`, "kind", h.Kind)
	}
	if h.Kind == KindCheck {
		h.TargetValue = 1
	} else if h.TargetValue < 1 {
		return targetTooSmall(h.Kind)
	}
	if h.TargetValue > h.Kind.MaxTarget() {
		return targetTooLarge(h.Kind)
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

	return h.normaliseFrequency()
}

// normaliseFrequency validates h.Frequency and keeps only the fields its kind
// uses.
func (h *Habit) normaliseFrequency() error {
	f := h.Frequency
	switch f.Kind {
	case FreqDaily:
		h.Frequency = Frequency{Kind: FreqDaily}

	case FreqTimesPerWeek:
		if f.TimesPerWeek < 1 || f.TimesPerWeek > 7 {
			return Invalid("times per week must be between 1 and 7")
		}
		h.Frequency = Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: f.TimesPerWeek}

	case FreqWeekdays:
		if f.Weekdays == 0 {
			return Invalid("at least one weekday must be selected")
		}
		if f.Weekdays > 0b1111111 {
			return Invalid("invalid weekday selection")
		}
		// 0 means every week, for clients that do not send a week interval.
		if f.WeekInterval == 0 {
			f.WeekInterval = 1
		}
		if f.WeekInterval < 1 || f.WeekInterval > 52 {
			return Invalid("week interval must be between 1 and 52 weeks")
		}
		if f.WeekOfMonth != LastWeekOfMonth && (f.WeekOfMonth < 0 || f.WeekOfMonth > 4) {
			return Invalid("week of the month must be 1 to 4 or the last")
		}
		if f.WeekInterval > 1 && f.WeekOfMonth != 0 {
			return Invalid("a week interval and a week of the month cannot be combined")
		}
		// Only a week interval greater than 1 needs an anchor.
		anchor := Date{}
		if f.WeekInterval > 1 {
			anchor = h.anchorOr(f.AnchorDate)
		}
		h.Frequency = Frequency{
			Kind:         FreqWeekdays,
			Weekdays:     f.Weekdays,
			WeekInterval: f.WeekInterval,
			WeekOfMonth:  f.WeekOfMonth,
			AnchorDate:   anchor,
		}

	case FreqCustomInterval:
		if f.IntervalDays < 1 || f.IntervalDays > 365 {
			return Invalid("interval must be between 1 and 365 days")
		}
		h.Frequency = Frequency{
			Kind:         FreqCustomInterval,
			IntervalDays: f.IntervalDays,
			AnchorDate:   h.anchorOr(f.AnchorDate),
		}

	default:
		return Invalid(`unknown frequency "{frequency}"`, "frequency", f.Kind)
	}
	return nil
}

// anchorOr returns anchor, or the habit's creation day if anchor is zero.
func (h Habit) anchorOr(anchor Date) Date {
	if anchor.IsZero() {
		return DateFromTime(h.CreatedAt)
	}
	return anchor
}

// ValidateEntryValue checks that a day's value lies between 0 and the kind's
// MaxTarget.
func ValidateEntryValue(k Kind, value int) error {
	if !k.Valid() {
		return Invalid(`unknown habit kind "{kind}"`, "kind", k)
	}
	if value < 0 {
		return Invalid("value must not be negative")
	}
	if value > k.MaxTarget() {
		return tooLarge("value", k)
	}
	return nil
}

// Target returns the value at which a day counts as completed.
func (h Habit) Target() int {
	if h.Kind == KindCheck {
		return 1
	}
	return max(h.TargetValue, 1)
}

// IsComplete reports whether a day's value reaches the habit's target.
func (h Habit) IsComplete(value int) bool { return value >= h.Target() }

// IsScheduled reports whether the habit is due on d. FreqDaily and
// FreqTimesPerWeek are due every day.
func (h Habit) IsScheduled(d Date) bool {
	switch h.Frequency.Kind {
	case FreqDaily, FreqTimesPerWeek:
		return true
	case FreqWeekdays:
		return h.Frequency.Weekdays.Has(d.Weekday()) && h.inScheduledWeek(d)
	case FreqCustomInterval:
		n := h.Frequency.IntervalDays
		if n < 1 {
			return false
		}
		diff := d.DaysSince(h.anchorOr(h.Frequency.AnchorDate))
		return diff >= 0 && diff%n == 0
	}
	return false
}

// inScheduledWeek reports whether d lies in a week selected by WeekInterval or
// WeekOfMonth.
func (h Habit) inScheduledWeek(d Date) bool {
	f := h.Frequency
	if f.WeekOfMonth == LastWeekOfMonth {
		return d.AddDays(7).Month != d.Month
	}
	if f.WeekOfMonth > 0 {
		return (d.Day-1)/7+1 == f.WeekOfMonth
	}
	if f.WeekInterval > 1 {
		anchor := h.anchorOr(f.AnchorDate)
		if d.Before(anchor) {
			return false
		}
		weeks := d.StartOfWeek().DaysSince(anchor.StartOfWeek()) / 7
		return weeks%f.WeekInterval == 0
	}
	return true
}

// AcceptsEntry reports whether a value may be recorded on d. Schedules with
// fixed days accept entries only on those days.
func (h Habit) AcceptsEntry(d Date) bool {
	switch h.Frequency.Kind {
	case FreqWeekdays, FreqCustomInterval:
		return h.IsScheduled(d)
	}
	return true
}

// IsArchived reports whether the habit is archived.
func (h Habit) IsArchived() bool { return h.ArchivedAt != nil }

// DefaultColors is the colour palette offered in the editor.
var DefaultColors = []string{
	"#dc2626", "#ea580c", "#eab308", "#65a30d",
	"#16a34a", "#0d9488", "#0284c7", "#2563eb",
	"#4f46e5", "#7c3aed", "#db2777", "#64748b",
}

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
