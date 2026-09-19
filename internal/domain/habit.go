package domain

import (
	"errors"
	"fmt"
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
// writes it into messages the user reads, and "distance" in a German sentence
// about a German radio button labelled "Distanz" is a seam showing through.
func (k Kind) Label() string {
	switch k {
	case KindCheck:
		return "Haken"
	case KindCount:
		return "Anzahl"
	case KindTime:
		return "Zeit"
	case KindDistance:
		return "Distanz"
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
	FreqDaily        FrequencyKind = "daily"
	FreqTimesPerWeek FrequencyKind = "times_per_week"
	FreqWeekdays     FrequencyKind = "weekdays"
	FreqEveryNDays   FrequencyKind = "every_n_days"
)

func (f FrequencyKind) Valid() bool {
	switch f {
	case FreqDaily, FreqTimesPerWeek, FreqWeekdays, FreqEveryNDays:
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
	// AnchorDate is the first due day of an every-n-days schedule. Without it
	// the phase of the interval would silently shift whenever the habit is
	// edited.
	AnchorDate Date `json:"anchorDate"`
}

// Habit is a tracked habit belonging to exactly one user.
type Habit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Kind  Kind   `json:"kind"`
	// CategoryID is empty when the habit belongs to no category. It may also
	// point at a soft-deleted category, in which case the habit shows up as
	// uncategorised until that category is restored.
	CategoryID  string `json:"categoryId"`
	TargetValue int    `json:"targetValue"`
	// StepValue is how much one tap, or one press of + or -, adds. It starts at
	// the kind's natural step and only a count lets the user change it: "one
	// glass" is the obvious increment for water, "ten" is for push-ups.
	StepValue  int        `json:"stepValue"`
	Unit       string     `json:"unit"`
	Frequency  Frequency  `json:"frequency"`
	Position   int        `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

var (
	ErrValidation = errors.New("validierungsfehler")
	colorPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

const (
	MaxNameLen = 80
	MaxUnitLen = 16
)

// The bounds messages are phrased per kind, so the reader is told about
// minutes or metres rather than about an abstract "Zielwert".
func minTargetMessage(k Kind) string {
	switch k {
	case KindTime:
		return "Zeit muss mindestens 0,1 Minuten sein"
	case KindDistance:
		return "Distanz muss mindestens 1 Meter sein"
	}
	return "Zielwert muss mindestens 0,1 sein"
}

// limitText spells a kind s ceiling the way the reader wrote it: the stored
// number divided back down, with the unit it is entered in.
func limitText(k Kind) string {
	switch k {
	case KindTime:
		return fmt.Sprintf("%d Minuten", k.MaxTarget()/k.Scale())
	case KindDistance:
		return fmt.Sprintf("%d Kilometer", k.MaxTarget()/k.Scale())
	}
	return fmt.Sprintf("%d", k.MaxTarget()/k.Scale())
}

func maxTargetMessage(k Kind) string {
	switch k {
	case KindTime:
		return "Zeit darf höchstens " + limitText(k) + " sein"
	case KindDistance:
		return "Distanz darf höchstens " + limitText(k) + " sein"
	}
	return "Zielwert darf höchstens " + limitText(k) + " sein"
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrValidation, fmt.Sprintf(format, args...))
}

// Validate normalises the habit in place and reports why it is unacceptable.
// Normalising here rather than in the HTTP layer means the invariants hold for
// every future entry point, including imports and CLI tooling.
func (h *Habit) Validate() error {
	h.Name = strings.TrimSpace(h.Name)
	h.Unit = strings.TrimSpace(h.Unit)

	if h.Name == "" {
		return invalid("Name darf nicht leer sein")
	}
	if len([]rune(h.Name)) > MaxNameLen {
		return invalid("Name ist länger als %d Zeichen", MaxNameLen)
	}
	if len([]rune(h.Unit)) > MaxUnitLen {
		return invalid("Einheit ist länger als %d Zeichen", MaxUnitLen)
	}
	if h.Color == "" {
		h.Color = DefaultColors[0]
	}
	if !colorPattern.MatchString(h.Color) {
		return invalid("Farbe muss ein Hex-Wert wie #4caf50 sein")
	}
	h.Color = strings.ToLower(h.Color)

	if !h.Kind.Valid() {
		return invalid("unbekannter Habit-Typ %q", h.Kind)
	}
	if h.Kind == KindCheck {
		// A tick is done or it is not; there is nothing to configure.
		h.TargetValue = 1
	} else if h.TargetValue < 1 {
		return invalid("%s", minTargetMessage(h.Kind))
	}
	if h.TargetValue > h.Kind.MaxTarget() {
		return invalid("%s", maxTargetMessage(h.Kind))
	}
	// A tick has nothing to count, so its step stays one whatever a client
	// sends. The counting kinds start at the step of their unit and may be set
	// to anything up to their own maximum.
	if h.Kind == KindCheck {
		h.StepValue = 1
	} else if h.StepValue < 1 {
		h.StepValue = h.Kind.Step()
	} else if h.StepValue > h.Kind.MaxTarget() {
		return invalid("Schrittweite darf höchstens %s betragen", limitText(h.Kind))
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
		return invalid("unbekannte Frequenz %q", f.Kind)
	}
	switch f.Kind {
	case FreqDaily:
		f.TimesPerWeek, f.Weekdays, f.IntervalDays, f.AnchorDate = 0, 0, 0, Date{}
	case FreqTimesPerWeek:
		if f.TimesPerWeek < 1 || f.TimesPerWeek > 7 {
			return invalid("Anzahl pro Woche muss zwischen 1 und 7 liegen")
		}
		f.Weekdays, f.IntervalDays, f.AnchorDate = 0, 0, Date{}
	case FreqWeekdays:
		if f.Weekdays == 0 {
			return invalid("mindestens ein Wochentag muss gewählt sein")
		}
		if f.Weekdays > 0b1111111 {
			return invalid("ungültige Wochentagsauswahl")
		}
		f.TimesPerWeek, f.IntervalDays, f.AnchorDate = 0, 0, Date{}
	case FreqEveryNDays:
		if f.IntervalDays < 1 || f.IntervalDays > 365 {
			return invalid("Intervall muss zwischen 1 und 365 Tagen liegen")
		}
		if f.AnchorDate.IsZero() {
			f.AnchorDate = DateFromTime(h.CreatedAt)
		}
		f.TimesPerWeek, f.Weekdays = 0, 0
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
		return invalid("unbekannter Habit-Typ %q", k)
	}
	if value < 0 {
		return invalid("Wert darf nicht negativ sein")
	}
	if value > k.MaxTarget() {
		return invalid("Wert darf höchstens %s betragen", limitText(k))
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
		return h.Frequency.Weekdays.Has(d.Weekday())
	case FreqEveryNDays:
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

func (h Habit) IsArchived() bool { return h.ArchivedAt != nil }

// DefaultColors is the palette offered in the editor, kept in the domain so the
// server can validate against the same list the client renders.
var DefaultColors = []string{
	"#dc2626", "#ea580c", "#eab308", "#65a30d",
	"#16a34a", "#0d9488", "#0284c7", "#2563eb",
	"#4f46e5", "#7c3aed", "#db2777", "#64748b",
}
