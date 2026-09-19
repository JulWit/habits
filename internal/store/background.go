package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Background is a picture a user uploaded to sit behind the board.
//
// The bytes are kept exactly as they arrived. Re-encoding would cost a
// generation of quality on every upload, and a photograph that is already
// veiled and blurred behind a board has little to spare; the server therefore
// checks what it was given and stores it unchanged.
type Background struct {
	Mime  string
	Bytes []byte
	// ETag is the content hash, in hex. It answers conditional requests and
	// doubles as the version the client appends to the URL after an upload, so
	// a new picture is never served from the old cache entry.
	ETag      string
	UpdatedAt time.Time
}

// GetBackground returns the user's picture. The second result is false when
// there is none, which is not an error - most users never upload one.
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

// BackgroundVersion is the stored picture's hash, or "" when there is none.
// The overview asks for this rather than the picture itself: it is what tells
// the client whether to offer the image at all, and it is small.
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

// SaveBackground replaces whatever the user had. One picture per user: a
// gallery would need a way to pick between them, and the setting that points
// at it is a single value.
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

func (s *Store) DeleteBackground(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM backgrounds WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("deleting background: %w", err)
	}
	return nil
}
