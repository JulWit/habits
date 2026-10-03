package httpapi

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
)

// manifestDescriptions holds the manifest's description per UI language
// besides English, the one of manifest.webmanifest.
var manifestDescriptions = map[string]string{
	"de": "Gewohnheiten verfolgen — täglich, an bestimmten Wochentagen oder alle paar Tage.",
}

// Colours of the system bars and the splash screen, matching --bg in base.css.
const (
	lightBarColor = "#e6e8ec"
	darkBarColor  = "#0f0f0f"
)

// loadManifest reads the web app manifest from webFS.
func loadManifest(webFS fs.FS) (map[string]any, error) {
	raw, err := fs.ReadFile(webFS, "manifest.webmanifest")
	if err != nil {
		return nil, fmt.Errorf("loading manifest: %w", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}
	return m, nil
}

// handleManifest serves the manifest with the colours of the user's theme, so
// an installed app starts with system bars in that theme, and in the user's
// language.
//
// The manifest cannot follow the colour scheme, so for the "system" theme it
// uses the scheme app.js stores in the color_scheme cookie, light without
// one. Chrome then follows the theme-color entries in index.html; Firefox on
// Android uses the manifest only.
func (s *server) handleManifest(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	settings := s.settingsOf(ctx, user.ID)
	dark := false
	if settings.Theme != "system" {
		dark = settings.Theme == "dark"
	} else if c, err := r.Cookie("color_scheme"); err == nil {
		dark = c.Value == "dark"
	}
	color := lightBarColor
	if dark {
		color = darkBarColor
	}

	m := maps.Clone(s.manifest)
	m["theme_color"] = color
	m["background_color"] = color
	lang := resolveLanguage(settings.Language, r.Header.Get("Accept-Language"))
	m["lang"] = lang
	if description, ok := manifestDescriptions[lang]; ok {
		m["description"] = description
	}

	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(m); err != nil {
		s.logFor(ctx).Error("writing manifest failed", "error", err)
	}
}
