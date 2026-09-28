package httpapi

import (
	"net/http"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/settings"
	"github.com/JulWit/habits/internal/store"
)

// habitView is the JSON representation of a habit with its statistics and
// entries.
type habitView struct {
	domain.Habit
	Stats domain.Stats `json:"stats"`
	// Entries holds the value of each day with one, keyed by date.
	Entries map[string]int `json:"entries"`
	// StreakRuns are the streak runs that reach into the sent entries, oldest
	// first.
	StreakRuns []domain.StreakRun `json:"streakRuns"`
	// Days has one domain.DayStatus per day from DaysFrom on. The client shows
	// every day from it and its value, and never judges a day itself.
	DaysFrom domain.Date `json:"daysFrom"`
	Days     string      `json:"days"`
	// HistoryStart is the first day of the habit's history.
	HistoryStart domain.Date `json:"historyStart"`
}

// stateResponse is the response of GET /api/state.
type stateResponse struct {
	User     auth.User         `json:"user"`
	Settings settings.Settings `json:"settings"`
	Today    domain.Date       `json:"today"`
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
	user := auth.MustUser(r.Context())
	var from domain.Date
	if v := r.URL.Query().Get("from"); v != "" {
		var err error
		if from, err = domain.ParseDate(v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
			return
		}
	}

	var out stateResponse
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		includeArchived := b.settings.ShowArchived
		if v := r.URL.Query().Get("archived"); v != "" {
			includeArchived = v == "1"
		}
		habits, err := tx.Habits(includeArchived)
		if err != nil {
			return err
		}
		// from can only extend the window, not shorten it.
		window := b.today.AddDays(-(entryWindowDays - 1))
		if from.IsZero() || window.Before(from) {
			from = window
		}
		// The statistics cover the whole history, so all entries are loaded;
		// only the window's are sent.
		entries, err := tx.Entries()
		if err != nil {
			return err
		}
		categories, err := tx.Categories()
		if err != nil {
			return err
		}
		archivedCount, err := tx.ArchivedCount()
		if err != nil {
			return err
		}

		views := make([]habitView, 0, len(habits))
		for _, h := range habits {
			own := entries[h.ID]
			views = append(views, viewFor(h, computeHistory(h, own, b), own, b, from))
		}
		out = stateResponse{
			User:           user,
			Settings:       b.settings,
			Today:          b.today,
			NextDayIn:      domain.UntilTomorrow(time.Now(), b.loc).Milliseconds(),
			Categories:     categories,
			ArchivedCount:  archivedCount,
			Habits:         views,
			Colors:         domain.Colors,
			Icons:          domain.HabitIcons,
			Kinds:          domain.KindDescriptors(),
			EntriesFrom:    from,
			EarliestEntry:  domain.EarliestEntry,
			ServerTimeZone: s.cfg.Location.String(),
			Build:          currentBuild(),
		}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "loading the state")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// history holds what a habit's view computes from its whole history: its
// statistics, streak runs and first day.
type history struct {
	stats domain.Stats
	runs  []domain.StreakRun
	start domain.Date
}

// computeHistory computes the history of h from all its entries.
func computeHistory(h domain.Habit, entries map[domain.Date]domain.Entry, b basis) history {
	return history{
		stats: domain.ComputeStats(h, entries, b.today, b.windowDays),
		runs:  domain.StreakRuns(h, entries, b.today),
		start: domain.HistoryStart(h, entries),
	}
}

// viewFor returns the view of a habit with its statistics hist and its
// entries from from onwards, or all of them for a zero from.
func viewFor(h domain.Habit, hist history, entries map[domain.Date]domain.Entry, b basis, from domain.Date) habitView {
	view := habitView{
		Habit:        h,
		Stats:        hist.stats,
		Entries:      map[string]int{},
		HistoryStart: hist.start,
	}
	for d, e := range entries {
		if e.Value > 0 && (from.IsZero() || !d.Before(from)) {
			view.Entries[d.String()] = e.Value
		}
	}
	// The statuses cover the sent entries up to the entry horizon. A full view
	// covers every year of the history from its 1 January, as the detail view
	// shows whole years, and at least the default window.
	daysFrom := from
	if daysFrom.IsZero() {
		firstYear := min(hist.start.Year, b.today.Year)
		daysFrom = domain.Date{Year: firstYear, Month: time.January, Day: 1}.
			Min(b.today.AddDays(-(entryWindowDays - 1)))
	}
	view.StreakRuns = []domain.StreakRun{}
	for _, run := range hist.runs {
		if from.IsZero() || !run.To.Before(from) {
			view.StreakRuns = append(view.StreakRuns, run)
		}
	}
	view.DaysFrom = daysFrom
	view.Days = domain.DayStatuses(h, entries, hist.start, daysFrom, b.today.AddDays(domain.EntryHorizonDays), b.today)
	return view
}

