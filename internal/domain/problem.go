package domain

import (
	"fmt"
	"regexp"
)

// Problem is a validation failure worded for the person who caused it.
//
// Template is the English sentence with {name} placeholders, and Params fills
// them. The two travel to the client apart, because the interface translates
// by the English text (web/assets/js/i18n.js): "name is longer than 80
// characters" is no key a dictionary could hold, the template it was filled
// from is.
type Problem struct {
	Template string
	Params   map[string]any
}

var placeholder = regexp.MustCompile(`\{\w+\}`)

// Invalid reports a validation failure. params alternates names and values:
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

// Message is the sentence in English, placeholders filled. One without a
// value stays as written rather than vanishing from the sentence.
func (p *Problem) Message() string {
	return placeholder.ReplaceAllStringFunc(p.Template, func(m string) string {
		if v, ok := p.Params[m[1:len(m)-1]]; ok {
			return fmt.Sprint(v)
		}
		return m
	})
}

func (p *Problem) Error() string { return ErrValidation.Error() + ": " + p.Message() }

// Is makes every Problem an ErrValidation, which is how the layers above tell
// the client's mistakes from their own.
func (p *Problem) Is(target error) bool { return target == ErrValidation }
