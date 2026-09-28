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
	Stats domain.Stats `json:"stats"`
	// Entries holds the value of each day with one, Skipped the skipped days
	// and Notes the notes, each keyed by date.
	Entries map[string]int    `json:"entries"`
	Skipped map[string]bool   `json:"skipped"`
	Notes   map[string]string `json:"notes"`
	// StreakRuns are the streak runs that reach into the sent entries, oldest
	// first.
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// Due has one character per day from DueFrom on: '1' if the habit is due
	// on that day, '0' if not. The client shows the schedule from it and does
	// not evaluate the frequency rules itself.
	DueFrom domain.Date `json:"dueFrom"`
	Due     string      `json:"due"`
}

// stateResponse is the response of GET /api/state.
type stateResponse struct {
	User     auth.User      `json:"user"`
	Settings store.Settings `json:"settings"`
	Today    domain.Date    `json:"today"`
	// NextDayIn is the number of milliseconds until the next day begins in
	// the user's time zone. The client reloads the state then.
	NextDayIn  int64             `json:"nextDayIn"`
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
	// EntriesFrom is the first day covered by the sent entries.
	EntriesFrom domain.Date `json:"entriesFrom"`
	// EarliestEntry is the earliest date an entry may have.
	EarliestEntry domain.Date `json:"earliestEntry"`
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

	loc := s.location(settings)
	now := time.Now()
	today := domain.DateFromTime(now.In(loc))
	from := today.AddDays(-(entryWindowDays - 1))
	if v := r.URL.Query().Get("from"); v != "" {
		asked, err := domain.ParseDate(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
			return
		}
		// from can only extend the window, not shorten it.
		if asked.Before(from) {
			from = asked
		}
	}
	views := make([]habitView, 0, len(habits))
	for _, h := range habits {
		views = append(views, s.viewFor(h, entries[h.ID], today, from, settings.RateWindowDays()))
	}

	writeJSON(w, http.StatusOK, stateResponse{
		User:           user,
		Settings:       settings,
		Today:          today,
		NextDayIn:      domain.UntilTomorrow(now, loc).Milliseconds(),
		Categories:     categories,
		ArchivedCount:  archivedCount,
		Habits:         views,
		Colors:         domain.Colors,
		Icons:          domain.HabitIcons,
		Kinds:          domain.KindDescriptors(),
		EntriesFrom:    from,
		EarliestEntry:  EarliestEntry,
		ServerTimeZone: s.cfg.Location.String(),
		Build:          currentBuild(),
	})
}

// viewFor returns the view of a habit. Statistics are computed from all
// entries, with the completion rate over windowDays (see domain.ComputeStats),
// but only entries and streak runs from from onwards are included. A zero
// from includes everything.
func (s *Server) viewFor(h domain.Habit, all map[domain.Date]domain.Entry, today, from domain.Date, windowDays int) habitView {
	view := habitView{
		Habit:   h,
		Stats:   domain.ComputeStats(h, all, today, windowDays),
		Entries: map[string]int{},
		Skipped: map[string]bool{},
		Notes:   map[string]string{},
	}
	for d, e := range all {
		if !from.IsZero() && d.Before(from) {
			continue
		}
		key := d.String()
		if e.Value > 0 {
			view.Entries[key] = e.Value
		}
		if e.Skipped {
			view.Skipped[key] = true
		}
		if e.Note != "" {
			view.Notes[key] = e.Note
		}
	}
	// The due days cover the sent entries up to the entry horizon. A full view
	// covers the whole history and at least this year and the default window.
	dueFrom := from
	if dueFrom.IsZero() {
		dueFrom = domain.HistoryStart(h, all).
			Min(domain.Date{Year: today.Year, Month: time.January, Day: 1}).
			Min(today.AddDays(-(entryWindowDays - 1)))
	}
	view.StreakRuns = []domain.StreakRun{}
	for _, run := range domain.StreakRuns(h, all, today) {
		if from.IsZero() || !run.To.Before(from) {
			view.StreakRuns = append(view.StreakRuns, run)
		}
	}
	view.DueFrom = dueFrom
	view.Due = domain.DueDays(h, dueFrom, today.AddDays(EntryHorizonDays))
	return view
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
	today, windowDays := s.statsBasis(r.Context(), userID)
	return s.viewFor(h, entries, today, domain.Date{}, windowDays), nil
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
	CategoryID *string `json:"categoryId"`
	StepValue  *int    `json:"stepValue"`
	Unit       *string `json:"unit"`
	Archived   *bool   `json:"archived"`
	// TargetValue, TargetType and Frequency change the current schedule, from
	// today on.
	TargetValue *int               `json:"targetValue"`
	TargetType  *domain.TargetType `json:"targetType"`
	Frequency   *domain.Frequency  `json:"frequency"`
	// Retroactive applies a new target or frequency to the past days as well,
	// instead of from today on.
	Retroactive bool `json:"retroactive"`
	// Schedules replaces the whole schedule history, e.g. to undo an edit. It
	// cannot be combined with TargetValue, TargetType and Frequency.
	Schedules []domain.Schedule `json:"schedules"`
}

