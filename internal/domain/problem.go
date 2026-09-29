package domain

import (
	"fmt"
	"regexp"
)

// Problem is a validation error with a user-facing message.
//
// Code identifies the problem and stays stable when the wording changes; the
// client translates by it (see web/assets/js/i18n.js). Template is the English
// message with {name} placeholders and Params holds their values, which the
// client fills into its translation.
type Problem struct {
	Code     string
	Template string
	Params   map[string]any
}

var placeholder = regexp.MustCompile(`\{\w+\}`)

// Invalid returns a Problem. params holds alternating names and values:
//
//	Invalid("name_too_long", "name is longer than {max} characters", "max", MaxNameLen)
func Invalid(code, template string, params ...any) error {
	p := &Problem{Code: code, Template: template}
	if len(params) > 0 {
		p.Params = make(map[string]any, len(params)/2)
		for i := 0; i+1 < len(params); i += 2 {
			p.Params[params[i].(string)] = params[i+1]
		}
	}
	return p
}

// Message returns the English message with the placeholders filled in.
// Placeholders without a value are kept as is.
func (p *Problem) Message() string {
	return placeholder.ReplaceAllStringFunc(p.Template, func(m string) string {
		if v, ok := p.Params[m[1:len(m)-1]]; ok {
			return fmt.Sprint(v)
		}
		return m
	})
}

// Error returns the English message, marked as a validation error.
func (p *Problem) Error() string { return ErrValidation.Error() + ": " + p.Message() }

// Is reports whether target is ErrValidation.
func (p *Problem) Is(target error) bool { return target == ErrValidation }
