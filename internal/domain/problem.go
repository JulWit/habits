package domain

import (
	"fmt"
	"regexp"
)

// Problem is a validation error with a user-facing message.
//
// Template is the English message with {name} placeholders; Params holds their
// values. Both are sent to the client separately so that it can translate the
// template (see web/assets/js/i18n.js).
type Problem struct {
	Template string
	Params   map[string]any
}

var placeholder = regexp.MustCompile(`\{\w+\}`)

// Invalid returns a Problem. params holds alternating names and values:
//
//	Invalid("name is longer than {max} characters", "max", MaxNameLen)
func Invalid(template string, params ...any) error {
	p := &Problem{Template: template}
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

func (p *Problem) Error() string { return ErrValidation.Error() + ": " + p.Message() }

// Is reports whether target is ErrValidation.
func (p *Problem) Is(target error) bool { return target == ErrValidation }
