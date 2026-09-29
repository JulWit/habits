package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/store"
)

// writeChange announces the undo step a writing request recorded in the
// header Change-Id, for the client's undo button. It must be called before
// the status is written.
func writeChange(w http.ResponseWriter, changeID int64) {
	if changeID != 0 {
		w.Header().Set("Change-Id", strconv.FormatInt(changeID, 10))
	}
}

// handleUndo undoes an undo step: the one with the given id, or the latest.
func (s *server) handleUndo(w http.ResponseWriter, r *http.Request, user auth.User) {
	s.turnStep(w, r, user, s.store.Undo)
}

// handleRedo redoes an undone step: the one with the given id, or the one
// undone last.
func (s *server) handleRedo(w http.ResponseWriter, r *http.Request, user auth.User) {
	s.turnStep(w, r, user, s.store.Redo)
}

// turnStep undoes or redoes a step with turn and answers with it
// (store.Step). Nothing to undo is 404 nothing_to_undo; a step whose data
// was changed since is dropped, 409 changed_since.
func (s *server) turnStep(w http.ResponseWriter, r *http.Request, user auth.User, turn func(context.Context, string, int64) (store.Step, error)) {
	var body struct {
		// ID is the step, or 0 for the latest.
		ID int64 `json:"id"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	step, err := turn(r.Context(), user.ID, body.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.writeError(w, http.StatusNotFound, "nothing_to_undo", "Nothing to undo")
	case errors.Is(err, store.ErrConflict):
		s.writeError(w, http.StatusConflict, "changed_since", "The data was changed in the meantime")
	case err != nil:
		s.writeStoreError(w, err, "undoing")
	default:
		s.writeJSON(w, http.StatusOK, step)
	}
}
