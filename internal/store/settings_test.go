package store

import (
	"context"
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/settings"
)

// Settings have defaults, are stored and read back, and invalid ones are
// refused.
func TestSettingsRoundTrip(t *testing.T) {
	st := openTestStore(t)
	if got := read(t, st, "alice", settingsOf); got != settings.Default() {
		t.Errorf("an unknown user gets %+v instead of the defaults", got)
	}

	want := settings.Default()
	want.Theme = "dark"
	want.OverviewDays = 21
	want.TimeZone = "Europe/Berlin"
	// Differs from the default, so storing it is actually tested.
	want.ShowBand = false
	update(t, st, "alice", func(tx *Tx) error { return tx.SaveSettings(t.Context(), want) })
	if got := read(t, st, "alice", settingsOf); got != want {
		t.Errorf("Settings after SaveSettings = %+v, want %+v", got, want)
	}

	bad := settings.Default()
	bad.Theme = "neon"
	_, err := st.Update(context.Background(), "alice", func(tx *Tx) error { return tx.SaveSettings(t.Context(), bad) })
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("invalid theme: %v, want ErrValidation", err)
	}
	if got := read(t, st, "alice", settingsOf); got != want {
		t.Errorf("after a refused save: %+v, want %+v", got, want)
	}
}

// A setting missing from the stored document gets its default, and a removed
// setting is ignored.
func TestStoredSettingsFallBackToTheDefaults(t *testing.T) {
	st := openTestStore(t)
	if _, err := st.db.Exec(`INSERT INTO users (id, created_at) VALUES ('alice', '');
		INSERT INTO user_settings (user_id, data, updated_at)
		VALUES ('alice', '{"theme":"dark","surfaceBlur":30}', '')`); err != nil {
		t.Fatalf("storing settings: %v", err)
	}
	want := settings.Default()
	want.Theme = "dark"
	if got := read(t, st, "alice", settingsOf); got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

// Stored settings that cannot be read are an error, not silently replaced.
func TestUnreadableSettingsAreAnError(t *testing.T) {
	st := openTestStore(t)
	if _, err := st.db.Exec(`INSERT INTO users (id, created_at) VALUES ('alice', '');
		INSERT INTO user_settings (user_id, data, updated_at)
		VALUES ('alice', '{"overviewDays":"many"}', '')`); err != nil {
		t.Fatalf("storing settings: %v", err)
	}
	err := st.View(context.Background(), "alice", func(tx *Tx) error {
		_, err := tx.Settings(t.Context())
		return err
	})
	if err == nil {
		t.Error("unreadable settings were read without an error")
	}
}

// settingsOf reads the settings in tx; a read callback for tests.
func settingsOf(tx *Tx) (settings.Settings, error) {
	return tx.Settings(context.Background())
}
