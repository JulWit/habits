package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are the preferences of a user.
type Settings struct {
	Theme string `json:"theme"` // "system" | "light" | "dark"
	// OverviewDays is the number of day columns on the overview; 0 shows as
	// many as fit.
	OverviewDays int `json:"overviewDays"`
	// ShowArchived shows archived habits on the overview.
	ShowArchived bool `json:"showArchived"`
	// Font is one of Fonts.
	Font string `json:"font"`
	// Density is one of Densities.
	Density string `json:"density"`
	// ReorderMode is one of ReorderModes.
	ReorderMode string `json:"reorderMode"`
	// Pattern is one of Patterns.
	Pattern string `json:"pattern"`
	// AlignWeeks starts the overview on a Monday instead of ending it today.
	AlignWeeks bool `json:"alignWeeks"`
	// BandColor is the colour of the today highlight: NeutralBand or one of
	// domain.DefaultColors.
	BandColor string `json:"bandColor"`
	// BandOpacity is the opacity of the today highlight in the header, in
	// percent.
	BandOpacity int `json:"bandOpacity"`
	// BandFillOpacity is the opacity of the today band in the cards, in
	// percent.
	BandFillOpacity int `json:"bandFillOpacity"`
	// ShowBand shows the today band in the cards.
	ShowBand bool `json:"showBand"`
	// BackgroundDim and BackgroundBlur apply to the background image, in
	// percent.
	BackgroundDim  int `json:"backgroundDim"`
	BackgroundBlur int `json:"backgroundBlur"`
	// SurfaceOpacity and SurfaceBlur apply to surfaces over the background
	// image, in percent.
	SurfaceOpacity int `json:"surfaceOpacity"`
	SurfaceBlur    int `json:"surfaceBlur"`
	// Language is one of Languages.
	Language string `json:"language"`
	// TimeZone is an IANA time zone name, or "" for the server's HABITS_TZ.
	TimeZone string `json:"timeZone"`
}

// Bounds of the background and surface settings, in percent.
const (
	MinBackgroundDim  = 0
	MaxBackgroundDim  = 100
	MaxBackgroundBlur = 100
	MinSurfaceOpacity = 20
	MaxSurfaceOpacity = 100
	MaxSurfaceBlur    = 100
)

// MaxBandOpacity is the upper bound of BandOpacity and BandFillOpacity.
const MaxBandOpacity = 100

// ValidBandOpacity reports whether n is a valid band opacity.
func ValidBandOpacity(n int) bool { return n >= 0 && n <= MaxBandOpacity }

// ValidSurfaceOpacity reports whether n is a valid surface opacity.
func ValidSurfaceOpacity(n int) bool { return n >= MinSurfaceOpacity && n <= MaxSurfaceOpacity }

// ValidSurfaceBlur reports whether n is a valid surface blur.
func ValidSurfaceBlur(n int) bool { return n >= 0 && n <= MaxSurfaceBlur }

// BackgroundBlurAtFull is the blur radius in pixels at 100 percent. The client
// uses the same value.
const BackgroundBlurAtFull = 40

// ValidBackgroundDim reports whether n is a valid background dim.
func ValidBackgroundDim(n int) bool { return n >= MinBackgroundDim && n <= MaxBackgroundDim }

// ValidBackgroundBlur reports whether n is a valid background blur.
func ValidBackgroundBlur(n int) bool { return n >= 0 && n <= MaxBackgroundBlur }

// NeutralBand is the BandColor for a grey today highlight.
const NeutralBand = "neutral"

// ValidBandColor reports whether c is NeutralBand or one of
// domain.DefaultColors.
func ValidBandColor(c string) bool {
	if c == NeutralBand {
		return true
	}
	for _, known := range domain.DefaultColors {
		if known == c {
			return true
		}
	}
	return false
}

// Patterns are the valid page backgrounds. "image" is the uploaded background
// image.
var Patterns = []string{"none", "dots", "grid", "diagonal", "cross", "image"}

// ValidPattern reports whether p is one of Patterns.
func ValidPattern(p string) bool {
	for _, known := range Patterns {
		if known == p {
			return true
		}
	}
	return false
}

// ReorderModes are the valid ways to reorder habits and categories: by drag
// and drop or with arrow buttons.
var ReorderModes = []string{"drag", "buttons"}

// ValidReorderMode reports whether m is one of ReorderModes.
func ValidReorderMode(m string) bool {
	for _, known := range ReorderModes {
		if known == m {
			return true
		}
	}
	return false
}

