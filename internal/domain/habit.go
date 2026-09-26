package domain

import (
	"errors"
	"math/bits"
	"regexp"
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
	// KindDistance counts metres. Stored in metres rather than kilometres so a
	// day's value stays a whole number like every other kind; the UI formats it
	// as kilometres once it passes a thousand.
	KindDistance Kind = "distance"
)

// AllKinds is every kind there is, in the order the editor offers them. One
// list rather than a switch per question, so adding a kind is one edit.
var AllKinds = []Kind{KindCheck, KindCount, KindTime, KindDistance}

func (k Kind) Valid() bool {
	for _, known := range AllKinds {
		if k == known {
			return true
		}
	}
	return false
}

// KindInfo is everything the client has to know to treat a kind correctly.
type KindInfo struct {
	// Scale is how many stored units make one unit the reader writes.
	Scale int `json:"scale"`
	// Step is how much a single tap adds, in stored units.
	Step int `json:"step"`
	// Max is the largest value a target or a single day may hold.
	Max int `json:"max"`
	// Unit is the fixed unit, or "" where the user names their own.
	Unit string `json:"unit"`
}

// KindDescriptors is the per-kind table the state response carries.
//
// Sent to the client rather than mirrored there. These four numbers decide what
// a stored integer means — 5000 is five kilometres or five hundred repetitions
// depending on them — and a second copy in JavaScript is a copy that can drift.
// A drift here would not throw; it would quietly misread every entry a habit
// has.
func KindDescriptors() map[Kind]KindInfo {
	out := make(map[Kind]KindInfo, len(AllKinds))
	for _, k := range AllKinds {
		out[k] = KindInfo{Scale: k.Scale(), Step: k.Step(), Max: k.MaxTarget(), Unit: k.Unit()}
	}
	return out
}

// Scale is how many stored units go into one unit the reader writes.
//
// Values are whole numbers all the way down, so a kind that accepts a decimal
// place has to be kept finer than it is spelled: tenths of a count, tenths of
// a minute - six seconds - and metres for a distance written in kilometres.
func (k Kind) Scale() int {
	switch k {
	case KindCount, KindTime:
		return 10
	case KindDistance:
		return 1000
	}
	return 1
}

// MaxTarget is the largest daily target the kind accepts, in stored units. One
// global limit does not work across kinds: a whole day of minutes is an absurdly
// short distance, and 200 km would be a nonsensical number of glasses of water.
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

// Step is how much one tap adds by default, in stored units. Minutes and metres
// move in useful chunks rather than one at a time; every counting kind can be
// given a step of its own.
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

// Label is what the editor calls the kind. It lives here because the server
// writes it into messages the user reads, and a message naming a kind
// differently from the radio button next to it is a seam showing through.
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

// Unit is the fixed unit of a kind, or "" when the user names it themselves.
func (k Kind) Unit() string {
	switch k {
	case KindTime:
		return "min"
	case KindDistance:
		return "m"
	}
	return ""
}

// FrequencyKind is how often a habit is expected.
type FrequencyKind string

const (
	FreqDaily          FrequencyKind = "daily"
	FreqTimesPerWeek   FrequencyKind = "times_per_week"
	FreqWeekdays       FrequencyKind = "weekdays"
	FreqCustomInterval FrequencyKind = "custom_interval"
)

func (f FrequencyKind) Valid() bool {
	switch f {
	case FreqDaily, FreqTimesPerWeek, FreqWeekdays, FreqCustomInterval:
		return true
	}
	return false
}

// Weekdays is a bitmask with bit 0 = Monday through bit 6 = Sunday. A bitmask
// keeps the column a single integer, which matters once habits are queried in
// bulk for the overview.
type Weekdays uint8

func weekdayBit(d time.Weekday) Weekdays { return 1 << uint((int(d)+6)%7) }

func (w Weekdays) Has(d time.Weekday) bool { return w&weekdayBit(d) != 0 }
func (w Weekdays) Count() int              { return bits.OnesCount8(uint8(w)) }

