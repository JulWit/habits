package domain

import (
	"strings"
	"time"
)

// Category is a named group of habits on the overview.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Icon is one of HabitIcons, or "" for no icon.
	Icon string `json:"icon"`
	// Color is the icon colour, one of Colors, or "" for the default colour.
	Color string `json:"color"`
	// ShowProgress shows today's progress in the category heading.
	ShowProgress bool      `json:"showProgress"`
	Position     int       `json:"position"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// CategoryEdit is a change of a category, and the request body of creating
// and editing one. Nil fields are left unchanged.
type CategoryEdit struct {
	Name *string `json:"name"`
	// Icon "" removes the icon.
	Icon *string `json:"icon"`
	// Color "" resets the icon colour to the default.
	Color *string `json:"color"`
	// ShowProgress defaults to false for new categories.
	ShowProgress *bool `json:"showProgress"`
}

// Apply copies the set fields of e to c. c is validated when it is saved.
func (e CategoryEdit) Apply(c *Category) {
	setIf(&c.Name, e.Name)
	setIf(&c.Icon, e.Icon)
	setIf(&c.Color, e.Color)
	setIf(&c.ShowProgress, e.ShowProgress)
}

// MaxCategoryNameLen is the maximum length of a category name, in characters.
const MaxCategoryNameLen = 60

// Validate normalises c in place and returns a validation error if c is
// invalid.
func (c *Category) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return Invalid("category_name_empty", "category name must not be empty")
	}
	if len([]rune(c.Name)) > MaxCategoryNameLen {
		return Invalid("category_name_too_long", "category name is longer than {max} characters", "max", MaxCategoryNameLen)
	}
	c.Icon = strings.TrimSpace(c.Icon)
	if c.Icon != "" && !ValidIcon(c.Icon) {
		return Invalid("unknown_icon", `unknown icon "{icon}"`, "icon", c.Icon)
	}
	c.Color = strings.ToLower(strings.TrimSpace(c.Color))
	if c.Color != "" && !ValidColor(c.Color) {
		return Invalid("unknown_color", `unknown colour "{color}"`, "color", c.Color)
	}
	return nil
}