// Fonts are the valid fonts. "system" uses the system font; all others are
// embedded.
var Fonts = []string{
	"system", "inter", "roboto", "geist", "opensans", "montserrat", "poppins", "lato",
}

// ValidFont reports whether f is one of Fonts.
func ValidFont(f string) bool {
	for _, known := range Fonts {
		if known == f {
			return true
		}
	}
	return false
}

// Densities are the valid UI densities.
var Densities = []string{"compact", "standard", "comfortable"}

// ValidDensity reports whether d is one of Densities.
func ValidDensity(d string) bool {
	for _, known := range Densities {
		if known == d {
			return true
		}
	}
	return false
}

// Languages are the valid UI languages. "system" uses the browser's
// Accept-Language header.
var Languages = []string{"system", "en", "de"}

// ValidLanguage reports whether l is one of Languages.
func ValidLanguage(l string) bool {
	for _, known := range Languages {
		if known == l {
			return true
		}
	}
	return false
}

// ValidTimeZone reports whether tz is "" or a known IANA time zone name.
// "Local" is not accepted.
func ValidTimeZone(tz string) bool {
	if tz == "" {
		return true
	}
	if tz == "Local" {
		return false
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}

// MaxOverviewDays is the upper bound of OverviewDays.
const MaxOverviewDays = 90

// ValidTheme reports whether t is "system", "light" or "dark".
func ValidTheme(t string) bool {
	switch t {
	case "system", "light", "dark":
		return true
	}
	return false
}

// ValidOverviewDays reports whether n is 0 or between 3 and MaxOverviewDays.
func ValidOverviewDays(n int) bool {
	return n == 0 || (n >= 3 && n <= MaxOverviewDays)
}

// DefaultSettings returns the settings of a user who has not saved any.
func DefaultSettings() Settings {
	return Settings{
		Theme:           "system",
		OverviewDays:    0,
		ShowArchived:    false,
		Font:            "inter",
		Density:         "standard",
		ReorderMode:     "drag",
		Pattern:         "none",
		AlignWeeks:      false,
		BandColor:       NeutralBand,
		BandOpacity:     100,
		BandFillOpacity: 30,
		ShowBand:        true,
		BackgroundDim:   55,
		BackgroundBlur:  0,
		SurfaceOpacity:  88,
		SurfaceBlur:     30,
		Language:        "system",
		TimeZone:        "",
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

// getSettings loads the settings of the user. Invalid stored values are
// replaced by their defaults.
func (s *Store) getSettings(ctx context.Context, q queryer, userID string) (Settings, error) {
	out := DefaultSettings()
	err := q.QueryRowContext(ctx,
		`SELECT theme, overview_days, show_archived, font, reorder_mode, pattern, align_weeks,
		        band_color, band_opacity, bg_dim, bg_blur, surface_opacity, surface_blur, density,
		        show_band, band_fill_opacity, language, time_zone
		 FROM user_settings WHERE user_id = ?`,
		userID).Scan(&out.Theme, &out.OverviewDays, &out.ShowArchived, &out.Font, &out.ReorderMode,
		&out.Pattern, &out.AlignWeeks, &out.BandColor, &out.BandOpacity,
		&out.BackgroundDim, &out.BackgroundBlur, &out.SurfaceOpacity, &out.SurfaceBlur, &out.Density,
		&out.ShowBand, &out.BandFillOpacity, &out.Language, &out.TimeZone)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("loading settings: %w", err)
	}
	if !ValidTheme(out.Theme) {
		out.Theme = DefaultSettings().Theme
	}
	if !ValidOverviewDays(out.OverviewDays) {
		out.OverviewDays = DefaultSettings().OverviewDays
	}
	if !ValidFont(out.Font) {
		out.Font = DefaultSettings().Font
	}
	if !ValidDensity(out.Density) {
		out.Density = DefaultSettings().Density
	}
	if !ValidReorderMode(out.ReorderMode) {
		out.ReorderMode = DefaultSettings().ReorderMode
	}
	if !ValidPattern(out.Pattern) {
		out.Pattern = DefaultSettings().Pattern
	}
	if !ValidBandColor(out.BandColor) {
		out.BandColor = DefaultSettings().BandColor
	}
	if !ValidBandOpacity(out.BandOpacity) {
		out.BandOpacity = DefaultSettings().BandOpacity
	}
	if !ValidBandOpacity(out.BandFillOpacity) {
		out.BandFillOpacity = DefaultSettings().BandFillOpacity
	}
	if !ValidBackgroundDim(out.BackgroundDim) {
		out.BackgroundDim = DefaultSettings().BackgroundDim
	}
	if !ValidBackgroundBlur(out.BackgroundBlur) {
		out.BackgroundBlur = DefaultSettings().BackgroundBlur
	}
	if !ValidSurfaceOpacity(out.SurfaceOpacity) {
		out.SurfaceOpacity = DefaultSettings().SurfaceOpacity
	}
	if !ValidSurfaceBlur(out.SurfaceBlur) {
		out.SurfaceBlur = DefaultSettings().SurfaceBlur
	}
	if !ValidLanguage(out.Language) {
		out.Language = DefaultSettings().Language
	}
	if !ValidTimeZone(out.TimeZone) {
		out.TimeZone = DefaultSettings().TimeZone
	}
	return out, nil
}

// SaveSettings validates and stores the settings of the user.
func (s *Store) SaveSettings(ctx context.Context, userID string, in Settings) error {
	return s.saveSettings(ctx, s.db, userID, in)
}

// saveSettings validates and stores the settings of the user.
func (s *Store) saveSettings(ctx context.Context, q execer, userID string, in Settings) error {
	if !ValidTheme(in.Theme) {
		return invalidf("unknown theme %q", in.Theme)
	}
	if !ValidOverviewDays(in.OverviewDays) {
		return invalidf("invalid overview day count %d", in.OverviewDays)
	}
	if !ValidFont(in.Font) {
		return invalidf("unknown font %q", in.Font)
	}
	if !ValidDensity(in.Density) {
		return invalidf("unknown density %q", in.Density)
	}
	if !ValidReorderMode(in.ReorderMode) {
		return invalidf("unknown reorder mode %q", in.ReorderMode)
	}
	if !ValidPattern(in.Pattern) {
		return invalidf("unknown background pattern %q", in.Pattern)
	}
	if !ValidBandColor(in.BandColor) {
		return invalidf("unknown band colour %q", in.BandColor)
	}
	if !ValidBandOpacity(in.BandOpacity) {
		return invalidf("invalid band opacity %d", in.BandOpacity)
	}
	if !ValidBandOpacity(in.BandFillOpacity) {
		return invalidf("invalid band fill opacity %d", in.BandFillOpacity)
	}
	if !ValidBackgroundDim(in.BackgroundDim) {
		return invalidf("invalid background dim %d", in.BackgroundDim)
	}
	if !ValidBackgroundBlur(in.BackgroundBlur) {
		return invalidf("invalid background blur %d", in.BackgroundBlur)
	}
	if !ValidSurfaceOpacity(in.SurfaceOpacity) {
		return invalidf("invalid surface opacity %d", in.SurfaceOpacity)
	}
	if !ValidSurfaceBlur(in.SurfaceBlur) {
		return invalidf("invalid surface blur %d", in.SurfaceBlur)
	}
	if !ValidLanguage(in.Language) {
		return invalidf("unknown language %q", in.Language)
	}
	if !ValidTimeZone(in.TimeZone) {
		return invalidf("unknown time zone %q", in.TimeZone)
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO user_settings
			(user_id, theme, overview_days, show_archived, font, reorder_mode, pattern,
			 align_weeks, band_color, band_opacity, bg_dim, bg_blur, surface_opacity,
			 surface_blur, density, show_band, band_fill_opacity, language, time_zone, updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET
			theme = excluded.theme,
			overview_days = excluded.overview_days,
			show_archived = excluded.show_archived,
			font = excluded.font,
			reorder_mode = excluded.reorder_mode,
			pattern = excluded.pattern,
			align_weeks = excluded.align_weeks,
			band_color = excluded.band_color,
			band_opacity = excluded.band_opacity,
			bg_dim = excluded.bg_dim,
			bg_blur = excluded.bg_blur,
			surface_opacity = excluded.surface_opacity,
			surface_blur = excluded.surface_blur,
			density = excluded.density,
			show_band = excluded.show_band,
			band_fill_opacity = excluded.band_fill_opacity,
			language = excluded.language,
			time_zone = excluded.time_zone,
			updated_at = excluded.updated_at`,
		userID, in.Theme, in.OverviewDays, in.ShowArchived, in.Font, in.ReorderMode, in.Pattern,
		in.AlignWeeks, in.BandColor, in.BandOpacity, in.BackgroundDim, in.BackgroundBlur,
		in.SurfaceOpacity, in.SurfaceBlur, in.Density, in.ShowBand, in.BandFillOpacity,
		in.Language, in.TimeZone, formatTime(time.Now()))
	if err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	return nil
}
