package httpapi

import (
	"context"
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
	// Habits holds all habits, archived ones included; the client hides
	// those unless the ShowArchived setting is on.
	Habits []habitView `json:"habits"`
	Colors []string    `json:"colors"`
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
	// Options are the choices of the enumerated settings.
	Options map[string][]settings.Option `json:"options"`
}

// entryWindowDays is the default number of days of entries sent by
// GET /api/state.
const entryWindowDays = 200

// handleState returns all data the client needs on startup. The query
// parameter from=YYYY-MM-DD extends the entry window into the past.
func (s *server) handleState(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	var from domain.Date
	if v := r.URL.Query().Get("from"); v != "" {
		var err error
		if from, err = domain.ParseDate(v); err != nil {
			s.writeError(w, http.StatusBadRequest, "invalid_date", "Invalid date, expected YYYY-MM-DD")
			return
		}
	}

	var (
		b          basis
		habits     []domain.Habit
		entries    map[string]map[domain.Date]domain.Entry
		categories []domain.Category
	)
	err := s.store.View(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		if b, err = s.basis(ctx, tx); err != nil {
			return err
		}
		if habits, err = tx.Habits(ctx); err != nil {
			return err
		}
		// The statistics cover the whole history, so all entries are loaded;
		// only the window's are sent.
		if entries, err = tx.Entries(ctx); err != nil {
			return err
		}
		categories, err = tx.Categories(ctx)
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading the state")
		return
	}

	// The views are computed after the transaction (see habitData). from can
	// only extend the window, not shorten it.
	window := b.today.AddDays(-(entryWindowDays - 1))
	if from.IsZero() || window.Before(from) {
		from = window
	}
	views := make([]habitView, 0, len(habits))
	for _, h := range habits {
		own := entries[h.ID]
		views = append(views, viewFor(h, computeHistory(h, own, b), own, b, from))
	}
	s.writeJSON(w, http.StatusOK, stateResponse{
		User:           user,
		Settings:       b.settings,
		Today:          b.today,
		NextDayIn:      domain.UntilTomorrow(time.Now(), b.loc).Milliseconds(),
		Categories:     categories,
		Habits:         views,
		Colors:         domain.Colors(),
		Icons:          domain.HabitIcons(),
		Kinds:          domain.KindDescriptors(),
		EntriesFrom:    from,
		EarliestEntry:  domain.EarliestEntry,
		ServerTimeZone: s.cfg.Location.String(),
		Build:          currentBuild(),
		Options:        settings.Options(),
	})
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

// habitData is what the view of a habit is computed from. Handlers load it in
// their transaction and compute the view after it: the statistics walk the
// habit's whole history day by day, and the store has a single connection,
// which every other request waits for while a transaction holds it.
type habitData struct {
	habit   domain.Habit
	entries map[domain.Date]domain.Entry
	basis   basis
}

// loadHabit loads a habit of the user with all its entries, and the basis of
// its statistics.
func (s *server) loadHabit(ctx context.Context, tx *store.Tx, id string) (habitData, error) {
	h, err := tx.Habit(ctx, id)
	if err != nil {
		return habitData{}, err
	}
	entries, err := tx.HabitEntries(ctx, id)
	if err != nil {
		return habitData{}, err
	}
	b, err := s.basis(ctx, tx)
	if err != nil {
		return habitData{}, err
	}
	return habitData{habit: h, entries: entries, basis: b}, nil
}

// fullView returns the view of the habit with all its entries.
func (d habitData) fullView() habitView {
	return viewFor(d.habit, computeHistory(d.habit, d.entries, d.basis), d.entries, d.basis, domain.Date{})
}

// handleGetHabit returns a habit with its full history.
func (s *server) handleGetHabit(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	var data habitData
	err := s.store.View(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		data, err = s.loadHabit(ctx, tx, r.PathValue("id"))
		return err
	})
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	s.writeJSON(w, http.StatusOK, data.fullView())
}

// handleCreateHabit creates a habit. Name, kind and frequency are required.
// The first schedule starts on the user's today.
func (s *server) handleCreateHabit(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in domain.HabitEdit
	if !s.decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil || in.Kind == nil || in.Frequency == nil {
		s.writeError(w, http.StatusBadRequest, "missing_fields", "name, kind and frequency are required")
		return
	}
	ctx := r.Context()

	var data habitData
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		b, err := s.basis(ctx, tx)
		if err != nil {
			return err
		}
		h := domain.NewHabit(in, b.today)
		if in.Archived != nil {
			h.SetArchived(*in.Archived, tx.Now())
		}
		if err := tx.CreateHabit(ctx, &h); err != nil {
			return err
		}
		tx.Record(`"{name}" created`, "name", h.Name)
		data = habitData{habit: h, basis: b}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "creating habit")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusCreated, data.fullView())
}

// handleUpdateHabit changes the fields of a habit given in the request body,
// as saved in the editor (domain.Habit.Apply): a new target or frequency
// starts a new schedule from today on unless it is retroactive, and a change
// of kind converts the recorded history. "archived" archives the habit or
// reactivates it; the undo step is named after that then.
func (s *server) handleUpdateHabit(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in domain.HabitEdit
	if !s.decodeJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	id := r.PathValue("id")

	var data habitData
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		b, err := s.basis(ctx, tx)
		if err != nil {
			return err
		}
		h, err := tx.Habit(ctx, id)
		if err != nil {
			return err
		}
		entries, err := tx.HabitEntries(ctx, id)
		if err != nil {
			return err
		}
		name := h.Name
		converted, err := h.Apply(in, entries, b.today)
		if err != nil {
			return err
		}
		switch {
		case in.Archived == nil || !h.SetArchived(*in.Archived, tx.Now()):
			tx.Record(`"{name}" edited`, "name", name)
		case *in.Archived:
			tx.Record(`"{name}" archived`, "name", name)
		default:
			tx.Record(`"{name}" reactivated`, "name", name)
		}
		if err := tx.SaveHabit(ctx, &h); err != nil {
			return err
		}
		if converted != nil {
			if err := tx.ReplaceEntries(ctx, h, converted); err != nil {
				return err
			}
			entries = converted
		}
		data = habitData{habit: h, entries: entries, basis: b}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "updating habit")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusOK, data.fullView())
}

// handleDeleteHabit deletes a habit with its history. Undo brings it back.
func (s *server) handleDeleteHabit(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		h, err := tx.Habit(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		tx.Record(`"{name}" deleted`, "name", h.Name)
		return tx.DeleteHabit(ctx, h.ID)
	})
	if err != nil {
		s.writeStoreError(w, err, "deleting habit")
		return
	}
	writeChange(w, changeID)
	w.WriteHeader(http.StatusNoContent)
}

// handleReorderHabits sets the order of the habits to the given IDs.
func (s *server) handleReorderHabits(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	ctx := r.Context()
	_, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		return tx.ReorderHabits(ctx, body.IDs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
