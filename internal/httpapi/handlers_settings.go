package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/settings"
	"github.com/JulWit/habits/internal/store"
)

// handleGetSettings returns the user's settings.
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	var prefs settings.Settings
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		var err error
		prefs, err = tx.Settings()
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
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
	var probe settings.Settings
	if err := decodeSettings(patch, &probe); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body: "+err.Error())
		return
	}
	user := auth.MustUser(r.Context())

	var prefs settings.Settings
	_, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		var err error
		if prefs, err = tx.Settings(); err != nil {
			return err
		}
		// Decoding onto the current settings changes only the fields in the
		// patch.
		if err := decodeSettings(patch, &prefs); err != nil {
			return err
		}
		return tx.SaveSettings(prefs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

// decodeSettings decodes a settings patch onto dst, rejecting unknown fields.
func decodeSettings(patch []byte, dst *settings.Settings) error {
	dec := json.NewDecoder(bytes.NewReader(patch))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
