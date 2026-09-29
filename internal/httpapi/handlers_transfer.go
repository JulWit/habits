package httpapi

import (
	"errors"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

// Export files carry the habits with their schedules and entries, and the
// categories: a backup that importing restores, on the same server or
// another. Statistics are not part of them; the server computes them again.

// exportFormat and exportVersion identify an export file.
const (
	exportFormat  = "habits"
	exportVersion = 2
)

// maxImportBytes is the maximum size of an import file: years of entries of
// a few dozen habits.
const maxImportBytes = 16 << 20

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

// exportHabit is a habit in an export file with its history.
type exportHabit struct {
	Name  string      `json:"name"`
	Color string      `json:"color"`
	Icon  string      `json:"icon"`
	Kind  domain.Kind `json:"kind"`
	// Category is the Key of the habit's category, or "" for none.
	Category  string            `json:"category"`
	StepValue int               `json:"stepValue"`
	Unit      string            `json:"unit"`
	Archived  bool              `json:"archived"`
	CreatedAt time.Time         `json:"createdAt"`
	Schedules []domain.Schedule `json:"schedules"`
	// Entries holds the value of each day with one, Skipped the skipped days.
	Entries map[string]int `json:"entries"`
	Skipped []domain.Date  `json:"skipped"`
}

// importResult is the response of POST /api/import.
type importResult struct {
	Habits     int `json:"habits"`
	Categories int `json:"categories"`
	// Skipped counts the habits left out because one of that name exists.
	Skipped int `json:"skipped"`
}

// handleExport sends the user's habits, archived ones included, with their
// history, and their categories as a file to download.
func (s *server) handleExport(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	var (
		out   exportFile
		today domain.Date
	)
	err := s.store.View(r.Context(), user.ID, func(tx *store.Tx) error {
		b, err := s.basis(tx)
		if err != nil {
			return err
		}
		today = b.today
		categories, err := tx.Categories()
		if err != nil {
			return err
		}
		habits, err := tx.Habits(true)
		if err != nil {
			return err
		}
		entries, err := tx.Entries()
		if err != nil {
			return err
		}
		out = exportFile{
			Format:     exportFormat,
			Version:    exportVersion,
			ExportedAt: time.Now().UTC().Truncate(time.Second),
			Categories: make([]exportCategory, 0, len(categories)),
			Habits:     make([]exportHabit, 0, len(habits)),
		}
		for _, c := range categories {
			out.Categories = append(out.Categories, exportCategory{
				Key: c.ID, Name: c.Name, Icon: c.Icon, Color: c.Color, ShowProgress: c.ShowProgress,
			})
		}
		for _, h := range habits {
			out.Habits = append(out.Habits, exportHabitOf(h, entries[h.ID]))
		}
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err, "exporting")
		return
	}
	name := "habits-" + today.String() + ".json"
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	writeJSON(w, http.StatusOK, out)
}

// exportHabitOf returns h with its entries as it is exported.
func exportHabitOf(h domain.Habit, entries map[domain.Date]domain.Entry) exportHabit {
	out := exportHabit{
		Name:      h.Name,
		Color:     h.Color,
		Icon:      h.Icon,
		Kind:      h.Kind,
		Category:  h.CategoryID,
		StepValue: h.StepValue,
		Unit:      h.Unit,
		Archived:  h.ArchivedAt != nil,
		CreatedAt: h.CreatedAt,
		Schedules: h.Schedules,
		Entries:   map[string]int{},
		Skipped:   []domain.Date{},
	}
	for _, d := range slices.SortedFunc(maps.Keys(entries), domain.Date.Compare) {
		e := entries[d]
		if e.Value > 0 {
			out.Entries[d.String()] = e.Value
		}
		if e.Skipped {
			out.Skipped = append(out.Skipped, d)
		}
	}
	return out
}

// importProblem is an invalid habit or category of an import file, which
// the answer names in the parameter param.
type importProblem struct {
	error
	param, name string
}

// Unwrap returns the validation error, so errors.Is and errors.As see it.
func (p importProblem) Unwrap() error { return p.error }

// handleImport adds the habits and categories of an export file, with the
// habits' schedules and entries. The import is one undo step.
//
// Categories are matched by name: a habit joins an existing category of the
// same name, and only missing categories are created. Habits whose name is
// already taken are skipped, so importing a file twice adds nothing. Nothing
// is saved if any habit or category is invalid.
func (s *server) handleImport(w http.ResponseWriter, r *http.Request) {
	var in exportFile
	if !decodeJSONLimit(w, r, &in, maxImportBytes) {
		return
	}
	if in.Format != exportFormat || in.Version != exportVersion {
		writeProblem(w, http.StatusUnprocessableEntity, domain.Invalid("import_format",
			"the file is not a habits export of version {version}", "version", exportVersion))
		return
	}
	user := auth.MustUser(r.Context())

	var result importResult
	changeID, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		var err error
		if result, err = importFile(tx, in); err != nil {
			return err
		}
		if result.Habits == 1 {
			tx.Record("1 habit imported")
		} else {
			tx.Record("{n} habits imported", "n", result.Habits)
		}
		return nil
	})
	var problem importProblem
	switch {
	case errors.As(err, &problem) && errors.Is(err, domain.ErrValidation):
		writeImportProblem(w, problem.error, problem.param, problem.name)
		return
	case err != nil:
		s.writeStoreError(w, err, "importing")
		return
	}
	writeChange(w, changeID)
	writeJSON(w, http.StatusOK, result)
}

