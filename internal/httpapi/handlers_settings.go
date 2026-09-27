package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/store"
)

// handleGetSettings returns the user's settings.
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	settings, err := s.store.GetSettings(r.Context(), user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// handleUpdateSettings updates the settings given in the request body; the
// others are left unchanged. The store validates the result.
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var patch json.RawMessage
	if !decodeJSON(w, r, &patch) {
		return
	}
	// Unknown settings and values of the wrong type are rejected before the
	// patch is applied.
	var probe store.Settings
	if err := decodeSettings(patch, &probe); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body: "+err.Error())
		return
	}
	user := auth.MustUser(r.Context())

	settings, err := s.store.UpdateSettings(r.Context(), user.ID, func(cur *store.Settings) error {
		// Decoding onto the current settings changes only the fields in the
		// patch.
		return decodeSettings(patch, cur)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// decodeSettings decodes a settings patch onto dst, rejecting unknown fields.
func decodeSettings(patch []byte, dst *store.Settings) error {
	dec := json.NewDecoder(bytes.NewReader(patch))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
