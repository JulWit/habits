package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Settings are per-user preferences. They live on the server rather than in
// localStorage because the application is online-first: the same choice should
// apply on every device the user opens it from.
type Settings struct {
	Theme string `json:"theme"` // "system" | "light" | "dark"
	// OverviewDays is how many day columns the board should show. 0 means "as
	// many as fit"; any other value is a wish that the client still caps at the
	// number the window can actually hold.
	OverviewDays int `json:"overviewDays"`
	// ShowArchived folds archived habits back into the overview.
	ShowArchived bool `json:"showArchived"`
	// Font names one of the typefaces shipped inside the binary, or "system"
	// for whatever the device provides.
	Font string `json:"font"`
	// Density sets how tightly the interface is packed: the air in and around
	// every control, and how heavy its emphasis is set.
	Density string `json:"density"`
	// ReorderMode decides how categories and habits are rearranged: by dragging
	// them, or with a pair of arrows per entry.
	ReorderMode string `json:"reorderMode"`
	// Pattern names the texture drawn behind the page, or "none" for a plain
	// surface.
	Pattern string `json:"pattern"`
	// AlignWeeks starts the board on a Monday instead of ending it on today, so
	// the columns line up with calendar weeks.
	AlignWeeks bool `json:"alignWeeks"`
	// BandColor tints the today column: "neutral", or one of the habit colours.
	// The palette is shared rather than copied, so the board never offers a
	// shade the editor does not.
	BandColor string `json:"bandColor"`
	// BandOpacity is how strongly that marking is drawn, in percent. Some
	// backgrounds want a whisper rather than a band.
	BandOpacity int `json:"bandOpacity"`
	// BandFillOpacity is how strongly the band through the cards is drawn, in
	// percent - apart from BandOpacity, which marks the date in the header. A
	// band as wide as a column can want a whisper where the date wants colour.
	BandFillOpacity int `json:"bandFillOpacity"`
	// ShowBand draws the today column as a band through the cards. Off, only
	// the date in the header is marked; the colour still tints that and the
	// progress ring.
	ShowBand bool `json:"showBand"`
	// BackgroundDim and BackgroundBlur belong to the uploaded background: how
	// far it is veiled, and how far it is blurred. Both in percent, because both
	// are the same kind of choice - how much of the picture is left - and a
	// number of pixels would say nothing to whoever pulls the slider.
	BackgroundDim  int `json:"backgroundDim"`
	BackgroundBlur int `json:"backgroundBlur"`
	// SurfaceOpacity and SurfaceBlur belong to what sits on top of an uploaded
	// picture: the cards, the title bar, the day header. Also in percent, and
	// also a pair - how much of the picture comes through, and how soft it is
	// when it does. They apply only while a picture is the background; over a
	// flat page there is nothing to show through.
	SurfaceOpacity int `json:"surfaceOpacity"`
	SurfaceBlur    int `json:"surfaceBlur"`
	// Language is the language of the interface: "en", "de", or "system" for
	// whichever of the two the browser asks for first.
	Language string `json:"language"`
	// TimeZone decides what "today" is for this user, as an IANA name such as
	// "Europe/Berlin". Empty follows the server's HABITS_TZ, which is what
	// every user did before the setting existed.
	TimeZone string `json:"timeZone"`
}

// The bounds for the two background knobs. Both go the whole way: off, for a
// picture chosen to be seen, through to fully veiled or fully soft, which a
// busy photograph needs before a board can be read over it.
const (
	MinBackgroundDim  = 0
	MaxBackgroundDim  = 100
	MaxBackgroundBlur = 100
	// A surface may fade to a fifth, but not further: below that the cards stop
	// being surfaces and the board turns into text on a photograph.
	MinSurfaceOpacity = 20
	MaxSurfaceOpacity = 100
	MaxSurfaceBlur    = 100
)

// MaxBandOpacity, and no minimum: at zero the marking is simply off, which is a
// legitimate answer for a busy background.
const MaxBandOpacity = 100

func ValidBandOpacity(n int) bool { return n >= 0 && n <= MaxBandOpacity }

func ValidSurfaceOpacity(n int) bool { return n >= MinSurfaceOpacity && n <= MaxSurfaceOpacity }
func ValidSurfaceBlur(n int) bool    { return n >= 0 && n <= MaxSurfaceBlur }

// BackgroundBlurAtFull is what a hundred percent of blur comes to on screen.
// The client scales the percentage with the same number; it is written down in
// both places because the stylesheet needs a length and the setting is not one.
const BackgroundBlurAtFull = 40

func ValidBackgroundDim(n int) bool  { return n >= MinBackgroundDim && n <= MaxBackgroundDim }
func ValidBackgroundBlur(n int) bool { return n >= 0 && n <= MaxBackgroundBlur }

