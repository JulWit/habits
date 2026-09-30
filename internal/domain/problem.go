package domain

import (
	"errors"
	"fmt"
	"regexp"
)

// ErrValidation is matched by every validation error (see Problem).
var ErrValidation = errors.New("validation error")

// Problem is a validation error with a user-facing message.
//
// Code identifies the problem and stays stable when the wording changes; the
// client translates by it (see web/assets/js/util/i18n.js). Template is the English
// message with {name} placeholders and Params holds their values, which the
// client fills into its translation.
type Problem struct {
	Code     string
	Template string
	Params   map[string]any
}

var placeholder = regexp.MustCompile(`\{\w+\}`)

// Invalid returns a Problem. params holds alternating names and values, as
// for NamedParams:
//
//	Invalid("name_too_long", "name is longer than {max} characters", "max", MaxNameLen)
func Invalid(code, template string, params ...any) error {
	return &Problem{Code: code, Template: template, Params: NamedParams(params...)}
}

// NamedParams returns the values of a message's placeholders by name, from
// alternating names and values. It never returns nil. It panics if a name is
// not a string or a name has no value, as both are mistakes of the caller.
func NamedParams(params ...any) map[string]any {
	if len(params)%2 != 0 {
		panic(fmt.Sprintf("domain: odd number of params: %v", params))
	}
	named := make(map[string]any, len(params)/2)
	for i := 0; i < len(params); i += 2 {
		name, ok := params[i].(string)
		if !ok {
			panic(fmt.Sprintf("domain: param name %v is not a string", params[i]))
		}
		named[name] = params[i+1]
	}
	return named
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
