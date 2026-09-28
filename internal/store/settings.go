package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/JulWit/habits/internal/settings"
)

// Settings returns the settings of the user, or settings.Default if none are
// stored. Settings missing from the stored document get their defaults, and
// invalid ones are repaired (settings.Settings.Repair).
func (t *Tx) Settings() (settings.Settings, error) {
	var data string
	err := t.queryRow(`SELECT data FROM user_settings WHERE user_id = ?`, t.userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return settings.Default(), nil
	}
	if err != nil {
		return settings.Settings{}, fmt.Errorf("loading settings: %w", err)
	}
	out := settings.Default()
	if err := json.Unmarshal([]byte(data), &out); err != nil {
		// A value of the wrong type keeps its default, like an invalid one.
		slog.Warn("stored settings are partly unreadable", "user", t.userID, "error", err)
	}
	out.Repair()
	return out, nil
}

// SaveSettings validates the settings and stores them. Settings are not an
// undo step.
func (t *Tx) SaveSettings(s settings.Settings) error {
	if err := s.Validate(); err != nil {
		return err
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = t.exec(`
		INSERT INTO user_settings (user_id, data, updated_at) VALUES (?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		t.userID, string(data), formatTime(t.now))
	return err
}
