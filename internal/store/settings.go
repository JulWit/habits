package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are the preferences of a user.
type Settings struct {
	// Theme is one of Themes.
	Theme string `json:"theme"`
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

// Allowed values of the enumerated settings. Theme "system" follows the
// device, Language "system" the browser's Accept-Language header. Font
// "system" is the system font; all others are embedded. Pattern "image" is the
// uploaded background image.
var (
	Themes       = []string{"system", "light", "dark"}
	Fonts        = []string{"system", "inter", "roboto", "geist", "opensans", "montserrat", "poppins", "lato"}
	Densities    = []string{"compact", "standard", "comfortable"}
	ReorderModes = []string{"drag", "buttons"}
	Patterns     = []string{"none", "dots", "grid", "diagonal", "cross", "lines", "checks", "gradient", "glow", "image"}
	Languages    = []string{"system", "en", "de"}
)

// NeutralBand is the BandColor for a grey today highlight.
const NeutralBand = "neutral"

// MaxOverviewDays is the upper bound of OverviewDays.
const MaxOverviewDays = 90

// MinSurfaceOpacity is the lower bound of SurfaceOpacity, in percent.
const MinSurfaceOpacity = 20

// BackgroundBlurAtFull is the blur radius in pixels at 100 percent. The client
// uses the same value.
const BackgroundBlurAtFull = 40

func validOverviewDays(n int) bool { return n == 0 || (n >= 3 && n <= MaxOverviewDays) }

func validPercent(n int) bool { return n >= 0 && n <= 100 }

func validSurfaceOpacity(n int) bool { return n >= MinSurfaceOpacity && n <= 100 }

func validBandColor(c string) bool {
	return c == NeutralBand || slices.Contains(domain.DefaultColors, c)
}

// validTimeZone reports whether tz is "" or a known IANA time zone name.
// "Local" is not accepted.
func validTimeZone(tz string) bool {
	if tz == "" {
		return true
	}
	if tz == "Local" {
		return false
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}

// Validate returns a validation error for the first invalid setting.
func (s Settings) Validate() error {
	switch {
	case !slices.Contains(Themes, s.Theme):
		return invalidf("theme must be one of %v", Themes)
	case !validOverviewDays(s.OverviewDays):
		return invalidf("overviewDays must be 0 (automatic) or between 3 and %d", MaxOverviewDays)
	case !slices.Contains(Fonts, s.Font):
		return invalidf("font must be one of %v", Fonts)
	case !slices.Contains(Densities, s.Density):
		return invalidf("density must be one of %v", Densities)
	case !slices.Contains(ReorderModes, s.ReorderMode):
		return invalidf("reorder mode must be one of %v", ReorderModes)
	case !slices.Contains(Patterns, s.Pattern):
		return invalidf("background pattern must be one of %v", Patterns)
	case !validBandColor(s.BandColor):
		return invalidf("band colour must be neutral or one of the habit colours")
	case !validPercent(s.BandOpacity):
		return invalidf("band opacity must be between 0 and 100")
	case !validPercent(s.BandFillOpacity):
		return invalidf("band fill opacity must be between 0 and 100")
	case !validPercent(s.BackgroundDim):
		return invalidf("background dim must be between 0 and 100")
	case !validPercent(s.BackgroundBlur):
		return invalidf("background blur must be between 0 and 100")
	case !validSurfaceOpacity(s.SurfaceOpacity):
		return invalidf("surface opacity must be between %d and 100", MinSurfaceOpacity)
	case !validPercent(s.SurfaceBlur):
		return invalidf("surface blur must be between 0 and 100")
	case !slices.Contains(Languages, s.Language):
		return invalidf("language must be one of %v", Languages)
	case !validTimeZone(s.TimeZone):
		return domain.Invalid(`unknown time zone "{zone}"`, "zone", s.TimeZone)
	}
	return nil
}

// resetInvalid replaces invalid values, e.g. of options removed since they
// were saved, by their defaults.
func (s *Settings) resetInvalid() {
	d := DefaultSettings()
	if !slices.Contains(Themes, s.Theme) {
		s.Theme = d.Theme
	}
	if !validOverviewDays(s.OverviewDays) {
		s.OverviewDays = d.OverviewDays
	}
	if !slices.Contains(Fonts, s.Font) {
		s.Font = d.Font
	}
	if !slices.Contains(Densities, s.Density) {
		s.Density = d.Density
	}
	if !slices.Contains(ReorderModes, s.ReorderMode) {
		s.ReorderMode = d.ReorderMode
	}
	if !slices.Contains(Patterns, s.Pattern) {
		s.Pattern = d.Pattern
	}
	if !validBandColor(s.BandColor) {
		s.BandColor = d.BandColor
	}
	if !validPercent(s.BandOpacity) {
		s.BandOpacity = d.BandOpacity
	}
	if !validPercent(s.BandFillOpacity) {
		s.BandFillOpacity = d.BandFillOpacity
	}
	if !validPercent(s.BackgroundDim) {
		s.BackgroundDim = d.BackgroundDim
	}
	if !validPercent(s.BackgroundBlur) {
		s.BackgroundBlur = d.BackgroundBlur
	}
	if !validSurfaceOpacity(s.SurfaceOpacity) {
		s.SurfaceOpacity = d.SurfaceOpacity
	}
	if !validPercent(s.SurfaceBlur) {
		s.SurfaceBlur = d.SurfaceBlur
	}
	if !slices.Contains(Languages, s.Language) {
		s.Language = d.Language
	}
	if !validTimeZone(s.TimeZone) {
		s.TimeZone = d.TimeZone
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
