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
	if got := read(t, st, "alice", (*Tx).Settings); got != settings.Default() {
		t.Errorf("an unknown user gets %+v instead of the defaults", got)
	}

	want := settings.Default()
	want.Theme = "dark"
	want.OverviewDays = 21
	want.TimeZone = "Europe/Berlin"
	// Differs from the default, so storing it is actually tested.
	want.ShowBand = false
	update(t, st, "alice", func(tx *Tx) error { return tx.SaveSettings(want) })
	if got := read(t, st, "alice", (*Tx).Settings); got != want {
		t.Errorf("round trip: %+v != %+v", got, want)
	}

	bad := settings.Default()
	bad.Theme = "neon"
	_, err := st.Update(context.Background(), "alice", func(tx *Tx) error { return tx.SaveSettings(bad) })
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("invalid theme: %v, want ErrValidation", err)
	}
	if got := read(t, st, "alice", (*Tx).Settings); got != want {
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
		t.Fatal(err)
	}
	want := settings.Default()
	want.Theme = "dark"
	if got := read(t, st, "alice", (*Tx).Settings); got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

// Stored settings that cannot be read are an error, not silently replaced.
func TestUnreadableSettingsAreAnError(t *testing.T) {
	st := openTestStore(t)
	if _, err := st.db.Exec(`INSERT INTO users (id, created_at) VALUES ('alice', '');
		INSERT INTO user_settings (user_id, data, updated_at)
		VALUES ('alice', '{"overviewDays":"many"}', '')`); err != nil {
		t.Fatal(err)
	}
	err := st.View(context.Background(), "alice", func(tx *Tx) error {
		_, err := tx.Settings()
		return err
	})
	if err == nil {
		t.Error("unreadable settings were read without an error")
	}
}
