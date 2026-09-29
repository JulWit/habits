package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/JulWit/habits/internal/settings"
)

// Settings returns the settings of the user, or settings.Default if none are
// stored. Settings missing from the stored document get their defaults, and
// removed ones are ignored. The stored settings were valid when they were
// saved (SaveSettings), so removing an option needs a migration that
// rewrites the stored values.
func (t *Tx) Settings(ctx context.Context) (settings.Settings, error) {
	var data string
	err := t.queryRow(ctx, `SELECT data FROM user_settings WHERE user_id = ?`, t.userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return settings.Default(), nil
	}
	if err != nil {
		return settings.Settings{}, fmt.Errorf("loading settings: %w", err)
	}
	out := settings.Default()
	if err := json.Unmarshal([]byte(data), &out); err != nil {
		return settings.Settings{}, fmt.Errorf("reading settings: %w", err)
	}
	return out, nil
}

// SaveSettings validates the settings and stores them. Settings are not an
// undo step.
func (t *Tx) SaveSettings(ctx context.Context, s settings.Settings) error {
	if err := s.Validate(); err != nil {
		return err
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = t.exec(ctx, `
		INSERT INTO user_settings (user_id, data, updated_at) VALUES (?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		t.userID, string(data), formatTime(t.now))
	return err
}
