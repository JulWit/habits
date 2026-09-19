package httpapi

import (
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
)

type categoryInput struct {
	Name *string `json:"name"`
}

func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	var in categoryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	user := auth.MustUser(r.Context())

	c := domain.Category{Name: *in.Name}
	if err := s.store.CreateCategory(r.Context(), user.ID, &c); err != nil {
		s.writeStoreError(w, err, "creating category")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleUpdateCategory(w http.ResponseWriter, r *http.Request) {
	var in categoryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	user := auth.MustUser(r.Context())

	c, err := s.store.GetCategory(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err, "loading category")
		return
	}
	if in.Name != nil {
		c.Name = *in.Name
	}
	if err := s.store.UpdateCategory(r.Context(), user.ID, &c); err != nil {
		s.writeStoreError(w, err, "updating category")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// handleDeleteCategory soft-deletes. The habits inside keep their assignment
// and simply show as uncategorised, so a restore rebuilds the block unchanged.
func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.SoftDeleteCategory(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeStoreError(w, err, "deleting category")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

func (s *Server) handleRestoreCategory(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	id := r.PathValue("id")

	if err := s.store.RestoreCategory(r.Context(), user.ID, id); err != nil {
		s.writeStoreError(w, err, "restoring category")
		return
	}
	c, err := s.store.GetCategory(r.Context(), user.ID, id)
	if err != nil {
		s.writeStoreError(w, err, "loading category")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleReorderCategories(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user := auth.MustUser(r.Context())
	if err := s.store.ReorderCategories(r.Context(), user.ID, body.IDs); err != nil {
		s.writeStoreError(w, err, "saving order")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}