// fullView returns the view of a habit of the user with all its entries.
func (s *Server) fullView(tx *store.Tx, id string) (habitView, error) {
	h, err := tx.Habit(id)
	if err != nil {
		return habitView{}, err
	}
	entries, err := tx.HabitEntries(id)
	if err != nil {
		return habitView{}, err
	}
	b, err := s.basis(tx)
	if err != nil {
		return habitView{}, err
	}
	return viewFor(h, computeHistory(h, entries, b), entries, b, domain.Date{}), nil
}

// handleGetHabit returns a habit with its full history.
func (s *Server) handleGetHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	var view habitView
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		var err error
		view, err = s.fullView(tx, r.PathValue("id"))
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleCreateHabit creates a habit. Name, kind and frequency are required.
// The first schedule starts on the user's today.
func (s *Server) handleCreateHabit(w http.ResponseWriter, r *http.Request) {
	var in domain.HabitEdit
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil || in.Kind == nil || in.Frequency == nil {
		writeError(w, http.StatusBadRequest, "missing_fields", "name, kind and frequency are required")
		return
	}
	user := auth.MustUser(r.Context())

	var view habitView
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		h := domain.NewHabit(in, b.today)
		if err := tx.CreateHabit(&h); err != nil {
			return err
		}
		tx.Record(`"{name}" created`, "name", h.Name)
		view = viewFor(h, computeHistory(h, nil, b), nil, b, domain.Date{})
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "creating habit")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusCreated, view)
}

// handleUpdateHabit changes the fields of a habit given in the request body,
// as saved in the editor (domain.Habit.Apply): a new target or frequency
// starts a new schedule from today on unless it is retroactive, and a change
// of kind converts the recorded history.
func (s *Server) handleUpdateHabit(w http.ResponseWriter, r *http.Request) {
	var in domain.HabitEdit
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())
	id := r.PathValue("id")

	var view habitView
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		h, err := tx.Habit(id)
		if err != nil {
			return err
		}
		entries, err := tx.HabitEntries(id)
		if err != nil {
			return err
		}
		name := h.Name
		converted, err := h.Apply(in, entries, b.today)
		if err != nil {
			return err
		}
		if err := tx.SaveHabit(&h); err != nil {
			return err
		}
		if converted != nil {
			if err := tx.ReplaceEntries(h, converted); err != nil {
				return err
			}
			entries = converted
		}
		tx.Record(`"{name}" edited`, "name", name)
		view = viewFor(h, computeHistory(h, entries, b), entries, b, domain.Date{})
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "updating habit")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusOK, view)
}

// handleArchiveHabit archives a habit (PUT …/archived with {"archived":
// true}) or reactivates it.
func (s *Server) handleArchiveHabit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Archived *bool `json:"archived"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Archived == nil {
		writeError(w, http.StatusBadRequest, "missing_fields", "archived is required")
		return
	}
	user := auth.MustUser(r.Context())

	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		h, err := tx.Habit(r.PathValue("id"))
		if err != nil {
			return err
		}
		switch {
		case *body.Archived && h.ArchivedAt == nil:
			now := time.Now().UTC()
			h.ArchivedAt = &now
			tx.Record(`"{name}" archived`, "name", h.Name)
		case !*body.Archived && h.ArchivedAt != nil:
			h.ArchivedAt = nil
			tx.Record(`"{name}" reactivated`, "name", h.Name)
		default:
			return nil
		}
		return tx.SaveHabit(&h)
	})
	if err != nil {
		s.writeStoreError(w, err, "archiving habit")
		return
	}
	writeChange(w, changeID)
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteHabit deletes a habit with its history. Undo brings it back.
func (s *Server) handleDeleteHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		h, err := tx.Habit(r.PathValue("id"))
		if err != nil {
			return err
		}
		tx.Record(`"{name}" deleted`, "name", h.Name)
		return tx.DeleteHabit(h.ID)
	})
	if err != nil {
		s.writeStoreError(w, err, "deleting habit")
		return
	}
	writeChange(w, changeID)
	w.WriteHeader(http.StatusNoContent)
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
	_, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		return tx.ReorderHabits(body.IDs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
