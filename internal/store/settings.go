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
		Theme:        "system",
		OverviewDays: 0,
		ShowArchived: false,
		Font:         "inter",
		ReorderMode:  "drag",
		Pattern:      "none",
		AlignWeeks:   false,
		BandColor:    NeutralBand,
		BandOpacity:  100,
		// Enough veil to read the board over most photographs, and no blur:
		// whoever uploads a picture should see it first, then decide.
		BackgroundDim:  55,
		BackgroundBlur: 0,
		// What the title bar has always done by itself, now said out loud.
		SurfaceOpacity: 88,
		SurfaceBlur:    30,
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
		return Settings{}, fmt.Errorf("transaktion starten: %w", err)
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
		return Settings{}, fmt.Errorf("einstellungen committen: %w", err)
	}
	return settings, nil
}

func (s *Store) getSettings(ctx context.Context, q queryer, userID string) (Settings, error) {
	out := DefaultSettings()
	err := q.QueryRowContext(ctx,
		`SELECT theme, overview_days, show_archived, font, reorder_mode, pattern, align_weeks,
		        band_color, band_opacity, bg_dim, bg_blur, surface_opacity, surface_blur
		 FROM user_settings WHERE user_id = ?`,
		userID).Scan(&out.Theme, &out.OverviewDays, &out.ShowArchived, &out.Font, &out.ReorderMode,
		&out.Pattern, &out.AlignWeeks, &out.BandColor, &out.BandOpacity,
		&out.BackgroundDim, &out.BackgroundBlur, &out.SurfaceOpacity, &out.SurfaceBlur)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("einstellungen laden: %w", err)
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
		return invalidf("unbekanntes theme %q", in.Theme)
	}
	if !ValidOverviewDays(in.OverviewDays) {
		return invalidf("ungültige tagesanzahl %d", in.OverviewDays)
	}
	if !ValidFont(in.Font) {
		return invalidf("unbekannte schriftart %q", in.Font)
	}
	if !ValidReorderMode(in.ReorderMode) {
		return invalidf("unbekannter sortiermodus %q", in.ReorderMode)
	}
	if !ValidPattern(in.Pattern) {
		return invalidf("unbekanntes hintergrundmuster %q", in.Pattern)
	}
	if !ValidBandColor(in.BandColor) {
		return invalidf("unbekannte bandfarbe %q", in.BandColor)
	}
	if !ValidBandOpacity(in.BandOpacity) {
		return invalidf("ungültige deckkraft der tagesmarkierung %d", in.BandOpacity)
	}
	if !ValidBackgroundDim(in.BackgroundDim) {
		return invalidf("ungültige abdunklung %d", in.BackgroundDim)
	}
	if !ValidBackgroundBlur(in.BackgroundBlur) {
		return invalidf("ungültiger weichzeichner %d", in.BackgroundBlur)
	}
	if !ValidSurfaceOpacity(in.SurfaceOpacity) {
		return invalidf("ungültige flächendeckkraft %d", in.SurfaceOpacity)
	}
	if !ValidSurfaceBlur(in.SurfaceBlur) {
		return invalidf("ungültiger flächen-weichzeichner %d", in.SurfaceBlur)
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO user_settings
			(user_id, theme, overview_days, show_archived, font, reorder_mode, pattern,
			 align_weeks, band_color, band_opacity, bg_dim, bg_blur, surface_opacity,
			 surface_blur, updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
			updated_at = excluded.updated_at`,
		userID, in.Theme, in.OverviewDays, in.ShowArchived, in.Font, in.ReorderMode, in.Pattern,
		in.AlignWeeks, in.BandColor, in.BandOpacity, in.BackgroundDim, in.BackgroundBlur,
		in.SurfaceOpacity, in.SurfaceBlur, formatTime(time.Now()))
	if err != nil {
		return fmt.Errorf("einstellungen speichern: %w", err)
	}
	return nil
}
