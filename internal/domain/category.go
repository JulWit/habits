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
	// Color is the icon colour as a hex value, or "" for the default colour.
	Color string `json:"color"`
	// ShowProgress shows today's progress in the category heading.
	ShowProgress bool      `json:"showProgress"`
	Position     int       `json:"position"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// MaxCategoryNameLen is the maximum length of a category name, in characters.
const MaxCategoryNameLen = 60

// Validate normalises c in place and returns a validation error if c is
// invalid.
func (c *Category) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return Invalid("category name must not be empty")
	}
	if len([]rune(c.Name)) > MaxCategoryNameLen {
		return Invalid("category name is longer than {max} characters", "max", MaxCategoryNameLen)
	}
	c.Icon = strings.TrimSpace(c.Icon)
	if c.Icon != "" && !ValidIcon(c.Icon) {
		return Invalid(`unknown icon "{icon}"`, "icon", c.Icon)
	}
	c.Color = strings.ToLower(strings.TrimSpace(c.Color))
	if c.Color != "" && !colorPattern.MatchString(c.Color) {
		return Invalid("colour must be a hex value like #4caf50")
	}
	return nil
}
