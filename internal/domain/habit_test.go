package domain

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func baseHabit() Habit {
	return Habit{
		Name:        "Lesen",
		Color:       "#16a34a",
		Kind:        KindCheck,
		TargetValue: 1,
		CreatedAt:   time.Date(2026, 9, 14, 8, 0, 0, 0, time.UTC), // a Monday
		Frequency:   Frequency{Kind: FreqDaily},
	}
}

func TestValidateNormalises(t *testing.T) {
	h := baseHabit()
	h.Name = "  Lesen  "
	h.Color = "#16A34A"
	h.Unit = "  Seiten  "

	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.Name != "Lesen" {
		t.Errorf("name = %q, want trimmed", h.Name)
	}
	if h.Color != "#16a34a" {
		t.Errorf("color = %q, want lower-cased", h.Color)
	}
	// A tick owns neither a unit nor a step.
	if h.Unit != "" {
		t.Errorf("unit = %q, want empty for a check", h.Unit)
	}
	if h.StepValue != 1 || h.TargetValue != 1 {
		t.Errorf("step/target = %d/%d, want 1/1", h.StepValue, h.TargetValue)
	}
}

func TestValidateRejects(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Habit)
	}{
		{"leerer Name", func(h *Habit) { h.Name = "   " }},
		{"zu langer Name", func(h *Habit) { h.Name = strings.Repeat("a", MaxNameLen+1) }},
		{"zu lange Einheit", func(h *Habit) {
			h.Kind = KindCount
			h.TargetValue = 10
			h.Unit = strings.Repeat("a", MaxUnitLen+1)
		}},
		{"kaputte Farbe", func(h *Habit) { h.Color = "grün" }},
		{"unbekannter Typ", func(h *Habit) { h.Kind = Kind("gewicht") }},
		{"unbekannte Frequenz", func(h *Habit) { h.Frequency.Kind = FrequencyKind("monatlich") }},
		{"Ziel über dem Maximum", func(h *Habit) {
			h.Kind = KindTime
			h.TargetValue = KindTime.MaxTarget() + 1
		}},
		{"Ziel unter 1", func(h *Habit) { h.Kind = KindCount; h.TargetValue = 0 }},
		{"kein Wochentag gewählt", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 0}
		}},
		{"Wochentagsmaske zu groß", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 0b10000000}
		}},
		{"Intervall 0", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqEveryNDays, IntervalDays: 0}
		}},
		{"Intervall über einem Jahr", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqEveryNDays, IntervalDays: 366}
		}},
		{"times per week 0", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 0}
		}},
		{"times per week 8", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 8}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := baseHabit()
			tc.mutate(&h)
			err := h.Validate()
			if err == nil {
				t.Fatal("Validate akzeptierte einen ungültigen Habit")
			}
			if !errors.Is(err, ErrValidation) {
				t.Errorf("Fehler ist kein ErrValidation: %v", err)
			}
		})
	}
}

// Fields belonging to another frequency are zeroed, so two habits with the same
// effective schedule compare equal.
func TestValidateClearsForeignFrequencyFields(t *testing.T) {
	h := baseHabit()
	h.Frequency = Frequency{
		Kind: FreqDaily, TimesPerWeek: 3, Weekdays: 0b0000101,
		IntervalDays: 9, AnchorDate: Date{2026, time.January, 1},
	}
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.Frequency != (Frequency{Kind: FreqDaily}) {
		t.Errorf("frequency = %+v, want only the kind", h.Frequency)
	}
}

// An every-n-days habit without an anchor gets its creation day, so editing it
// later cannot shift the phase of the interval.
func TestValidateAnchorsEveryNDays(t *testing.T) {
	h := baseHabit()
	h.Frequency = Frequency{Kind: FreqEveryNDays, IntervalDays: 3}
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if want := DateFromTime(h.CreatedAt); h.Frequency.AnchorDate != want {
		t.Errorf("anchor = %v, want %v", h.Frequency.AnchorDate, want)
	}
}

// A step below one falls back to the kind's own; above the ceiling it is a
// rejection, not a clamp.
func TestValidateStepValue(t *testing.T) {
	h := baseHabit()
	h.Kind = KindTime
	h.TargetValue = 200
	h.StepValue = 0
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.StepValue != KindTime.Step() {
		t.Errorf("step = %d, want the kind's own %d", h.StepValue, KindTime.Step())
	}

	h.StepValue = KindTime.MaxTarget() + 1
	if err := h.Validate(); !errors.Is(err, ErrValidation) {
		t.Errorf("zu große Schrittweite: %v, want ErrValidation", err)
	}
}

