package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are the preferences of a user. They are stored as one JSON
// document, so a new setting needs no migration: add a field here with its
// default in DefaultSettings, and its rule in Validate and resetInvalid.
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

// NeutralBand is the BandColor for a grey today highlight.
const NeutralBand = "neutral"

// MaxOverviewDays is the upper bound of OverviewDays.
const MaxOverviewDays = 90

// Validate returns a validation error for the first invalid setting.
func (s Settings) Validate() error {
	for _, err := range []error{
		checkOption("theme", s.Theme),
		checkOption("font", s.Font),
		checkOption("density", s.Density),
		checkOption("reorderMode", s.ReorderMode),
		checkOption("pattern", s.Pattern),
		checkOption("language", s.Language),
		checkOption("rateWindow", s.RateWindow),
		checkOverviewDays(s.OverviewDays),
		checkBandColor(s.BandColor),
		checkPercent("bandOpacity", s.BandOpacity),
		checkPercent("bandFillOpacity", s.BandFillOpacity),
		checkTimeZone(s.TimeZone),
	} {
		if err != nil {
			return err
		}
	}
	return nil
}

// resetInvalid replaces invalid values, e.g. of options removed since they
// were saved, by their defaults.
func (s *Settings) resetInvalid() {
	d := DefaultSettings()
	if checkOption("theme", s.Theme) != nil {
		s.Theme = d.Theme
	}
	if checkOption("font", s.Font) != nil {
		s.Font = d.Font
	}
	if checkOption("density", s.Density) != nil {
		s.Density = d.Density
	}
	if checkOption("reorderMode", s.ReorderMode) != nil {
		s.ReorderMode = d.ReorderMode
	}
	if checkOption("pattern", s.Pattern) != nil {
		s.Pattern = d.Pattern
	}
	if checkOption("language", s.Language) != nil {
		s.Language = d.Language
	}
	if checkOption("rateWindow", s.RateWindow) != nil {
		s.RateWindow = d.RateWindow
	}
	if checkOverviewDays(s.OverviewDays) != nil {
		s.OverviewDays = d.OverviewDays
	}
	if checkBandColor(s.BandColor) != nil {
		s.BandColor = d.BandColor
	}
	if checkPercent("bandOpacity", s.BandOpacity) != nil {
		s.BandOpacity = d.BandOpacity
	}
	if checkPercent("bandFillOpacity", s.BandFillOpacity) != nil {
		s.BandFillOpacity = d.BandFillOpacity
	}
	if checkTimeZone(s.TimeZone) != nil {
		s.TimeZone = d.TimeZone
	}
}

// checkOption returns an error unless value is one of the options of the
// setting named key.
func checkOption(key, value string) error {
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

// checkPercent returns an error unless value lies between 0 and 100.
func checkPercent(key string, value int) error {
	if value < 0 || value > 100 {
		return domain.Invalid("setting_out_of_range", "{setting} must be between {min} and {max}",
			"setting", key, "min", 0, "max", 100)
	}
	return nil
}

// checkOverviewDays returns an error unless n is 0 (automatic) or between 3
// and MaxOverviewDays.
func checkOverviewDays(n int) error {
	if n != 0 && (n < 3 || n > MaxOverviewDays) {
		return domain.Invalid("overview_days_range", "overviewDays must be 0 (automatic) or between 3 and {max}", "max", MaxOverviewDays)
	}
	return nil
}

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

// DefaultSettings returns the settings of a user who has not saved any.
func DefaultSettings() Settings {
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

// GetSettings returns the settings of the user, or DefaultSettings if none are
// stored.
func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	return readSettings(s.db.QueryRowContext(ctx, selectSettings, userID), userID)
}

// UpdateSettings loads the settings, modifies them with apply, validates and
// saves them, all in one transaction.
func (s *Store) UpdateSettings(ctx context.Context, userID string, apply func(*Settings) error) (Settings, error) {
	var settings Settings
	err := s.inTx(ctx, "saving settings", func(tx *sql.Tx) error {
		var err error
		settings, err = readSettings(tx.QueryRowContext(ctx, selectSettings, userID), userID)
		if err != nil {
			return err
		}
		if err := apply(&settings); err != nil {
			return err
		}
		if err := settings.Validate(); err != nil {
			return err
		}
		if err := ensureUser(ctx, tx, userID); err != nil {
			return err
		}
		data, err := json.Marshal(settings)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO user_settings (user_id, data, updated_at) VALUES (?,?,?)
			ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
			userID, string(data), formatTime(time.Now()))
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return settings, nil
}

const selectSettings = `SELECT data FROM user_settings WHERE user_id = ?`

// readSettings reads the settings document selected with selectSettings.
// Settings missing from it get their defaults, and invalid values are
// replaced by them.
func readSettings(row *sql.Row, userID string) (Settings, error) {
	var data string
	err := row.Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("loading settings: %w", err)
	}
	out := DefaultSettings()
	if err := json.Unmarshal([]byte(data), &out); err != nil {
		// A value of the wrong type keeps its default, like an invalid one.
		slog.Warn("stored settings are partly unreadable", "user", userID, "error", err)
	}
	out.resetInvalid()
	return out, nil
}