// importFile adds the categories and habits of in (see handleImport).
func importFile(tx *store.Tx, in exportFile) (importResult, error) {
	var result importResult
	existingCats, err := tx.Categories()
	if err != nil {
		return result, err
	}
	existingHabits, err := tx.Habits(true)
	if err != nil {
		return result, err
	}

	// Category IDs by normalised name, and by key in the file.
	catByName := map[string]string{}
	for _, c := range existingCats {
		catByName[nameKey(c.Name)] = c.ID
	}
	catByKey := map[string]string{}
	for _, ec := range in.Categories {
		if id, ok := catByName[nameKey(ec.Name)]; ok {
			catByKey[ec.Key] = id
			continue
		}
		c := domain.Category{Name: ec.Name, Icon: ec.Icon, Color: ec.Color, ShowProgress: ec.ShowProgress}
		if err := tx.CreateCategory(&c); err != nil {
			return result, importProblem{error: err, param: "category", name: ec.Name}
		}
		catByName[nameKey(c.Name)] = c.ID
		catByKey[ec.Key] = c.ID
		result.Categories++
	}

	taken := map[string]bool{}
	for _, h := range existingHabits {
		taken[nameKey(h.Name)] = true
	}
	for _, eh := range in.Habits {
		if taken[nameKey(eh.Name)] {
			result.Skipped++
			continue
		}
		if err := importHabit(tx, eh, catByKey); err != nil {
			return result, importProblem{error: err, param: "habit", name: eh.Name}
		}
		taken[nameKey(eh.Name)] = true
		result.Habits++
	}
	return result, nil
}

// importHabit adds the habit eh with its entries; catByKey maps the category
// keys of the file to category IDs.
func importHabit(tx *store.Tx, eh exportHabit, catByKey map[string]string) error {
	h := domain.Habit{
		Name:  eh.Name,
		Color: eh.Color,
		Icon:  eh.Icon,
		Kind:  eh.Kind,
		// An unknown key leaves the habit uncategorised.
		CategoryID: catByKey[eh.Category],
		StepValue:  eh.StepValue,
		Unit:       eh.Unit,
		CreatedAt:  eh.CreatedAt,
		Schedules:  eh.Schedules,
	}
	h.SetArchived(eh.Archived, tx.Now())
	if err := tx.CreateHabit(&h); err != nil {
		return err
	}
	entries := map[domain.Date]domain.Entry{}
	for day, value := range eh.Entries {
		d, err := domain.ParseDate(day)
		if err != nil {
			return domain.Invalid("invalid_date", "invalid date, expected YYYY-MM-DD")
		}
		entries[d] = domain.Entry{Value: value}
	}
	for _, d := range eh.Skipped {
		if entries[d].Value > 0 {
			return domain.Invalid("skipped_with_value", "a skipped day cannot have a value")
		}
		entries[d] = domain.Entry{Skipped: true}
	}
	return tx.SetEntries(h, entries)
}

// handleDeleteData removes all of the user's data: habits with their entries,
// categories, settings and undo steps. It cannot be undone. DELETE is not a
// simple method, so a cross-site request needs a CORS preflight, which fails.
func (s *server) handleDeleteData(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	_, err := s.store.Update(r.Context(), user.ID, func(tx *store.Tx) error {
		return tx.DeleteUser()
	})
	if err != nil {
		s.writeStoreError(w, err, "deleting data")
		return
	}
	s.log.Info("deleted all data", "user", user.ID)
	w.WriteHeader(http.StatusNoContent)
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
