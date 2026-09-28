package httpapi

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
)

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
// an installed app starts with system bars in that theme.
//
// The manifest cannot follow the colour scheme, so for the "system" theme it
// uses the scheme app.js stores in the color_scheme cookie, light without
// one. Chrome then follows the theme-color entries in index.html; Firefox on
// Android uses the manifest only.
func (s *Server) handleManifest(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	dark := false
	if settings := s.settingsOf(r.Context(), user.ID); settings.Theme != "system" {
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

	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(m); err != nil {
		s.log.Error("writing manifest failed", "error", err)
	}
}
