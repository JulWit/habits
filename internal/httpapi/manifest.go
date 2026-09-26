package httpapi

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
)

// Colours of the system bars and the splash screen per theme, matching --bg in
// base.css. The manifest cannot follow the colour scheme, so "system" uses the
// light colour; the theme-color entries in index.html then take over.
var manifestColors = map[string]string{
	"light":  "#e6e8ec",
	"dark":   "#0f0f0f",
	"system": "#e6e8ec",
}

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
func (s *Server) handleManifest(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	theme := "system"
	if settings, err := s.store.GetSettings(r.Context(), user.ID); err == nil {
		theme = settings.Theme
	}
	color, ok := manifestColors[theme]
	if !ok {
		color = manifestColors["system"]
	}

	m := make(map[string]any, len(s.manifest))
	for k, v := range s.manifest {
		m[k] = v
	}
	m["theme_color"] = color
	m["background_color"] = color

	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(m); err != nil {
		s.log.Error("writing manifest failed", "error", err)
	}
}
