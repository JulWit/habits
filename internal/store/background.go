package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Background is a user's uploaded background image, stored unmodified.
type Background struct {
	Mime  string
	Bytes []byte
	// ETag is the hex content hash. The client also uses it as the image
	// version in the URL.
	ETag      string
	UpdatedAt time.Time
}

// GetBackground returns the user's background image. The second result is
// false if there is none.
func (s *Store) GetBackground(ctx context.Context, userID string) (Background, bool, error) {
	var bg Background
	var updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT mime, bytes, etag, updated_at FROM backgrounds WHERE user_id = ?`,
		userID).Scan(&bg.Mime, &bg.Bytes, &bg.ETag, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Background{}, false, nil
	}
	if err != nil {
		return Background{}, false, fmt.Errorf("loading background: %w", err)
	}
	if t, err := parseTime(updated); err == nil {
		bg.UpdatedAt = t
	}
	return bg, true, nil
}

// BackgroundVersion returns the ETag of the user's background image, or "" if
// there is none.
func (s *Store) BackgroundVersion(ctx context.Context, userID string) (string, error) {
	var etag string
	err := s.db.QueryRowContext(ctx,
		`SELECT etag FROM backgrounds WHERE user_id = ?`, userID).Scan(&etag)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("loading background version: %w", err)
	}
	return etag, nil
}

// SaveBackground stores the user's background image, replacing any previous
// one.
func (s *Store) SaveBackground(ctx context.Context, userID string, bg Background) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO backgrounds (user_id, mime, bytes, etag, updated_at)
			VALUES (?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET
			mime = excluded.mime,
			bytes = excluded.bytes,
			etag = excluded.etag,
			updated_at = excluded.updated_at`,
		userID, bg.Mime, bg.Bytes, bg.ETag, formatTime(time.Now()))
	if err != nil {
		return fmt.Errorf("saving background: %w", err)
	}
	return nil
}

// DeleteBackground removes the user's background image.
func (s *Store) DeleteBackground(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM backgrounds WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("deleting background: %w", err)
	}
	return nil
}
