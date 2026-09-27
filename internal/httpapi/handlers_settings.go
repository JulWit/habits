package httpapi

import (
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

// handleUpdateSettings updates the settings given in the request body. The
// store validates the result.
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	// Nil fields are left unchanged.
	var in struct {
		Theme           *string `json:"theme"`
		OverviewDays    *int    `json:"overviewDays"`
		ShowArchived    *bool   `json:"showArchived"`
		Font            *string `json:"font"`
		Density         *string `json:"density"`
		ReorderMode     *string `json:"reorderMode"`
		Pattern         *string `json:"pattern"`
		AlignWeeks      *bool   `json:"alignWeeks"`
		BandColor       *string `json:"bandColor"`
		BandOpacity     *int    `json:"bandOpacity"`
		BandFillOpacity *int    `json:"bandFillOpacity"`
		ShowBand        *bool   `json:"showBand"`
		BackgroundDim   *int    `json:"backgroundDim"`
		BackgroundBlur  *int    `json:"backgroundBlur"`
		SurfaceOpacity  *int    `json:"surfaceOpacity"`
		SurfaceBlur     *int    `json:"surfaceBlur"`
		Language        *string `json:"language"`
		TimeZone        *string `json:"timeZone"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	settings, err := s.store.UpdateSettings(r.Context(), user.ID, func(cur *store.Settings) error {
		setIf(&cur.Theme, in.Theme)
		setIf(&cur.OverviewDays, in.OverviewDays)
		setIf(&cur.ShowArchived, in.ShowArchived)
		setIf(&cur.Font, in.Font)
		setIf(&cur.Density, in.Density)
		setIf(&cur.ReorderMode, in.ReorderMode)
		setIf(&cur.Pattern, in.Pattern)
		setIf(&cur.AlignWeeks, in.AlignWeeks)
		setIf(&cur.BandColor, in.BandColor)
		setIf(&cur.BandOpacity, in.BandOpacity)
		setIf(&cur.BandFillOpacity, in.BandFillOpacity)
		setIf(&cur.ShowBand, in.ShowBand)
		setIf(&cur.BackgroundDim, in.BackgroundDim)
		setIf(&cur.BackgroundBlur, in.BackgroundBlur)
		setIf(&cur.SurfaceOpacity, in.SurfaceOpacity)
		setIf(&cur.SurfaceBlur, in.SurfaceBlur)
		setIf(&cur.Language, in.Language)
		setIf(&cur.TimeZone, in.TimeZone)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// setIf sets *dst to *src unless src is nil.
func setIf[T any](dst *T, src *T) {
	if src != nil {
		*dst = *src
	}
}
