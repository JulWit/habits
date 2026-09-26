package domain

import (
	"strings"
	"time"
)

// Category groups habits into blocks on the overview. It may carry an icon and
// a colour for that icon; without a colour the icon is drawn in neutral ink.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Icon names one of HabitIcons, or is empty for a category without one.
	Icon string `json:"icon"`
	// Color is a hex value like a habit's, or empty for neutral ink.
	Color string `json:"color"`
	// ShowProgress draws today's progress bar and count in the block heading.
	ShowProgress bool      `json:"showProgress"`
	Position     int       `json:"position"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

const MaxCategoryNameLen = 60

func (c *Category) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return invalid("category name must not be empty")
	}
	if len([]rune(c.Name)) > MaxCategoryNameLen {
		return invalid("category name is longer than %d characters", MaxCategoryNameLen)
	}
	c.Icon = strings.TrimSpace(c.Icon)
	if c.Icon != "" && !ValidIcon(c.Icon) {
		return invalid("unknown icon %q", c.Icon)
	}
	c.Color = strings.ToLower(strings.TrimSpace(c.Color))
	if c.Color != "" && !colorPattern.MatchString(c.Color) {
		return invalid("colour must be a hex value like #4caf50")
	}
	return nil
}