func TestIsScheduled(t *testing.T) {
	mon := Date{2026, time.September, 14}
	for _, tc := range []struct {
		name string
		freq Frequency
		want map[int]bool // offset from Monday -> due
	}{
		{"daily", Frequency{Kind: FreqDaily},
			map[int]bool{0: true, 3: true, 6: true}},
		{"times per week is every day an opportunity", Frequency{Kind: FreqTimesPerWeek, TimesPerWeek: 3},
			map[int]bool{0: true, 3: true, 6: true}},
		{"Mo und Fr", Frequency{Kind: FreqWeekdays, Weekdays: 1<<0 | 1<<4},
			map[int]bool{0: true, 1: false, 4: true, 6: false}},
		{"nur Sonntag", Frequency{Kind: FreqWeekdays, Weekdays: 1 << 6},
			map[int]bool{0: false, 6: true}},
		{"alle 3 Tage ab Montag", Frequency{Kind: FreqEveryNDays, IntervalDays: 3, AnchorDate: mon},
			map[int]bool{0: true, 1: false, 2: false, 3: true, 6: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := baseHabit()
			h.Frequency = tc.freq
			for offset, want := range tc.want {
				d := mon.AddDays(offset)
				if got := h.IsScheduled(d); got != want {
					t.Errorf("%v (%v): scheduled = %v, want %v", d, d.Weekday(), got, want)
				}
			}
		})
	}
}

// Days before the anchor are not due: the schedule starts, it does not extend
// backwards.
func TestEveryNDaysIsNotDueBeforeItsAnchor(t *testing.T) {
	anchor := Date{2026, time.September, 14}
	h := baseHabit()
	h.Frequency = Frequency{Kind: FreqEveryNDays, IntervalDays: 3, AnchorDate: anchor}
	if h.IsScheduled(anchor.AddDays(-3)) {
		t.Error("ein Tag vor dem Anker darf nicht fällig sein")
	}
}

func TestValidateEntryValue(t *testing.T) {
	for _, tc := range []struct {
		kind    Kind
		value   int
		wantErr bool
	}{
		{KindCheck, 0, false},
		{KindCheck, 1, false},
		{KindCheck, 2, true},
		{KindCount, 10000, false},
		{KindCount, 10001, true},
		{KindTime, 14400, false},
		{KindTime, 14401, true},
		{KindDistance, 200000, false},
		{KindDistance, 200001, true},
		{KindDistance, -1, true},
		{Kind("gewicht"), 1, true},
	} {
		err := ValidateEntryValue(tc.kind, tc.value)
		if (err != nil) != tc.wantErr {
			t.Errorf("ValidateEntryValue(%q, %d) = %v, wantErr %v",
				tc.kind, tc.value, err, tc.wantErr)
		}
		if err != nil && !errors.Is(err, ErrValidation) {
			t.Errorf("ValidateEntryValue(%q, %d): kein ErrValidation: %v", tc.kind, tc.value, err)
		}
	}
}

// The descriptors the client is sent have to agree with the methods the server
// validates against — that is the whole point of sending them.
func TestKindDescriptorsMatchTheKindMethods(t *testing.T) {
	got := KindDescriptors()
	if len(got) != len(AllKinds) {
		t.Fatalf("%d Deskriptoren für %d Typen", len(got), len(AllKinds))
	}
	for _, k := range AllKinds {
		info, ok := got[k]
		if !ok {
			t.Errorf("kein Deskriptor für %q", k)
			continue
		}
		if info.Scale != k.Scale() || info.Step != k.Step() ||
			info.Max != k.MaxTarget() || info.Unit != k.Unit() {
			t.Errorf("%q: %+v weicht von den Methoden ab", k, info)
		}
	}
}

func TestAllKindsAreValidAndNothingElseIs(t *testing.T) {
	for _, k := range AllKinds {
		if !k.Valid() {
			t.Errorf("%q steht in AllKinds, ist aber nicht Valid()", k)
		}
	}
	if Kind("gewicht").Valid() {
		t.Error("ein unbekannter Typ darf nicht Valid() sein")
	}
}
