package httpapi

import (
	"net/http"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// habitView is the JSON representation of a habit with its statistics and
// entries.
type habitView struct {
	domain.Habit
	Stats   domain.Stats   `json:"stats"`
	Entries map[string]int `json:"entries"`
	// StreakRuns are the streak runs that reach into the sent entries, oldest
	// first.
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// Schedules are all versions of target and frequency, oldest first; the last
	// one is the current TargetValue and Frequency.
	Schedules []domain.Schedule `json:"schedules"`
}

// stateResponse is the response of GET /api/state.
type stateResponse struct {
	User       auth.User         `json:"user"`
	Settings   store.Settings    `json:"settings"`
	Today      domain.Date       `json:"today"`
	Categories []domain.Category `json:"categories"`
	// ArchivedCount is the number of archived habits, even if they are not
	// included in Habits.
	ArchivedCount int         `json:"archivedCount"`
	Habits        []habitView `json:"habits"`
	Colors        []string    `json:"colors"`
	// Icons are the valid habit icons (domain.HabitIcons).
	Icons []string `json:"icons"`
	// Kinds describes the value range of each habit kind.
	Kinds map[domain.Kind]domain.KindInfo `json:"kinds"`
	// BlurAtFull is the blur radius in pixels at 100 percent.
	BlurAtFull int `json:"blurAtFull"`
	// EntriesFrom is the first day covered by the sent entries.
	EntriesFrom domain.Date `json:"entriesFrom"`
	// EarliestEntry is the earliest date an entry may have.
	EarliestEntry domain.Date `json:"earliestEntry"`
	// BackgroundVersion is the ETag of the background image, or "" if there is
	// none.
	BackgroundVersion string `json:"backgroundVersion"`
	// ServerTimeZone is the server's default time zone (HABITS_TZ).
	ServerTimeZone string `json:"serverTimeZone"`
	// Build describes the running binary.
	Build buildInfo `json:"build"`
}

// entryWindowDays is the default number of days of entries sent by
// GET /api/state.
const entryWindowDays = 200

// handleState returns all data the client needs on startup. The query
// parameter archived=1|0 overrides the ShowArchived setting; from=YYYY-MM-DD
// extends the entry window into the past.
func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUser(ctx)

	settings, err := s.store.GetSettings(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	includeArchived := settings.ShowArchived
	if v := r.URL.Query().Get("archived"); v != "" {
		includeArchived = v == "1"
	}

	habits, err := s.store.ListHabits(ctx, user.ID, includeArchived)
	if err != nil {
		s.writeStoreError(w, err, "loading habits")
		return
	}
	entries, err := s.store.EntriesForUser(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading entries")
		return
	}
	categories, err := s.store.ListCategories(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading categories")
		return
	}
	archivedCount, err := s.store.CountArchivedHabits(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "counting archived habits")
		return
	}

	today := domain.Today(s.location(settings))
	from := today.AddDays(-(entryWindowDays - 1))
	if v := r.URL.Query().Get("from"); v != "" {
		asked, err := domain.ParseDate(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid date, expected YYYY-MM-DD")
			return
		}
		// from can only extend the window, not shorten it.
		if asked.Before(from) {
			from = asked
		}
	}
	views := make([]habitView, 0, len(habits))
	for _, h := range habits {
		views = append(views, s.viewFor(h, entries[h.ID], today, from))
	}

	bgVersion, err := s.store.BackgroundVersion(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading background version")
		return
	}

	writeJSON(w, http.StatusOK, stateResponse{
		User:              user,
		Settings:          settings,
		Today:             today,
		Categories:        categories,
		ArchivedCount:     archivedCount,
		Habits:            views,
		Colors:            domain.DefaultColors,
		Icons:             domain.HabitIcons,
		Kinds:             domain.KindDescriptors(),
		BlurAtFull:        store.BackgroundBlurAtFull,
		EntriesFrom:       from,
		EarliestEntry:     EarliestEntry,
		BackgroundVersion: bgVersion,
		ServerTimeZone:    s.cfg.Location.String(),
		Build:             currentBuild(),
	})
}

// viewFor returns the view of a habit. Statistics are computed from all
// entries, but only entries and streak runs from from onwards are included. A
// zero from includes everything.
func (s *Server) viewFor(h domain.Habit, all store.EntryMap, today, from domain.Date) habitView {
	windowed := make(map[string]int, len(all))
	for d, v := range all {
		if from.IsZero() || !d.Before(from) {
			windowed[d.String()] = v
		}
	}
	runs := domain.StreakRuns(h, all, today)
	visible := make([]domain.StreakRun, 0, len(runs))
	for _, run := range runs {
		if from.IsZero() || !run.To.Before(from) {
			visible = append(visible, run)
		}
	}
	return habitView{
		Habit:      h,
		Stats:      domain.ComputeStats(h, all, today, domain.DefaultRateWindowDays),
		Entries:    windowed,
		StreakRuns: visible,
		Schedules:  h.Schedules(),
	}
}

// loadView returns the view of a habit with all its entries.
func (s *Server) loadView(r *http.Request, userID, habitID string) (habitView, error) {
	h, err := s.store.GetHabit(r.Context(), userID, habitID)
	if err != nil {
		return habitView{}, err
	}
	entries, err := s.store.EntriesForHabit(r.Context(), userID, habitID)
	if err != nil {
		return habitView{}, err
	}
	return s.viewFor(h, entries, s.todayFor(r.Context(), userID), domain.Date{}), nil
}

