package httpapi

import (
	"net/http"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
)

// categoryInput is the request body for creating and updating a category. Nil
// fields are left unchanged.
type categoryInput struct {
	Name *string `json:"name"`
	// Icon "" removes the icon.
	Icon *string `json:"icon"`
	// Color "" resets the icon colour to the default.
	Color *string `json:"color"`
	// ShowProgress defaults to false for new categories.
	ShowProgress *bool `json:"showProgress"`
}

// applyTo copies the set fields of in to c.
func (in categoryInput) applyTo(c *domain.Category) {
	setIf(&c.Name, in.Name)
	setIf(&c.Icon, in.Icon)
	setIf(&c.Color, in.Color)
	setIf(&c.ShowProgress, in.ShowProgress)
}

// handleCreateCategory creates a category. The name is required.
func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	var in categoryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == nil {
		writeError(w, http.StatusBadRequest, "missing_fields", "name is required")
		return
	}
	user := auth.MustUser(r.Context())

	var c domain.Category
	in.applyTo(&c)
	if err := s.store.CreateCategory(r.Context(), user.ID, &c); err != nil {
		s.writeStoreError(w, err, "creating category")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// handleUpdateCategory updates the fields of a category given in the request
// body.
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
	in.applyTo(&c)
	if err := s.store.UpdateCategory(r.Context(), user.ID, &c); err != nil {
		s.writeStoreError(w, err, "updating category")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// handleDeleteCategory soft-deletes a category.
func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	if err := s.store.SoftDeleteCategory(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeStoreError(w, err, "deleting category")
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// handleRestoreCategory restores a soft-deleted category.
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

// handleReorderCategories sets the order of the categories to the given IDs.
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
