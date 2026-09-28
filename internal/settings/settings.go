// Package settings defines the preferences of a user, their defaults and
// their rules. The store keeps them as one JSON document, so a new setting
// needs no migration: add a field to Settings, its default to Default and its
// rule to rules.
package settings

import (
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are the preferences of a user.
type Settings struct {
	Theme string `json:"theme"`
	// OverviewDays is the number of day columns on the overview; 0 shows as
	// many as fit.
	OverviewDays int `json:"overviewDays"`
	// ShowArchived shows archived habits on the overview.
	ShowArchived bool   `json:"showArchived"`
	Font         string `json:"font"`
	Density      string `json:"density"`
	ReorderMode  string `json:"reorderMode"`
	Pattern      string `json:"pattern"`
	// AlignWeeks starts the overview on a Monday instead of ending it today.
	AlignWeeks bool `json:"alignWeeks"`
	// BandColor is the colour of the today highlight: NeutralBand or one of
	// domain.Colors.
	BandColor string `json:"bandColor"`
	// BandOpacity is the opacity of the today highlight in the header, in
	// percent.
	BandOpacity int `json:"bandOpacity"`
	// BandFillOpacity is the opacity of the today band in the cards, in
	// percent.
	BandFillOpacity int `json:"bandFillOpacity"`
	// ShowBand shows the today band in the cards.
	ShowBand bool   `json:"showBand"`
	Language string `json:"language"`
	// TimeZone is an IANA time zone name, or "" for the server's HABITS_TZ.
	TimeZone string `json:"timeZone"`
	// RateWindow is the number of days the completion rate covers, or "all"
	// for the whole history; see RateWindowDays.
	RateWindow string `json:"rateWindow"`
}

// Default returns the settings of a user who has not saved any.
func Default() Settings {
	return Settings{
		Theme:           "system",
		Font:            "inter",
		Density:         "standard",
		ReorderMode:     "drag",
		Pattern:         "none",
		BandColor:       NeutralBand,
		BandOpacity:     100,
		BandFillOpacity: 30,
		ShowBand:        true,
		Language:        "system",
		RateWindow:      "30",
	}
}

// rule checks one setting. Settings without a rule (the switches) accept any
// value.
type rule struct {
	check func(Settings) error
	// reset sets the setting to its value in defaults.
	reset func(s *Settings, defaults Settings)
}

// field returns the rule of the setting get points to, which check checks.
func field[T any](get func(*Settings) *T, check func(T) error) rule {
	return rule{
		check: func(s Settings) error { return check(*get(&s)) },
		reset: func(s *Settings, defaults Settings) { *get(s) = *get(&defaults) },
	}
}

// rules holds the rule of every setting that has one.
var rules = []rule{
	field(func(s *Settings) *string { return &s.Theme }, option("theme")),
	field(func(s *Settings) *string { return &s.Font }, option("font")),
	field(func(s *Settings) *string { return &s.Density }, option("density")),
	field(func(s *Settings) *string { return &s.ReorderMode }, option("reorderMode")),
	field(func(s *Settings) *string { return &s.Pattern }, option("pattern")),
	field(func(s *Settings) *string { return &s.Language }, option("language")),
	field(func(s *Settings) *string { return &s.RateWindow }, option("rateWindow")),
	field(func(s *Settings) *int { return &s.OverviewDays }, checkOverviewDays),
	field(func(s *Settings) *string { return &s.BandColor }, checkBandColor),
	field(func(s *Settings) *int { return &s.BandOpacity }, percent("bandOpacity")),
	field(func(s *Settings) *int { return &s.BandFillOpacity }, percent("bandFillOpacity")),
	field(func(s *Settings) *string { return &s.TimeZone }, checkTimeZone),
}

// Validate returns a validation error for the first invalid setting.
func (s Settings) Validate() error {
	for _, r := range rules {
		if err := r.check(s); err != nil {
			return err
		}
	}
	return nil
}

// Repair replaces invalid values, e.g. of options removed since they were
// saved, by their defaults.
func (s *Settings) Repair() {
	defaults := Default()
	for _, r := range rules {
		if r.check(*s) != nil {
			r.reset(s, defaults)
		}
	}
}

// Option is an allowed value of an enumerated setting. Label is the English
// name shown in the settings (translated by the client); Icon names an icon of
// the client, Lang the language the label is written in.
type Option struct {
	Value string
	Label string
	Icon  string
	Lang  string
}

// Options lists the allowed values of the enumerated settings, keyed by their
// JSON names, in the order the settings pages offer them. index.html renders
// its choices from these lists. Theme "system" follows the device, Language
// "system" the browser's Accept-Language header and Font "system" is the
// system font.
var Options = map[string][]Option{
	"theme": {
		{Value: "system", Label: "System", Icon: "display"},
		{Value: "light", Label: "Light", Icon: "sun"},
		{Value: "dark", Label: "Dark", Icon: "moon"},
	},
	"font": {
		{Value: "system", Label: "System"},
		{Value: "inter", Label: "Inter"},
		{Value: "roboto", Label: "Roboto"},
		{Value: "geist", Label: "Geist"},
		{Value: "opensans", Label: "Open Sans"},
	},
	"density": {
		{Value: "compact", Label: "Compact"},
		{Value: "standard", Label: "Standard"},
		{Value: "comfortable", Label: "Comfortable"},
	},
	"reorderMode": {
		{Value: "drag", Label: "Drag", Icon: "grip"},
		{Value: "buttons", Label: "Buttons", Icon: "chevronUp"},
	},
	"pattern": {
		{Value: "none", Label: "Plain"},
		{Value: "grain", Label: "Grain"},
		{Value: "dots", Label: "Dots"},
		{Value: "grid", Label: "Grid"},
		{Value: "lines", Label: "Lines"},
		{Value: "icons", Label: "Icons"},
		{Value: "halftone", Label: "Halftone dots"},
	},
	"rateWindow": {
		{Value: "7", Label: "7 days"},
		{Value: "30", Label: "30 days"},
		{Value: "90", Label: "90 days"},
		{Value: "365", Label: "365 days"},
		{Value: "all", Label: "All time"},
	},
	// Each language is named in its own language.
	"language": {
		{Value: "system", Label: "Browser language"},
		{Value: "en", Label: "English", Lang: "en"},
		{Value: "de", Label: "Deutsch", Lang: "de"},
	},
}

// IsOption reports whether value is one of the options of the setting named
// key.
func IsOption(key, value string) bool {
	return slices.ContainsFunc(Options[key], func(o Option) bool { return o.Value == value })
}

// option returns the check that a value is one of the options of the setting
// named key.
func option(key string) func(string) error {
	return func(value string) error {
		if IsOption(key, value) {
			return nil
		}
		var values []string
		for _, o := range Options[key] {
			values = append(values, o.Value)
		}
		return domain.Invalid("setting_not_option", "{setting} must be one of: {options}",
			"setting", key, "options", strings.Join(values, ", "))
	}
}

// percent returns the check that the setting named key lies between 0 and
// 100.
func percent(key string) func(int) error {
	return func(value int) error {
		if value < 0 || value > 100 {
			return domain.Invalid("setting_out_of_range", "{setting} must be between {min} and {max}",
				"setting", key, "min", 0, "max", 100)
		}
		return nil
	}
}

// MaxOverviewDays is the upper bound of OverviewDays.
const MaxOverviewDays = 90

// checkOverviewDays returns an error unless n is 0 (automatic) or between 3
// and MaxOverviewDays.
func checkOverviewDays(n int) error {
	if n != 0 && (n < 3 || n > MaxOverviewDays) {
		return domain.Invalid("overview_days_range", "overviewDays must be 0 (automatic) or between 3 and {max}", "max", MaxOverviewDays)
	}
	return nil
}

// NeutralBand is the BandColor for a grey today highlight.
const NeutralBand = "neutral"

// checkBandColor returns an error unless color is NeutralBand or one of
// domain.Colors.
func checkBandColor(color string) error {
	if color != NeutralBand && !domain.ValidColor(color) {
		return domain.Invalid("band_color_invalid", "band colour must be neutral or one of the habit colours")
	}
	return nil
}

// checkTimeZone returns an error unless zone is "" (the server's zone) or a
// known IANA name. "Local" is not accepted.
func checkTimeZone(zone string) error {
	if zone == "" {
		return nil
	}
	if _, err := time.LoadLocation(zone); err != nil || zone == "Local" {
		return domain.Invalid("unknown_time_zone", `unknown time zone "{zone}"`, "zone", zone)
	}
	return nil
}

// RateWindowDays returns the days the completion rate covers, 0 for the whole
// history (see domain.ComputeStats).
func (s Settings) RateWindowDays() int {
	if s.RateWindow == "all" {
		return 0
	}
	days, err := strconv.Atoi(s.RateWindow)
	if err != nil {
		return domain.DefaultRateWindowDays
	}
	return days
}
