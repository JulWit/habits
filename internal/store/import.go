package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// Import adds the categories and then the habits at the end of the user's
// lists, in the given order, and sets their positions and timestamps. Either
// all of them are saved or none.
//
// The caller sets the IDs (see NewID), so that a habit's CategoryID can name
// one of the new categories as well as an existing one.
func (s *Store) Import(ctx context.Context, userID string, cats []domain.Category, habits []domain.Habit) error {
	now := time.Now().UTC()
	for i := range cats {
		cats[i].CreatedAt, cats[i].UpdatedAt = now, now
		if err := cats[i].Validate(); err != nil {
			return err
		}
	}
	for i := range habits {
		habits[i].CreatedAt, habits[i].UpdatedAt = now, now
		if err := habits[i].Validate(); err != nil {
			return err
		}
	}

	return s.inTx(ctx, "importing", func(tx *sql.Tx) error {
		if err := ensureUser(ctx, tx, userID); err != nil {
			return err
		}
		for i := range cats {
			if err := insertCategory(ctx, tx, userID, &cats[i]); err != nil {
				return err
			}
		}
		for i := range habits {
			if err := insertHabit(ctx, tx, userID, &habits[i]); err != nil {
				return err
			}
		}
		return nil
	})
}
