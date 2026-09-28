package settings

import (
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// The defaults are valid.
func TestDefaultIsValid(t *testing.T) {
	if err := Default().Validate(); err != nil {
		t.Errorf("Default: %v", err)
	}
}

// Every rule rejects an invalid value as a validation error.
func TestValidateRejectsInvalidValues(t *testing.T) {
	for name, change := range map[string]func(*Settings){
		"theme":             func(s *Settings) { s.Theme = "neon" },
		"font":              func(s *Settings) { s.Font = "lato" },
		"density":           func(s *Settings) { s.Density = "cramped" },
		"reorder mode":      func(s *Settings) { s.ReorderMode = "swipe" },
		"pattern":           func(s *Settings) { s.Pattern = "image" },
		"language":          func(s *Settings) { s.Language = "fr" },
		"rate window":       func(s *Settings) { s.RateWindow = "14" },
		"overview days":     func(s *Settings) { s.OverviewDays = 2 },
		"too many days":     func(s *Settings) { s.OverviewDays = MaxOverviewDays + 1 },
		"band colour":       func(s *Settings) { s.BandColor = "#fff" },
		"band opacity":      func(s *Settings) { s.BandOpacity = 101 },
		"band fill opacity": func(s *Settings) { s.BandFillOpacity = -1 },
		"local time zone":   func(s *Settings) { s.TimeZone = "Local" },
		"unknown time zone": func(s *Settings) { s.TimeZone = "Europe/Nowhere" },
		"path as zone":      func(s *Settings) { s.TimeZone = "../../etc/passwd" },
	} {
		s := Default()
		change(&s)
		if err := s.Validate(); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v, want a validation error", name, err)
		}
	}
}

// Valid values of every kind are accepted.
func TestValidateAcceptsValidValues(t *testing.T) {
	s := Default()
	s.Theme = "dark"
	s.Language = "de"
	s.RateWindow = "all"
	s.OverviewDays = 21
	s.BandColor = "teal"
	s.BandOpacity = 0
	s.TimeZone = "Europe/Berlin"
	if err := s.Validate(); err != nil {
		t.Errorf("Validate: %v", err)
	}
}

// Repair resets invalid values to their defaults and keeps valid ones.
func TestRepair(t *testing.T) {
	s := Default()
	s.Theme = "dark"
	s.Font = "lato"
	s.BandOpacity = 500
	s.Repair()
	want := Default()
	want.Theme = "dark"
	if s != want {
		t.Errorf("got  %+v\nwant %+v", s, want)
	}
}

// The rate window is a number of days, or 0 for the whole history.
func TestRateWindowDays(t *testing.T) {
	for window, want := range map[string]int{"7": 7, "365": 365, "all": 0, "": domain.DefaultRateWindowDays} {
		if got := (Settings{RateWindow: window}).RateWindowDays(); got != want {
			t.Errorf("RateWindowDays(%q) = %d, want %d", window, got, want)
		}
	}
}
