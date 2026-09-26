package domain

import (
	"errors"
	"fmt"
	"testing"
)

func TestProblemFillsItsTemplate(t *testing.T) {
	err := Invalid("name is longer than {max} characters", "max", 80)
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
	if got, want := err.Error(), "validation error: name is longer than 80 characters"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

// A placeholder nobody filled is left in the sentence rather than dropped,
// so a mismatch between template and params shows instead of reading as a
// sentence with a hole in it.
func TestProblemKeepsAnUnfilledPlaceholder(t *testing.T) {
	err := Invalid("between {min} and {max}", "max", 7)
	if got, want := err.(*Problem).Message(), "between {min} and 7"; got != want {
		t.Errorf("Message() = %q, want %q", got, want)
	}
}

// The HTTP layer tells the client's mistakes from its own faults by
// ErrValidation, through any amount of wrapping.
func TestProblemIsAValidationError(t *testing.T) {
	err := fmt.Errorf("saving habit: %w", Invalid("name must not be empty"))
	if !errors.Is(err, ErrValidation) {
		t.Error("a wrapped Problem is not an ErrValidation")
	}
	var p *Problem
	if !errors.As(err, &p) || p.Template != "name must not be empty" {
		t.Errorf("the Problem is not found through the wrapping: %v", p)
	}
}

// Each kind states its own ceiling in the unit its values are typed in, and
// the template says which, so the translation can say it too.
func TestTooLargeNamesTheUnit(t *testing.T) {
	for _, tc := range []struct {
		kind     Kind
		template string
		message  string
	}{
		{KindCount, "value may be at most {max}", "value may be at most 1000"},
		{KindTime, "value may be at most {max} minutes", "value may be at most 1440 minutes"},
		{KindDistance, "value may be at most {max} kilometres", "value may be at most 200 kilometres"},
	} {
		p := tooLarge("value", tc.kind).(*Problem)
		if p.Template != tc.template {
			t.Errorf("%s: Template = %q, want %q", tc.kind, p.Template, tc.template)
		}
		if got := p.Message(); got != tc.message {
			t.Errorf("%s: Message() = %q, want %q", tc.kind, got, tc.message)
		}
	}
}
