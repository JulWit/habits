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
func (s *server) handleGetSettings(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	var prefs settings.Settings
	err := s.store.View(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		prefs, err = tx.Settings(ctx)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	s.writeJSON(w, http.StatusOK, prefs)
}

// handleUpdateSettings updates the settings given in the request body; the
// others are left unchanged. The store validates the result.
func (s *server) handleUpdateSettings(w http.ResponseWriter, r *http.Request, user auth.User) {
	var patch json.RawMessage
	if !s.decodeJSON(w, r, &patch) {
		return
	}
	// Unknown settings and values of the wrong type are rejected before the
	// patch is applied.
	var probe settings.Settings
	if err := decodeSettings(patch, &probe); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body: "+err.Error())
		return
	}
	ctx := r.Context()

	var prefs settings.Settings
	_, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		if prefs, err = tx.Settings(ctx); err != nil {
			return err
		}
		// Decoding onto the current settings changes only the fields in the
		// patch.
		if err := decodeSettings(patch, &prefs); err != nil {
			return err
		}
		return tx.SaveSettings(ctx, prefs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	s.writeJSON(w, http.StatusOK, prefs)
}

// decodeSettings decodes a settings patch onto dst, rejecting unknown fields.
func decodeSettings(patch []byte, dst *settings.Settings) error {
	dec := json.NewDecoder(bytes.NewReader(patch))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
