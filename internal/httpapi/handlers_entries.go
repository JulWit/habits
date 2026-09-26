package httpapi

import (
	"fmt"
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// EntryHorizonDays is how far ahead of today an entry may be recorded. The
// board pages the same distance forward, so the two limits stay in step.
const EntryHorizonDays = 365

type setEntryResponse struct {
	HabitID string      `json:"habitId"`
	Date    domain.Date `json:"date"`
	Value   int         `json:"value"`
	// Previous is the value this write replaced. It is what makes undo work
	// without any client-side persistence: to undo, write Previous back.
	Previous int          `json:"previous"`
	Stats    domain.Stats `json:"stats"`
	// StreakRuns travel with every write: one tick can start, extend, join or
	// end a run, and the board has to recolour without a full reload.
	StreakRuns []domain.StreakRun `json:"streakRuns"`
}

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

	today := s.today()
	// Days ahead are allowed: a run that is already planned, a week filled in
	// before a holiday. Only the horizon is capped, so a stray date cannot
	// scatter entries into the next decade.
	if date.After(today.AddDays(EntryHorizonDays)) {
		writeError(w, http.StatusUnprocessableEntity, "Entries may be at most one year in the future")
		return
	}

	// Clearing is always allowed, so an entry left over from before the days
	// were changed can still be removed.
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
	})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	settings, err := s.store.GetSettings(r.Context(), user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	// Pointers so a request may carry one setting without resetting the others.
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

		BackgroundDim  *int `json:"backgroundDim"`
		BackgroundBlur *int `json:"backgroundBlur"`
		SurfaceOpacity *int `json:"surfaceOpacity"`
		SurfaceBlur    *int `json:"surfaceBlur"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	// Validated before anything is read or written: every rule here is about
	// the incoming value alone, so it needs no knowledge of what is stored, and
	// keeping it out of the transaction leaves the messages free to name the
	// setting they are about.
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

	// Read and write in one transaction: the dialog writes every control the
	// moment it moves, so two settings can be in flight at once and a
	// read-modify-write over two statements would drop the earlier one.
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
		setIf(&cur.OverviewDays, in.OverviewDays)
		setIf(&cur.ShowArchived, in.ShowArchived)
		setIf(&cur.BackgroundDim, in.BackgroundDim)
		setIf(&cur.BackgroundBlur, in.BackgroundBlur)
		setIf(&cur.SurfaceOpacity, in.SurfaceOpacity)
		setIf(&cur.SurfaceBlur, in.SurfaceBlur)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "saving settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// setIf applies a PATCH field: a nil pointer means the client did not mention
// the setting, which is different from setting it to its zero value.
func setIf[T any](dst *T, src *T) {
	if src != nil {
		*dst = *src
	}
}