// Frequency describes the schedule of a habit. Only the fields belonging to
// Kind carry meaning; the others are normalised to zero by Validate so that two
// habits with the same effective schedule compare equal.
type Frequency struct {
	Kind         FrequencyKind `json:"kind"`
	TimesPerWeek int           `json:"timesPerWeek"`
	Weekdays     Weekdays      `json:"weekdays"`
	IntervalDays int           `json:"intervalDays"`
	// WeekInterval narrows chosen weekdays to every n-th week, counted in whole
	// Monday-to-Sunday weeks from the week of AnchorDate. One is every week.
	WeekInterval int `json:"weekInterval"`
	// WeekOfMonth narrows chosen weekdays to their n-th occurrence in the month:
	// 1 to 4, or LastWeekOfMonth for the last one. Zero is every occurrence. It
	// cannot be combined with a WeekInterval above one.
	WeekOfMonth int `json:"weekOfMonth"`
	// AnchorDate is the first due day of a custom-interval schedule, or the
	// start of an every-n-weeks one. Without it the phase would silently shift
	// whenever the habit is edited.
	AnchorDate Date `json:"anchorDate"`
}

// LastWeekOfMonth is the WeekOfMonth for the last occurrence of a weekday in
// its month, whether that is the fourth or the fifth.
const LastWeekOfMonth = -1