// changesSchedule reports whether in changes the current schedule.
func (in habitInput) changesSchedule() bool {
	return in.TargetValue != nil || in.TargetType != nil || in.Frequency != nil
}

// applyTo copies the set fields of in to h, except those of the schedule.
func (in habitInput) applyTo(h *domain.Habit) {
	setIf(&h.Name, in.Name)
	setIf(&h.Color, in.Color)
	setIf(&h.Icon, in.Icon)
	setIf(&h.Kind, in.Kind)
	setIf(&h.CategoryID, in.CategoryID)
	setIf(&h.StepValue, in.StepValue)
	setIf(&h.Unit, in.Unit)
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
		writeError(w, http.StatusBadRequest, "missing_fields", "name, kind and frequency are required")
		return
	}
	if in.Schedules != nil {
		writeError(w, http.StatusBadRequest, "schedules_on_create", "schedules cannot be set on a new habit")
		return
	}

	user := auth.MustUser(r.Context())
	today, windowDays := s.statsBasis(r.Context(), user.ID)
	var h domain.Habit
	in.applyTo(&h)
	first := domain.Schedule{From: today, TargetValue: 1, Frequency: *in.Frequency}
	setIf(&first.TargetValue, in.TargetValue)
	setIf(&first.TargetType, in.TargetType)
	// The first schedule starts on the user's today, which may differ from the
	// UTC day of the creation time.
	h.Schedules = []domain.Schedule{first}

	if err := s.store.CreateHabit(r.Context(), user.ID, &h); err != nil {
		s.writeStoreError(w, err, "creating habit")
		return
	}
	writeJSON(w, http.StatusCreated, s.viewFor(h, nil, today, domain.Date{}, windowDays))
}

// handleUpdateHabit updates the fields of a habit given in the request body.
//
// A new target or frequency starts a new schedule from today on, unless
// Retroactive is set. A change of kind converts the recorded history
// (domain.ConvertKind).
func (s *Server) handleUpdateHabit(w http.ResponseWriter, r *http.Request) {
	var in habitInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Schedules != nil && in.changesSchedule() {
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("schedules_with_target",
			"schedules cannot be combined with targetValue, targetType or frequency"))
		return
	}
	ctx := r.Context()
	user := auth.MustUser(ctx)

	h, err := s.store.GetHabit(ctx, user.ID, r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	before := h
	in.applyTo(&h)

	// nil keeps the recorded entries.
	var converted map[domain.Date]domain.Entry
	if h.Kind != before.Kind {
		entries, err := s.store.EntriesForHabit(ctx, user.ID, h.ID)
		if err != nil {
			s.writeStoreError(w, err, "loading entries")
			return
		}
		// Ticked days get the new target: the one sent, or for undo the one of
		// the last schedule sent.
		target := h.Current().TargetValue
		setIf(&target, in.TargetValue)
		if len(in.Schedules) > 0 {
			target = in.Schedules[len(in.Schedules)-1].TargetValue
		}
		h.Schedules, converted = domain.ConvertKind(before, entries, h.Kind, target)
		// The step and unit of the old kind mean nothing for the new one.
		if in.StepValue == nil {
			h.StepValue = 0
		}
		if in.Unit == nil {
			h.Unit = ""
		}
	}

	switch {
	case in.Schedules != nil:
		h.Schedules = in.Schedules
	case in.changesSchedule():
		rules := h.Current()
		setIf(&rules.TargetValue, in.TargetValue)
		setIf(&rules.TargetType, in.TargetType)
		setIf(&rules.Frequency, in.Frequency)
		err = h.Reschedule(rules, s.todayFor(ctx, user.ID), in.Retroactive)
	}
	if err == nil {
		err = s.store.UpdateHabit(ctx, user.ID, &h, converted)
	}
	if err != nil {
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