// NeutralBand is the BandColor that leaves the today column grey.
const NeutralBand = "neutral"

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

// Patterns are the backgrounds the page offers. Like the fonts, the server
// validates against this list and writes the choice into the HTML shell; the
// stylesheet carries a matching rule per key.
// "image" is the uploaded background; it is a pattern like the others as far as
// the page is concerned - one value deciding what is drawn behind the board -
// but the settings dialog only offers it once a picture has been uploaded.
var Patterns = []string{"none", "dots", "grid", "diagonal", "cross", "image"}

func ValidPattern(p string) bool {
	for _, known := range Patterns {
		if known == p {
			return true
		}
	}
	return false
}

// ReorderModes are the ways the board offers to change an order. Dragging is
// quicker over several places; the arrows are the way through with a keyboard
// and the steadier one on a phone.
var ReorderModes = []string{"drag", "buttons"}

func ValidReorderMode(m string) bool {
	for _, known := range ReorderModes {
		if known == m {
			return true
		}
	}
	return false
}

// Fonts are the typefaces the interface offers. The list lives here because the
// server validates against it and bakes the choice into the HTML shell; the
// stylesheet carries a matching rule per key, and the settings dialog is built
// from what the server sends.
var Fonts = []string{
	"system", "inter", "roboto", "geist", "opensans", "montserrat", "poppins", "lato",
}

func ValidFont(f string) bool {
	for _, known := range Fonts {
		if known == f {
			return true
		}
	}
	return false
}

// Densities are the three ways the interface can be packed. Like the fonts, the
// server validates against this list and bakes the choice into the HTML shell;
// the stylesheet carries the tokens per key.
var Densities = []string{"compact", "standard", "comfortable"}

func ValidDensity(d string) bool {
	for _, known := range Densities {
		if known == d {
			return true
		}
	}
	return false
}

// Languages are the languages the interface is translated into. "system"
// is not one of them but a choice between them: the shell picks whichever the
// browser's Accept-Language names first.
var Languages = []string{"system", "en", "de"}

func ValidLanguage(l string) bool {
	for _, known := range Languages {
		if known == l {
			return true
		}
	}
	return false
}

// ValidTimeZone accepts "" for the server's own zone, or any IANA name the
// embedded zone database knows. "Local" is refused: it names whatever the host
// happens to be set to, which is exactly the ambiguity a per-user zone is meant
// to remove.
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

// MaxOverviewDays bounds the stored wish. Beyond a quarter of a year the row of
// squares stops being readable at any window size.
const MaxOverviewDays = 90

// ValidTheme accepts the two explicit choices and "system", which leaves the
// decision to the device. The stylesheet turns all three into a color-scheme.
func ValidTheme(t string) bool {
	switch t {
	case "system", "light", "dark":
		return true
	}
	return false
}

// ValidOverviewDays accepts 0 for automatic, or a range wide enough to be
// useful without being absurd.
func ValidOverviewDays(n int) bool {
	return n == 0 || (n >= 3 && n <= MaxOverviewDays)
}

// DefaultSettings is what a user who has never chosen sees: the appearance the
// device asks for, as many day columns as fit, and the typeface the interface
// was drawn with.
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
		// Enough veil to read the board over most photographs, and no blur:
		// whoever uploads a picture should see it first, then decide.
		BackgroundDim:  55,
		BackgroundBlur: 0,
		// What the title bar has always done by itself, now said out loud.
		SurfaceOpacity: 88,
		SurfaceBlur:    30,
		Language:       "system",
		TimeZone:       "",
	}
}

// GetSettings returns the user's settings, or the defaults if none were stored
// yet. It never writes, so a plain page load stays read-only.
func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	return s.getSettings(ctx, s.db, userID)
}

// UpdateSettings reads the settings, hands them to apply, and writes the result
// back — all inside one transaction.
//
// Every setting is written the moment its control moves, so two of them can be
// in flight at once. Read-modify-write over two separate statements would let
// the second write land on a copy taken before the first, and the earlier
// change would simply vanish.
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
	// A value the current binary no longer accepts falls back rather than
	// propagating into the UI as something unrenderable.
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
	// A zone the embedded database no longer knows falls back to the server's
	// rather than leaving the user without a "today".
	if !ValidTimeZone(out.TimeZone) {
		out.TimeZone = DefaultSettings().TimeZone
	}
	return out, nil
}

func (s *Store) SaveSettings(ctx context.Context, userID string, in Settings) error {
	return s.saveSettings(ctx, s.db, userID, in)
}

// The rejections below are wrapped in domain.ErrValidation so that a bad value
// reaching this far still answers 422 rather than 500. The handler normally
// catches it first with a message naming the setting; this is the backstop.
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