// Habit is a tracked habit belonging to exactly one user.
type Habit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	// Icon names one of HabitIcons, or is empty for a habit drawn without one.
	Icon string `json:"icon"`
	Kind Kind   `json:"kind"`
	// CategoryID is empty when the habit belongs to no category. It may also
	// point at a soft-deleted category, in which case the habit shows up as
	// uncategorised until that category is restored.
	CategoryID  string `json:"categoryId"`
	TargetValue int    `json:"targetValue"`
	// StepValue is how much one tap, or one press of + or -, adds. It starts at
	// the kind's natural step and every kind but a tick lets the user change
	// it: "one glass" is the obvious increment for water, "ten" is for push-ups.
	StepValue  int        `json:"stepValue"`
	Unit       string     `json:"unit"`
	Frequency  Frequency  `json:"frequency"`
	Position   int        `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

var (
	ErrValidation = errors.New("validation error")
	colorPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

const (
	MaxNameLen = 80
	MaxUnitLen = 16
)

// The bounds messages are phrased per kind, so the reader is told about
// minutes or metres rather than about an abstract "target".
func targetTooSmall(k Kind) error {
	switch k {
	case KindTime:
		return invalid("time must be at least 0.1 minutes")
	case KindDistance:
		return invalid("distance must be at least 1 metre")
	}
	return invalid("target must be at least 0.1")
}

// tooLarge names a kind's ceiling the way the reader wrote it: the stored
// number divided back down, with the unit it is entered in. what is the thing
// being bounded - "target", "step", "value" - and is part of the template, so
// every combination is a sentence of its own for the translation to key on.
func tooLarge(what string, k Kind) error {
	limit := k.MaxTarget() / k.Scale()
	switch k {
	case KindTime:
		return invalid(what+" may be at most {max} minutes", "max", limit)
	case KindDistance:
		return invalid(what+" may be at most {max} kilometres", "max", limit)
	}
	return invalid(what+" may be at most {max}", "max", limit)
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

var invalid = Invalid

// Validate normalises the habit in place and reports why it is unacceptable.
// Normalising here rather than in the HTTP layer means the invariants hold for
// every future entry point, including imports and CLI tooling.
func (h *Habit) Validate() error {
	h.Name = strings.TrimSpace(h.Name)
	h.Unit = strings.TrimSpace(h.Unit)

	if h.Name == "" {
		return invalid("name must not be empty")
	}
	if len([]rune(h.Name)) > MaxNameLen {
		return invalid("name is longer than {max} characters", "max", MaxNameLen)
	}
	if len([]rune(h.Unit)) > MaxUnitLen {
		return invalid("unit is longer than {max} characters", "max", MaxUnitLen)
	}
	if h.Color == "" {
		h.Color = DefaultColors[0]
	}
	if !colorPattern.MatchString(h.Color) {
		return invalid("colour must be a hex value like #4caf50")
	}
	h.Color = strings.ToLower(h.Color)

	h.Icon = strings.TrimSpace(h.Icon)
	if h.Icon != "" && !ValidIcon(h.Icon) {
		return invalid(`unknown icon "{icon}"`, "icon", h.Icon)
	}

	if !h.Kind.Valid() {
		return invalid(`unknown habit kind "{kind}"`, "kind", h.Kind)
	}
	if h.Kind == KindCheck {
		// A tick is done or it is not; there is nothing to configure.
		h.TargetValue = 1
	} else if h.TargetValue < 1 {
		return targetTooSmall(h.Kind)
	}
	if h.TargetValue > h.Kind.MaxTarget() {
		return targetTooLarge(h.Kind)
	}
	// A tick has nothing to count, so its step stays one whatever a client
	// sends. The counting kinds start at the step of their unit and may be set
	// to anything up to their own maximum.
	if h.Kind == KindCheck {
		h.StepValue = 1
	} else if h.StepValue < 1 {
		h.StepValue = h.Kind.Step()
	} else if h.StepValue > h.Kind.MaxTarget() {
		return tooLarge("step", h.Kind)
	}
	// Kinds with a fixed unit own it; only a count lets the user name one.
	if u := h.Kind.Unit(); u != "" || h.Kind == KindCheck {
		h.Unit = u
	}

	return h.normaliseFrequency()
}

func (h *Habit) normaliseFrequency() error {
	f := &h.Frequency
	if !f.Kind.Valid() {
		return invalid(`unknown frequency "{frequency}"`, "frequency", f.Kind)
	}
	switch f.Kind {
	case FreqDaily:
		f.TimesPerWeek, f.Weekdays, f.IntervalDays, f.AnchorDate = 0, 0, 0, Date{}
		f.WeekInterval, f.WeekOfMonth = 0, 0
	case FreqTimesPerWeek:
		if f.TimesPerWeek < 1 || f.TimesPerWeek > 7 {
			return invalid("times per week must be between 1 and 7")
		}
		f.Weekdays, f.IntervalDays, f.AnchorDate = 0, 0, Date{}
		f.WeekInterval, f.WeekOfMonth = 0, 0
	case FreqWeekdays:
		if f.Weekdays == 0 {
			return invalid("at least one weekday must be selected")
		}
		if f.Weekdays > 0b1111111 {
			return invalid("invalid weekday selection")
		}
		// Zero is what a client that knows nothing of the week interval sends,
		// and it means what it always has: every week.
		if f.WeekInterval == 0 {
			f.WeekInterval = 1
		}
		if f.WeekInterval < 1 || f.WeekInterval > 52 {
			return invalid("week interval must be between 1 and 52 weeks")
		}
		if f.WeekOfMonth != LastWeekOfMonth && (f.WeekOfMonth < 0 || f.WeekOfMonth > 4) {
			return invalid("week of the month must be 1 to 4 or the last")
		}
		if f.WeekInterval > 1 && f.WeekOfMonth != 0 {
			return invalid("a week interval and a week of the month cannot be combined")
		}
		// Only an every-n-weeks schedule has a phase to keep.
		if f.WeekInterval > 1 {
			if f.AnchorDate.IsZero() {
				f.AnchorDate = DateFromTime(h.CreatedAt)
			}
		} else {
			f.AnchorDate = Date{}
		}
		f.TimesPerWeek, f.IntervalDays = 0, 0
	case FreqCustomInterval:
		if f.IntervalDays < 1 || f.IntervalDays > 365 {
			return invalid("interval must be between 1 and 365 days")
		}
		if f.AnchorDate.IsZero() {
			f.AnchorDate = DateFromTime(h.CreatedAt)
		}
		f.TimesPerWeek, f.Weekdays = 0, 0
		f.WeekInterval, f.WeekOfMonth = 0, 0
	}
	return nil
}

// ValidateEntryValue bounds a single day's value.
//
// A day is held to the same per-kind ceiling as a target: the client already
// stops a tap there, but the API is reachable without it, and an unbounded
// value would overflow the sum in Stats.Total long before it meant anything.
func ValidateEntryValue(k Kind, value int) error {
	if !k.Valid() {
		return invalid(`unknown habit kind "{kind}"`, "kind", k)
	}
	if value < 0 {
		return invalid("value must not be negative")
	}
	if value > k.MaxTarget() {
		return tooLarge("value", k)
	}
	return nil
}

// Target is the value that counts as done for a single day.
func (h Habit) Target() int {
	if h.Kind == KindCheck {
		return 1
	}
	if h.TargetValue < 1 {
		return 1
	}
	return h.TargetValue
}

// IsComplete reports whether a day's value reaches the habit's target.
func (h Habit) IsComplete(value int) bool { return value >= h.Target() }

// IsScheduled reports whether the habit is due on d.
//
// FreqTimesPerWeek has no fixed days by design: any day of the week is a valid
// opportunity, and whether the week was met is a question for the weekly stats
// rather than for a single day.
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
		anchor := h.Frequency.AnchorDate
		if anchor.IsZero() {
			anchor = DateFromTime(h.CreatedAt)
		}
		diff := d.DaysSince(anchor)
		if diff < 0 {
			return false
		}
		return diff%n == 0
	}
	return false
}

// inScheduledWeek reports whether d, already on one of the chosen weekdays,
// also falls in a week the schedule asks for: every n-th week from the anchor,
// or the n-th occurrence of that weekday in its month.
func (h Habit) inScheduledWeek(d Date) bool {
	f := h.Frequency
	if f.WeekOfMonth == LastWeekOfMonth {
		return d.AddDays(7).Month != d.Month
	}
	if f.WeekOfMonth > 0 {
		return (d.Day-1)/7+1 == f.WeekOfMonth
	}
	if f.WeekInterval > 1 {
		anchor := f.AnchorDate
		if anchor.IsZero() {
			anchor = DateFromTime(h.CreatedAt)
		}
		if d.Before(anchor) {
			return false
		}
		weeks := d.StartOfWeek().DaysSince(anchor.StartOfWeek()) / 7
		return weeks%f.WeekInterval == 0
	}
	return true
}

// AcceptsEntry reports whether a value may be recorded on d.
//
// Frequencies with fixed days — chosen weekdays and a custom interval — close all
// other days: the days are the whole point of those frequencies, so a tick in
// between is a mistake. Daily and times-per-week stay open on every day, since
// any day counts for them anyway.
func (h Habit) AcceptsEntry(d Date) bool {
	switch h.Frequency.Kind {
	case FreqWeekdays, FreqCustomInterval:
		return h.IsScheduled(d)
	}
	return true
}

func (h Habit) IsArchived() bool { return h.ArchivedAt != nil }

// DefaultColors is the palette offered in the editor, kept in the domain so the
// server can validate against the same list the client renders.
var DefaultColors = []string{
	"#dc2626", "#ea580c", "#eab308", "#65a30d",
	"#16a34a", "#0d9488", "#0284c7", "#2563eb",
	"#4f46e5", "#7c3aed", "#db2777", "#64748b",
}

// HabitIcons are the icons a habit may wear, in the order the editor offers
// them. Only the names live here; the drawings are the client's. Kept on the
// server for the same reason as the palette: a name outside this list would be
// stored and then drawn as nothing at all.
var HabitIcons = []string{
	"droplet", "apple", "utensils", "coffee", "pill", "heart", "dumbbell", "bike",
	"mountain", "flame", "bed", "moon", "sun", "book", "pencil", "lightbulb",
	"code", "globe", "music", "palette", "camera", "leaf", "home", "wallet",
	"users", "smartphone", "ban", "smile", "star", "target", "clock", "check",
}

// ValidIcon reports whether name is one of HabitIcons.
func ValidIcon(name string) bool {
	for _, known := range HabitIcons {
		if name == known {
			return true
		}
	}
	return false
}
