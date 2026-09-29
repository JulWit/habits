package httpapi

import (
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// handleCreateCategory creates a category. The name is required.
func (s *server) handleCreateCategory(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in domain.CategoryEdit
	if !s.decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil {
		s.writeError(w, http.StatusBadRequest, "missing_fields", "name is required")
		return
	}
	ctx := r.Context()

	var c domain.Category
	in.Apply(&c)
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		if err := tx.CreateCategory(ctx, &c); err != nil {
			return err
		}
		tx.Record(`Category "{name}" created`, "name", c.Name)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "creating category")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusCreated, c)
}

// handleUpdateCategory updates the fields of a category given in the request
// body.
func (s *server) handleUpdateCategory(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in domain.CategoryEdit
	if !s.decodeJSON(w, r, &in) {
		return
	}
	ctx := r.Context()

	var c domain.Category
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		var err error
		if c, err = tx.Category(ctx, r.PathValue("id")); err != nil {
			return err
		}
		tx.Record(`Category "{name}" edited`, "name", c.Name)
		in.Apply(&c)
		return tx.SaveCategory(ctx, &c)
	})
	if err != nil {
		s.writeStoreError(w, err, "updating category")
		return
	}
	writeChange(w, changeID)
	s.writeJSON(w, http.StatusOK, c)
}

// handleDeleteCategory deletes a category. Its habits stay, without a
// category; undo puts them back.
func (s *server) handleDeleteCategory(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	changeID, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		c, err := tx.Category(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		habits, err := tx.Habits(ctx, true)
		if err != nil {
			return err
		}
		kept := 0
		for _, h := range habits {
			if h.CategoryID == c.ID {
				kept++
			}
		}
		switch kept {
		case 0:
			tx.Record(`Category "{name}" deleted`, "name", c.Name)
		case 1:
			tx.Record(`Category "{name}" deleted — 1 habit kept`, "name", c.Name)
		default:
			tx.Record(`Category "{name}" deleted — {n} habits kept`, "name", c.Name, "n", kept)
		}
		return tx.DeleteCategory(ctx, c.ID)
	})
	if err != nil {
		s.writeStoreError(w, err, "deleting category")
		return
	}
	writeChange(w, changeID)
	w.WriteHeader(http.StatusNoContent)
}

// handleReorderCategories sets the order of the categories to the given IDs.
func (s *server) handleReorderCategories(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	ctx := r.Context()
	_, err := s.store.Update(ctx, user.ID, func(tx *store.Tx) error {
		return tx.ReorderCategories(ctx, body.IDs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