// handleGetHabit returns a single habit.
func (s *Server) handleGetHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	view, err := s.loadView(r, user.ID, r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// habitInput is the request body for creating and updating a habit. Nil fields
// are left unchanged.
type habitInput struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
	// Icon "" removes the icon.
	Icon *string      `json:"icon"`
	Kind *domain.Kind `json:"kind"`
	// CategoryID "" removes the habit from its category.
	CategoryID  *string           `json:"categoryId"`
	TargetValue *int              `json:"targetValue"`
	StepValue   *int              `json:"stepValue"`
	Unit        *string           `json:"unit"`
	Frequency   *domain.Frequency `json:"frequency"`
	Archived    *bool             `json:"archived"`
	// Retroactive applies a new target or frequency to the past days as well,
	// instead of from today on.
	Retroactive bool `json:"retroactive"`
	// Schedules replaces the whole schedule history, e.g. to undo an edit. It
	// cannot be combined with TargetValue and Frequency.
	Schedules []domain.Schedule `json:"schedules"`
}

// applyTo copies the set fields of in to h.
func (in habitInput) applyTo(h *domain.Habit) {
	setIf(&h.Name, in.Name)
	setIf(&h.Color, in.Color)
	setIf(&h.Icon, in.Icon)
	setIf(&h.Kind, in.Kind)
	setIf(&h.CategoryID, in.CategoryID)
	setIf(&h.TargetValue, in.TargetValue)
	setIf(&h.StepValue, in.StepValue)
	setIf(&h.Unit, in.Unit)
	setIf(&h.Frequency, in.Frequency)
	if in.Archived != nil {
		switch {
		case *in.Archived && h.ArchivedAt == nil:
			now := time.Now().UTC()
			h.ArchivedAt = &now
		case !*in.Archived:
			h.ArchivedAt = nil
		}
	}
}

// handleCreateHabit creates a habit. Name, kind and frequency are required.
func (s *Server) handleCreateHabit(w http.ResponseWriter, r *http.Request) {
	var in habitInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil || in.Kind == nil || in.Frequency == nil {
		writeError(w, http.StatusBadRequest, "name, kind and frequency are required")
		return
	}

	user := auth.MustUser(r.Context())
	today := s.todayFor(r.Context(), user.ID)
	// The first schedule starts on the user's today, which may differ from the
	// UTC day of the creation time.
	h := domain.Habit{Kind: domain.KindCheck, TargetValue: 1, Color: domain.DefaultColors[0], Since: today}
	in.applyTo(&h)
	if len(in.Schedules) > 0 {
		writeError(w, http.StatusBadRequest, "schedules cannot be set on a new habit")
		return
	}

	if err := s.store.CreateHabit(r.Context(), user.ID, &h); err != nil {
		s.writeStoreError(w, err, "creating habit")
		return
	}
	writeJSON(w, http.StatusCreated, s.viewFor(h, nil, today, domain.Date{}))
}

// handleUpdateHabit updates the fields of a habit given in the request body.
func (s *Server) handleUpdateHabit(w http.ResponseWriter, r *http.Request) {
	var in habitInput
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	h, err := s.store.GetHabit(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	if err := s.applyUpdate(r, user.ID, in, &h); err != nil {
		s.writeStoreError(w, err, "updating habit")
		return
	}
	if err := s.store.UpdateHabit(r.Context(), user.ID, &h); err != nil {
		s.writeStoreError(w, err, "updating habit")
		return
	}
	view, err := s.loadView(r, user.ID, h.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleDeleteHabit soft-deletes a habit.
func (s *Server) handleDeleteHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.SoftDeleteHabit(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeStoreError(w, err, "deleting habit")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// handleRestoreHabit restores a soft-deleted habit.
func (s *Server) handleRestoreHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	id := r.PathValue("id")

	if err := s.store.RestoreHabit(r.Context(), user.ID, id); err != nil {
		s.writeStoreError(w, err, "restoring habit")
		return
	}
	view, err := s.loadView(r, user.ID, id)
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleReorderHabits sets the order of the habits to the given IDs.
func (s *Server) handleReorderHabits(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user := auth.MustUser(r.Context())
	if err := s.store.ReorderHabits(r.Context(), user.ID, body.IDs); err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// applyUpdate copies the set fields of in to h. A new target or frequency
// starts a new schedule version from today on, unless in.Retroactive is set.
// A change of kind resets the history, as it is only allowed before the first
// entry.
func (s *Server) applyUpdate(r *http.Request, userID string, in habitInput, h *domain.Habit) error {
	prev, kind := h.Current(), h.Kind
	in.applyTo(h)

	switch {
	case in.Schedules != nil:
		if in.TargetValue != nil || in.Frequency != nil {
			return domain.Invalid("schedules cannot be combined with targetValue or frequency")
		}
		if len(in.Schedules) == 0 {
			return domain.Invalid("at least one schedule is required")
		}
		h.SetSchedules(in.Schedules)
		return nil
	case in.TargetValue != nil || in.Frequency != nil || h.Kind != kind:
		today := s.todayFor(r.Context(), userID)
		return h.Reschedule(prev, today, in.Retroactive || h.Kind != kind)
	}
	return nil
}
