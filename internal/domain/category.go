package domain

import (
	"strings"
	"time"
)

// Category groups habits into blocks on the overview. It carries no colour of
// its own: habits already have one, and a second colour per block would compete
// with the marks it sits above.
type Category struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
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
	return nil
}
