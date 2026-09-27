package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are the preferences of a user. They are stored as one JSON
// document, so a new setting needs no migration: add a field here with its
// default in DefaultSettings, and its rule (see Validate).
//
// Rules are declared, not coded per field: a string field whose JSON name is
// a key of Options must be one of those options, an int field with a range tag
// must lie in that range, and checks holds the few rules that need code.
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
	BandOpacity int `json:"bandOpacity" range:"0,100"`
	// BandFillOpacity is the opacity of the today band in the cards, in
	// percent.
	BandFillOpacity int `json:"bandFillOpacity" range:"0,100"`
	// ShowBand shows the today band in the cards.
	ShowBand bool `json:"showBand"`
	// BackgroundDim and BackgroundBlur apply to the background image, in
	// percent.
	BackgroundDim  int `json:"backgroundDim" range:"0,100"`
	BackgroundBlur int `json:"backgroundBlur" range:"0,100"`
	// SurfaceOpacity and SurfaceBlur apply to surfaces over the background
	// image, in percent.
	SurfaceOpacity int    `json:"surfaceOpacity" range:"20,100"`
	SurfaceBlur    int    `json:"surfaceBlur" range:"0,100"`
	Language       string `json:"language"`
	// TimeZone is an IANA time zone name, or "" for the server's HABITS_TZ.
	TimeZone string `json:"timeZone"`
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
// "system" the browser's Accept-Language header, Font "system" is the system
// font and Pattern "image" the uploaded background image.
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
		{Value: "montserrat", Label: "Montserrat"},
		{Value: "poppins", Label: "Poppins"},
		{Value: "lato", Label: "Lato"},
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
		{Value: "dots", Label: "Dots"},
		{Value: "grid", Label: "Grid"},
		{Value: "diagonal", Label: "Diagonal"},
		{Value: "cross", Label: "Cross-hatch"},
		{Value: "lines", Label: "Lines"},
		{Value: "checks", Label: "Checks"},
		{Value: "gradient", Label: "Gradient"},
		{Value: "glow", Label: "Glow"},
		{Value: "image", Label: "Own image"},
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

// BackgroundBlurAtFull is the blur radius in pixels at 100 percent. The client
// uses the same value.
const BackgroundBlurAtFull = 40

// checks are the rules that options and ranges cannot express, keyed by the
// JSON name of their setting.
var checks = map[string]func(Settings) error{
	"overviewDays": func(s Settings) error {
		if n := s.OverviewDays; n != 0 && (n < 3 || n > MaxOverviewDays) {
			return domain.Invalid("overviewDays must be 0 (automatic) or between 3 and {max}", "max", MaxOverviewDays)
		}
		return nil
	},
	"bandColor": func(s Settings) error {
		if s.BandColor != NeutralBand && !domain.ValidColor(s.BandColor) {
			return domain.Invalid("band colour must be neutral or one of the habit colours")
		}
		return nil
	},
	// A known IANA name or "" for the server's zone; "Local" is not accepted.
	"timeZone": func(s Settings) error {
		if s.TimeZone == "" {
			return nil
		}
		if _, err := time.LoadLocation(s.TimeZone); err != nil || s.TimeZone == "Local" {
			return domain.Invalid(`unknown time zone "{zone}"`, "zone", s.TimeZone)
		}
		return nil
	},
}

var settingsType = reflect.TypeFor[Settings]()

// Validate returns a validation error for the first invalid setting.
func (s Settings) Validate() error {
	for i := range settingsType.NumField() {
		if err := s.fieldError(i); err != nil {
			return err
		}
	}
	return nil
}

// fieldError returns a validation error if the i-th field breaks its rule.
func (s Settings) fieldError(i int) error {
	field := settingsType.Field(i)
	key, _, _ := strings.Cut(field.Tag.Get("json"), ",")
	value := reflect.ValueOf(s).Field(i)

	if options, ok := Options[key]; ok && !IsOption(key, value.String()) {
		values := make([]string, len(options))
		for i, o := range options {
			values[i] = o.Value
		}
		return domain.Invalid("{setting} must be one of: {options}",
			"setting", key, "options", strings.Join(values, ", "))
	}
	if r := field.Tag.Get("range"); r != "" {
		lo, hi := parseRange(r)
		if n := int(value.Int()); n < lo || n > hi {
			return domain.Invalid("{setting} must be between {min} and {max}",
				"setting", key, "min", lo, "max", hi)
		}
	}
	if check := checks[key]; check != nil {
		return check(s)
	}
	return nil
}

// parseRange parses a range tag "lo,hi". A malformed tag is a programming
// error.
func parseRange(tag string) (lo, hi int) {
	a, b, _ := strings.Cut(tag, ",")
	lo, err1 := strconv.Atoi(a)
	hi, err2 := strconv.Atoi(b)
	if err1 != nil || err2 != nil {
		panic("store: malformed range tag " + strconv.Quote(tag))
	}
	return lo, hi
}

// resetInvalid replaces invalid values, e.g. of options removed since they
// were saved, by their defaults.
func (s *Settings) resetInvalid() {
	defaults := reflect.ValueOf(DefaultSettings())
	for i := range settingsType.NumField() {
		if s.fieldError(i) != nil {
			reflect.ValueOf(s).Elem().Field(i).Set(defaults.Field(i))
		}
	}
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
		BackgroundDim:   55,
		SurfaceOpacity:  88,
		SurfaceBlur:     30,
		Language:        "system",
	}
}

// GetSettings returns the settings of the user, or DefaultSettings if none are
// stored.
func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	return s.getSettings(ctx, s.db, userID)
}

// UpdateSettings loads the settings, modifies them with apply and saves them,
// all in one transaction.
func (s *Store) UpdateSettings(ctx context.Context, userID string, apply func(*Settings) error) (Settings, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	settings, err := s.getSettings(ctx, tx, userID)
	if err != nil {
		return Settings{}, err
	}
	if err := apply(&settings); err != nil {
		return Settings{}, err
	}
	if err := s.saveSettings(ctx, tx, userID, settings); err != nil {
		return Settings{}, err
	}
	if err := tx.Commit(); err != nil {
		return Settings{}, fmt.Errorf("committing settings: %w", err)
	}
	return settings, nil
}

// getSettings loads the settings of the user. Settings missing from the
// stored document get their defaults, and invalid values are replaced by
// them.
func (s *Store) getSettings(ctx context.Context, q queryer, userID string) (Settings, error) {
	var data string
	err := q.QueryRowContext(ctx, `SELECT data FROM user_settings WHERE user_id = ?`, userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("loading settings: %w", err)
	}
	out := DefaultSettings()
	if err := json.Unmarshal([]byte(data), &out); err != nil {
		// A value of the wrong type keeps its default, like an invalid one.
		slog.Warn("stored settings are partly unreadable", "user", userID, "error", err)
	}
	out.resetInvalid()
	return out, nil
}

// SaveSettings validates and stores the settings of the user.
func (s *Store) SaveSettings(ctx context.Context, userID string, in Settings) error {
	return s.saveSettings(ctx, s.db, userID, in)
}

// saveSettings validates and stores the settings of the user.
func (s *Store) saveSettings(ctx context.Context, q execer, userID string, in Settings) error {
	if err := in.Validate(); err != nil {
		return err
	}
	if err := ensureUser(ctx, q, userID); err != nil {
		return err
	}
	data, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("encoding settings: %w", err)
	}
	_, err = q.ExecContext(ctx, `
		INSERT INTO user_settings (user_id, data, updated_at) VALUES (?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		userID, string(data), formatTime(time.Now()))
	if err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	return nil
}
