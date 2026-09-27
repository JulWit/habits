package domain

import (
	"errors"
	"fmt"
	"testing"
)

func TestProblemFillsItsTemplate(t *testing.T) {
	err := Invalid("name_too_long", "name is longer than {max} characters", "max", 80)
	var p *Problem
	if !errors.As(err, &p) {
		t.Fatalf("Invalid returned %T, want *Problem", err)
	}
	if got, want := p.Message(), "name is longer than 80 characters"; got != want {
		t.Errorf("Message() = %q, want %q", got, want)
	}
	if p.Template != "name is longer than {max} characters" {
		t.Errorf("Template = %q", p.Template)
	}
	if p.Code != "name_too_long" {
		t.Errorf("Code = %q", p.Code)
	}
	if got, want := err.Error(), "validation error: name is longer than 80 characters"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

// Placeholders without a value are kept in the message.
func TestProblemKeepsAnUnfilledPlaceholder(t *testing.T) {
	err := Invalid("range", "between {min} and {max}", "max", 7)
	if got, want := err.(*Problem).Message(), "between {min} and 7"; got != want {
		t.Errorf("Message() = %q, want %q", got, want)
	}
}

// A wrapped Problem matches ErrValidation.
func TestProblemIsAValidationError(t *testing.T) {
	err := fmt.Errorf("saving habit: %w", Invalid("name_empty", "name must not be empty"))
	if !errors.Is(err, ErrValidation) {
		t.Error("a wrapped Problem is not an ErrValidation")
	}
	var p *Problem
	if !errors.As(err, &p) || p.Template != "name must not be empty" {
		t.Errorf("the Problem is not found through the wrapping: %v", p)
	}
}

// Errors for too large values name the unit of the kind.
func TestTooLargeNamesTheUnit(t *testing.T) {
	for _, tc := range []struct {
		kind     Kind
		code     string
		template string
		message  string
	}{
		{KindCount, "value_too_large", "value may be at most {max}", "value may be at most 1000"},
		{KindTime, "value_too_large_minutes", "value may be at most {max} minutes", "value may be at most 1440 minutes"},
		{KindDistance, "value_too_large_km", "value may be at most {max} kilometres", "value may be at most 200 kilometres"},
	} {
		p := tooLarge("value", tc.kind).(*Problem)
		if p.Code != tc.code {
			t.Errorf("%s: Code = %q, want %q", tc.kind, p.Code, tc.code)
		}
		if p.Template != tc.template {
			t.Errorf("%s: Template = %q, want %q", tc.kind, p.Template, tc.template)
		}
		if got := p.Message(); got != tc.message {
			t.Errorf("%s: Message() = %q, want %q", tc.kind, got, tc.message)
		}
	}
}
