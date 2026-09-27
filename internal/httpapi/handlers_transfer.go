package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// Export files carry the habits and categories with their settings, but no
// entries and no statistics: importing them sets up the same habits from
// scratch.

// exportFormat and exportVersion identify an export file.
const (
	exportFormat  = "habits"
	exportVersion = 1
)

// maxImportBytes is the maximum size of an import file.
const maxImportBytes = 1 << 20

// exportFile is the document of GET /api/export and POST /api/import.
type exportFile struct {
	Format     string           `json:"format"`
	Version    int              `json:"version"`
	ExportedAt time.Time        `json:"exportedAt"`
	Categories []exportCategory `json:"categories"`
	Habits     []exportHabit    `json:"habits"`
}

// exportCategory is a category in an export file.
type exportCategory struct {
	// Key identifies the category within the file.
	Key          string `json:"key"`
	Name         string `json:"name"`
	Icon         string `json:"icon"`
	Color        string `json:"color"`
	ShowProgress bool   `json:"showProgress"`
}

// exportHabit is a habit in an export file, with its current schedule only.
type exportHabit struct {
	Name  string      `json:"name"`
	Color string      `json:"color"`
	Icon  string      `json:"icon"`
	Kind  domain.Kind `json:"kind"`
	// Category is the Key of the habit's category, or "" for none.
	Category    string           `json:"category"`
	StepValue   int              `json:"stepValue"`
	Unit        string           `json:"unit"`
	TargetValue int              `json:"targetValue"`
	Frequency   domain.Frequency `json:"frequency"`
	Archived    bool             `json:"archived"`
}

// importResult is the response of POST /api/import.
type importResult struct {
	Habits     int `json:"habits"`
	Categories int `json:"categories"`
	// Skipped counts the habits left out because one of that name exists.
	Skipped int `json:"skipped"`
}

// handleExport sends the user's habits, archived ones included, and their
// categories as a file to download.
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUser(ctx)

	categories, err := s.store.ListCategories(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading categories")
		return
	}
	habits, err := s.store.ListHabits(ctx, user.ID, true)
	if err != nil {
		s.writeStoreError(w, err, "loading habits")
		return
	}

	out := exportFile{
		Format:     exportFormat,
		Version:    exportVersion,
		ExportedAt: time.Now().UTC().Truncate(time.Second),
		Categories: make([]exportCategory, 0, len(categories)),
		Habits:     make([]exportHabit, 0, len(habits)),
	}
	listed := map[string]bool{}
	for _, c := range categories {
		listed[c.ID] = true
		out.Categories = append(out.Categories, exportCategory{
			Key: c.ID, Name: c.Name, Icon: c.Icon, Color: c.Color, ShowProgress: c.ShowProgress,
		})
	}
	for _, h := range habits {
		category := h.CategoryID
		// A deleted category is not exported; its habits are uncategorised.
		if !listed[category] {
			category = ""
		}
		current := h.Current()
		out.Habits = append(out.Habits, exportHabit{
			Name:        h.Name,
			Color:       h.Color,
			Icon:        h.Icon,
			Kind:        h.Kind,
			Category:    category,
			StepValue:   h.StepValue,
			Unit:        h.Unit,
			TargetValue: current.TargetValue,
			Frequency:   current.Frequency,
			Archived:    h.ArchivedAt != nil,
		})
	}

	name := "habits-" + s.todayFor(ctx, user.ID).String() + ".json"
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	writeJSON(w, http.StatusOK, out)
}

// handleImport adds the habits and categories of an export file.
//
// Categories are matched by name: a habit joins an existing category of the
// same name, and only missing categories are created. Habits whose name is
// already taken are skipped, so importing a file twice adds nothing. The
// schedules start today. Nothing is saved if any habit is invalid.
func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	var in exportFile
	if !decodeJSONLimit(w, r, &in, maxImportBytes) {
		return
	}
	if in.Format != exportFormat || in.Version != exportVersion {
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("import_format",
			"the file is not a habits export of version {version}", "version", exportVersion))
		return
	}
	ctx := r.Context()
	user := auth.MustUser(ctx)

	existingCats, err := s.store.ListCategories(ctx, user.ID)
	if err != nil {
		s.writeStoreError(w, err, "loading categories")
		return
	}
	existingHabits, err := s.store.ListHabits(ctx, user.ID, true)
	if err != nil {
		s.writeStoreError(w, err, "loading habits")
		return
	}

	// Category IDs by normalised name, and by key in the file.
	catByName := map[string]string{}
	for _, c := range existingCats {
		catByName[nameKey(c.Name)] = c.ID
	}
	catByKey := map[string]string{}
	var newCats []domain.Category
	for _, ec := range in.Categories {
		if id, ok := catByName[nameKey(ec.Name)]; ok {
			catByKey[ec.Key] = id
			continue
		}
		c := domain.Category{
			ID: store.NewID(), Name: ec.Name, Icon: ec.Icon, Color: ec.Color, ShowProgress: ec.ShowProgress,
		}
		if err := c.Validate(); err != nil {
			writeImportProblem(w, err, "category", ec.Name)
			return
		}
		catByName[nameKey(c.Name)] = c.ID
		catByKey[ec.Key] = c.ID
		newCats = append(newCats, c)
	}

	taken := map[string]bool{}
	for _, h := range existingHabits {
		taken[nameKey(h.Name)] = true
	}
	today := s.todayFor(ctx, user.ID)
	now := time.Now().UTC()
	var newHabits []domain.Habit
	result := importResult{}
	for _, eh := range in.Habits {
		if taken[nameKey(eh.Name)] {
			result.Skipped++
			continue
		}
		h := domain.Habit{
			ID:    store.NewID(),
			Name:  eh.Name,
			Color: eh.Color,
			Icon:  eh.Icon,
			Kind:  eh.Kind,
			// An unknown key leaves the habit uncategorised.
			CategoryID: catByKey[eh.Category],
			StepValue:  eh.StepValue,
			Unit:       eh.Unit,
			Schedules:  []domain.Schedule{{From: today, TargetValue: eh.TargetValue, Frequency: eh.Frequency}},
		}
		if eh.Archived {
			h.ArchivedAt = &now
		}
		if err := h.Validate(); err != nil {
			writeImportProblem(w, err, "habit", eh.Name)
			return
		}
		taken[nameKey(h.Name)] = true
		newHabits = append(newHabits, h)
	}

	if err := s.store.Import(ctx, user.ID, newCats, newHabits); err != nil {
		s.writeStoreError(w, err, "importing")
		return
	}
	result.Habits, result.Categories = len(newHabits), len(newCats)
	writeJSON(w, http.StatusOK, result)
}

// nameKey normalises a name for matching: trimmed and case-insensitive.
func nameKey(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

// writeImportProblem writes the validation error err of an imported habit or
// category, naming it in the parameter param, so the client can say which one
// is invalid.
func writeImportProblem(w http.ResponseWriter, err error, param, name string) {
	var p *domain.Problem
	if errors.As(err, &p) {
		named := *p
		named.Params = map[string]any{param: name}
		for k, v := range p.Params {
			named.Params[k] = v
		}
		err = &named
	}
	writeProblem(w, http.StatusUnprocessableEntity, err)
}
