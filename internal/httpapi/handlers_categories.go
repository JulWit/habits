package httpapi

import (
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// handleCreateCategory creates a category. The name is required.
func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	var in domain.CategoryEdit
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil {
		writeError(w, http.StatusBadRequest, "missing_fields", "name is required")
		return
	}
	user := auth.MustUser(r.Context())

	var c domain.Category
	in.Apply(&c)
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		if err := tx.CreateCategory(&c); err != nil {
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
	writeJSON(w, http.StatusCreated, c)
}

// handleUpdateCategory updates the fields of a category given in the request
// body.
func (s *Server) handleUpdateCategory(w http.ResponseWriter, r *http.Request) {
	var in domain.CategoryEdit
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	var c domain.Category
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		var err error
		if c, err = tx.Category(r.PathValue("id")); err != nil {
			return err
		}
		tx.Record(`Category "{name}" edited`, "name", c.Name)
		in.Apply(&c)
		return tx.SaveCategory(&c)
	})
	if err != nil {
		s.writeStoreError(w, err, "updating category")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusOK, c)
}

// handleDeleteCategory deletes a category. Its habits stay, without a
// category; undo puts them back.
func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		c, err := tx.Category(r.PathValue("id"))
		if err != nil {
			return err
		}
		habits, err := tx.Habits(true)
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
		return tx.DeleteCategory(c.ID)
	})
	if err != nil {
		s.writeStoreError(w, err, "deleting category")
		return
	}
	writeChange(w, changeID)
	w.WriteHeader(http.StatusNoContent)
}

// handleReorderCategories sets the order of the categories to the given IDs.
func (s *Server) handleReorderCategories(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user := auth.MustUser(r.Context())
	_, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		return tx.ReorderCategories(body.IDs)
	})
	if err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
