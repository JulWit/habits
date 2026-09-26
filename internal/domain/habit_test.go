package domain

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func baseHabit() Habit {
	return Habit{
		Name:        "Reading",
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
		{"empty name", func(h *Habit) { h.Name = "   " }},
		{"name too long", func(h *Habit) { h.Name = strings.Repeat("a", MaxNameLen+1) }},
		{"unit too long", func(h *Habit) {
			h.Kind = KindCount
			h.TargetValue = 10
			h.Unit = strings.Repeat("a", MaxUnitLen+1)
		}},
		{"broken colour", func(h *Habit) { h.Color = "not-a-colour" }},
		{"unknown kind", func(h *Habit) { h.Kind = Kind("gewicht") }},
		{"unknown frequency", func(h *Habit) { h.Frequency.Kind = FrequencyKind("monatlich") }},
		{"target above the maximum", func(h *Habit) {
			h.Kind = KindTime
			h.TargetValue = KindTime.MaxTarget() + 1
		}},
		{"target below 1", func(h *Habit) { h.Kind = KindCount; h.TargetValue = 0 }},
		{"no weekday selected", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 0}
		}},
		{"weekday mask too large", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqWeekdays, Weekdays: 0b10000000}
		}},
		{"interval 0", func(h *Habit) {
			h.Frequency = Frequency{Kind: FreqEveryNDays, IntervalDays: 0}
		}},
		{"interval over a year", func(h *Habit) {
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
				t.Fatal("Validate accepted an invalid habit")
			}
			if !errors.Is(err, ErrValidation) {
				t.Errorf("error is not ErrValidation: %v", err)
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
		t.Errorf("step too large: %v, want ErrValidation", err)
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
		{"Mon and Fri", Frequency{Kind: FreqWeekdays, Weekdays: 1<<0 | 1<<4},
			map[int]bool{0: true, 1: false, 4: true, 6: false}},
		{"Sunday only", Frequency{Kind: FreqWeekdays, Weekdays: 1 << 6},
			map[int]bool{0: false, 6: true}},
		{"every 3 days from Monday", Frequency{Kind: FreqEveryNDays, IntervalDays: 3, AnchorDate: mon},
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
		t.Error("a day before the anchor must not be due")
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
			t.Errorf("ValidateEntryValue(%q, %d): not ErrValidation: %v", tc.kind, tc.value, err)
		}
	}
}

// The descriptors the client is sent have to agree with the methods the server
// validates against — that is the whole point of sending them.
func TestKindDescriptorsMatchTheKindMethods(t *testing.T) {
	got := KindDescriptors()
	if len(got) != len(AllKinds) {
		t.Fatalf("%d descriptors for %d kinds", len(got), len(AllKinds))
	}
	for _, k := range AllKinds {
		info, ok := got[k]
		if !ok {
			t.Errorf("no descriptor for %q", k)
			continue
		}
		if info.Scale != k.Scale() || info.Step != k.Step() ||
			info.Max != k.MaxTarget() || info.Unit != k.Unit() {
			t.Errorf("%q: %+v differs from the methods", k, info)
		}
	}
}

func TestAllKindsAreValidAndNothingElseIs(t *testing.T) {
	for _, k := range AllKinds {
		if !k.Valid() {
			t.Errorf("%q is in AllKinds but is not Valid()", k)
		}
	}
	if Kind("gewicht").Valid() {
		t.Error("an unknown kind must not be Valid()")
	}
}

func TestValidateIcon(t *testing.T) {
	h := baseHabit()
	h.Icon = " droplet "
	if err := h.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if h.Icon != "droplet" {
		t.Errorf("icon = %q, want trimmed", h.Icon)
	}

	h.Icon = ""
	if err := h.Validate(); err != nil {
		t.Errorf("no icon rejected: %v", err)
	}

	h.Icon = "<svg>"
	if err := h.Validate(); !errors.Is(err, ErrValidation) {
		t.Errorf("unknown icon: err = %v, want ErrValidation", err)
	}
}
