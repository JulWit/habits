package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// EntryHorizonDays is how many days after today an entry may be dated.
const EntryHorizonDays = 365

// EarliestEntry is the earliest date an entry may have.
var EarliestEntry = domain.Date{Year: 2000, Month: time.January, Day: 1}

// setEntryResponse is the response of PUT /api/habits/{id}/entries/{date}.
type setEntryResponse struct {
	HabitID string      `json:"habitId"`
	Date    domain.Date `json:"date"`
	Value   int         `json:"value"`
	// Previous is the replaced value; writing it back undoes the change.
	Previous   int                `json:"previous"`
	Stats      domain.Stats       `json:"stats"`
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// UpdatedAt is the habit's updated_at after the change.
	UpdatedAt time.Time `json:"updatedAt"`
}

// handleSetEntry sets the value of a habit on a date. Values other than 0 are
// only accepted on scheduled days between EarliestEntry and EntryHorizonDays
// after today; 0 clears the entry.
func (s *Server) handleSetEntry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Value int `json:"value"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	date, err := domain.ParseDate(r.PathValue("date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid date, expected YYYY-MM-DD")
		return
	}
	user := auth.MustUser(r.Context())
	habitID := r.PathValue("id")

	today := s.todayFor(r.Context(), user.ID)
	if date.After(today.AddDays(EntryHorizonDays)) {
		writeError(w, http.StatusUnprocessableEntity, "Entries may be at most one year in the future")
		return
	}
	if body.Value > 0 && date.Before(EarliestEntry) {
		// The year is passed as a string so the client does not format it as
		// a number.
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid(
			"Entries may not be dated before {year}", "year", strconv.Itoa(EarliestEntry.Year)))
		return
	}

	// Clearing an entry is allowed on any day.
	if body.Value > 0 {
		habit, err := s.store.GetHabit(r.Context(), user.ID, habitID)
		if err != nil {
			s.writeStoreError(w, err, "loading habit")
			return
		}
		if !habit.AcceptsEntry(date) {
			writeError(w, http.StatusUnprocessableEntity, "The habit is not scheduled on this day")
			return
		}
	}

	previous, err := s.store.SetEntry(r.Context(), user.ID, habitID, date, body.Value)
	if err != nil {
		s.writeStoreError(w, err, "saving entry")
		return
	}
	view, err := s.loadView(r, user.ID, habitID)
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}

	writeJSON(w, http.StatusOK, setEntryResponse{
		HabitID:    habitID,
		Date:       date,
		Value:      body.Value,
		Previous:   previous,
		Stats:      view.Stats,
		StreakRuns: view.StreakRuns,
		UpdatedAt:  view.UpdatedAt,
	})
}

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

// handleUpdateSettings updates the settings given in the request body.
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	// Nil fields are left unchanged.
	var in struct {
		Theme        *string `json:"theme"`
		OverviewDays *int    `json:"overviewDays"`
		ShowArchived *bool   `json:"showArchived"`
		Font         *string `json:"font"`
		Density      *string `json:"density"`
		ReorderMode  *string `json:"reorderMode"`
		Pattern      *string `json:"pattern"`
		AlignWeeks   *bool   `json:"alignWeeks"`
		BandColor    *string `json:"bandColor"`
		BandOpacity  *int    `json:"bandOpacity"`
		ShowBand     *bool   `json:"showBand"`

		BandFillOpacity *int `json:"bandFillOpacity"`

		BackgroundDim  *int `json:"backgroundDim"`
		BackgroundBlur *int `json:"backgroundBlur"`
		SurfaceOpacity *int `json:"surfaceOpacity"`
		SurfaceBlur    *int `json:"surfaceBlur"`

		Language *string `json:"language"`
		TimeZone *string `json:"timeZone"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	if in.Theme != nil && !store.ValidTheme(*in.Theme) {
		writeError(w, http.StatusUnprocessableEntity, "theme must be system, light or dark")
		return
	}
	if in.Font != nil && !store.ValidFont(*in.Font) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("font must be one of %v", store.Fonts))
		return
	}
	if in.Density != nil && !store.ValidDensity(*in.Density) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("density must be one of %v", store.Densities))
		return
	}
	if in.ReorderMode != nil && !store.ValidReorderMode(*in.ReorderMode) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("reorder mode must be one of %v", store.ReorderModes))
		return
	}
	if in.Pattern != nil && !store.ValidPattern(*in.Pattern) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("background pattern must be one of %v", store.Patterns))
		return
	}
	if in.BandColor != nil && !store.ValidBandColor(*in.BandColor) {
		writeError(w, http.StatusUnprocessableEntity,
			"band colour must be neutral or one of the habit colours")
		return
	}
	if in.BandOpacity != nil && !store.ValidBandOpacity(*in.BandOpacity) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("band opacity must be between 0 and %d",
				store.MaxBandOpacity))
		return
	}
	if in.BandFillOpacity != nil && !store.ValidBandOpacity(*in.BandFillOpacity) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("band fill opacity must be between 0 and %d",
				store.MaxBandOpacity))
		return
	}
	if in.OverviewDays != nil && !store.ValidOverviewDays(*in.OverviewDays) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("overviewDays must be 0 (automatic) or between 3 and %d",
				store.MaxOverviewDays))
		return
	}
	if in.BackgroundDim != nil && !store.ValidBackgroundDim(*in.BackgroundDim) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("background dim must be between %d and %d",
				store.MinBackgroundDim, store.MaxBackgroundDim))
		return
	}
	if in.BackgroundBlur != nil && !store.ValidBackgroundBlur(*in.BackgroundBlur) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("background blur must be between 0 and %d", store.MaxBackgroundBlur))
		return
	}
	if in.SurfaceOpacity != nil && !store.ValidSurfaceOpacity(*in.SurfaceOpacity) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("surface opacity must be between %d and %d",
				store.MinSurfaceOpacity, store.MaxSurfaceOpacity))
		return
	}
	if in.SurfaceBlur != nil && !store.ValidSurfaceBlur(*in.SurfaceBlur) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("surface blur must be between 0 and %d",
				store.MaxSurfaceBlur))
		return
	}
	if in.Language != nil && !store.ValidLanguage(*in.Language) {
		writeError(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("language must be one of %v", store.Languages))
		return
	}
	if in.TimeZone != nil && !store.ValidTimeZone(*in.TimeZone) {
		writeProblem(w, http.StatusUnprocessableEntity,
			domain.Invalid(`unknown time zone "{zone}"`, "zone", *in.TimeZone))
		return
	}

	settings, err := s.store.UpdateSettings(r.Context(), user.ID, func(cur *store.Settings) error {
		setIf(&cur.Theme, in.Theme)
		setIf(&cur.Font, in.Font)
		setIf(&cur.Density, in.Density)
		setIf(&cur.ReorderMode, in.ReorderMode)
		setIf(&cur.Pattern, in.Pattern)
		setIf(&cur.AlignWeeks, in.AlignWeeks)
		setIf(&cur.BandColor, in.BandColor)
		setIf(&cur.BandOpacity, in.BandOpacity)
		setIf(&cur.ShowBand, in.ShowBand)
		setIf(&cur.BandFillOpacity, in.BandFillOpacity)
		setIf(&cur.OverviewDays, in.OverviewDays)
		setIf(&cur.ShowArchived, in.ShowArchived)
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
