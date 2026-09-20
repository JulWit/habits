package httpapi

import (
	"net/http"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// habitView is a habit plus everything the UI needs to draw it. The embedded
// domain.Habit is flattened into the JSON object, so the client sees one flat
// habit with a few extra fields.
type habitView struct {
	domain.Habit
	Stats   domain.Stats   `json:"stats"`
	Entries map[string]int `json:"entries"`
	// StreakRuns are the unbroken runs the board colours, oldest first. A run
	// keeps its true first day even when that day is older than the shipped
	// history, because the colour of a cell depends on how long its run had
	// been going by then.
	StreakRuns []domain.StreakRun `json:"streakRuns"`
}

type stateResponse struct {
	User       auth.User         `json:"user"`
	Settings   store.Settings    `json:"settings"`
	Today      domain.Date       `json:"today"`
	Categories []domain.Category `json:"categories"`
	// ArchivedCount counts archived habits whether or not they are in Habits,
	// so the client can show or hide its "archived" toggle.
	ArchivedCount int         `json:"archivedCount"`
	Habits        []habitView `json:"habits"`
	Colors        []string    `json:"colors"`
	// Kinds carries the scale, step and ceiling of every habit kind, the same
	// way Colors carries the palette: the client needs these numbers to read a
	// stored value, and a copy of them in JavaScript is one that can drift.
	Kinds map[domain.Kind]domain.KindInfo `json:"kinds"`
	// BlurAtFull is what 100% of blur comes to in pixels. The stylesheet needs
	// a length where the setting is a percentage.
	BlurAtFull int `json:"blurAtFull"`
	// EntriesFrom is the first day the entries in this response cover. The
	// client needs it to know when paging further back would run past its data
	// and it has to ask for a wider window.
	EntriesFrom domain.Date `json:"entriesFrom"`
	// BackgroundVersion is the hash of the uploaded background, or "" when there
	// is none. It tells the settings dialog whether to offer the picture at all,
	// and the page appends it to the URL so a new upload is never served from
	// the entry the old one left in the cache.
	BackgroundVersion string `json:"backgroundVersion"`
}

// entryWindowDays is how much history the overview ships. It covers the heatmap
// on the detail view (about 26 weeks) with room to spare, while keeping the
// payload small enough to send on every load.
const entryWindowDays = 200

// handleState returns everything the app needs for a cold start in one request.
func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUser(ctx)

	// Settings come first: whether archived habits belong in the answer is one
	// of them, so the client gets the right set on its very first request
	// instead of having to read the preference and then ask again.
	settings, err := s.store.GetSettings(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading settings")
		return
	}
	includeArchived := settings.ShowArchived
	// An explicit ?archived= still wins, which keeps the endpoint usable from a
	// script without touching the stored preference.
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

	today := s.today()
	from := today.AddDays(-(entryWindowDays - 1))
	// Paging back through the board eventually leaves the default window. The
	// client then repeats the request with the day it wants to reach, and gets
	// a payload that starts there instead.
	if v := r.URL.Query().Get("from"); v != "" {
		asked, err := domain.ParseDate(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid date, expected YYYY-MM-DD")
			return
		}
		// Only ever widens: a `from` inside the default window would ship less
		// history than the detail view and the streak counters expect.
		if asked.Before(from) {
			from = asked
		}
	}
	views := make([]habitView, 0, len(habits))
	for _, h := range habits {
		views = append(views, s.viewFor(h, entries[h.ID], today, from))
	}

	// The hash, not the picture: a background can be megabytes, and this answer
	// is fetched on every load.
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
		Kinds:             domain.KindDescriptors(),
		BlurAtFull:        store.BackgroundBlurAtFull,
		EntriesFrom:       from,
		BackgroundVersion: bgVersion,
	})
}

// viewFor computes stats over the full history but ships only the entries from
// `from` onwards, so old data still counts towards streaks without being sent.
// A zero `from` means "send everything".
func (s *Server) viewFor(h domain.Habit, all store.EntryMap, today, from domain.Date) habitView {
	windowed := make(map[string]int, len(all))
	for d, v := range all {
		if from.IsZero() || !d.Before(from) {
			windowed[d.String()] = v
		}
	}
	// A run that ended before the window is one no visible cell belongs to, so
	// it is dropped rather than shipped; the run a visible day is part of
	// survives whole, first day included.
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
	}
}

// loadView fetches a habit together with its full history. Used by every
// mutating endpoint so the client always gets fresh stats back.
func (s *Server) loadView(r *http.Request, userID, habitID string) (habitView, error) {
	h, err := s.store.GetHabit(r.Context(), userID, habitID)
	if err != nil {
		return habitView{}, err
	}
	entries, err := s.store.EntriesForHabit(r.Context(), userID, habitID)
	if err != nil {
		return habitView{}, err
	}
	return s.viewFor(h, entries, s.today(), domain.Date{}), nil
}

func (s *Server) handleGetHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	view, err := s.loadView(r, user.ID, r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err, "loading habit")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// habitInput is the writable shape of a habit. It is a separate type from
// domain.Habit so that server-owned fields (id, timestamps, position) can never
// be set by a client. The pointer fields give PATCH its semantics: an absent
// field means "unchanged", which differs from "set to empty".
type habitInput struct {
	Name  *string      `json:"name"`
	Color *string      `json:"color"`
	Kind  *domain.Kind `json:"kind"`
	// CategoryID: absent leaves the assignment alone, "" removes it.
	CategoryID  *string           `json:"categoryId"`
	TargetValue *int              `json:"targetValue"`
	StepValue   *int              `json:"stepValue"`
	Unit        *string           `json:"unit"`
	Frequency   *domain.Frequency `json:"frequency"`
	Archived    *bool             `json:"archived"`
}

func (in habitInput) applyTo(h *domain.Habit) {
	if in.Name != nil {
		h.Name = *in.Name
	}
	if in.Color != nil {
		h.Color = *in.Color
	}
	if in.Kind != nil {
		h.Kind = *in.Kind
	}
	if in.CategoryID != nil {
		h.CategoryID = *in.CategoryID
	}
	if in.TargetValue != nil {
		h.TargetValue = *in.TargetValue
	}
	if in.StepValue != nil {
		h.StepValue = *in.StepValue
	}
	if in.Unit != nil {
		h.Unit = *in.Unit
	}
	if in.Frequency != nil {
		h.Frequency = *in.Frequency
	}
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
	h := domain.Habit{Kind: domain.KindCheck, TargetValue: 1, Color: domain.DefaultColors[0]}
	in.applyTo(&h)

	if err := s.store.CreateHabit(r.Context(), user.ID, &h); err != nil {
		s.writeStoreError(w, err, "creating habit")
		return
	}
	writeJSON(w, http.StatusCreated, s.viewFor(h, nil, s.today(), domain.Date{}))
}

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
	in.applyTo(&h)
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

// handleDeleteHabit soft-deletes. The row survives so the undo toast can bring
// the habit back with its whole history intact.
func (s *Server) handleDeleteHabit(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.SoftDeleteHabit(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeStoreError(w, err, "deleting habit")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

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
