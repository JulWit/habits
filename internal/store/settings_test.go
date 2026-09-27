package store

import (
	"context"
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// saveSettings replaces the settings of user with in.
func saveSettings(st *Store, user string, in Settings) error {
	_, err := st.UpdateSettings(context.Background(), user, func(s *Settings) error {
		*s = in
		return nil
	})
	return err
}

// Settings have defaults, are stored and read back, and invalid values are
// rejected as validation errors.
func TestSettingsRoundTripAndValidation(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	got, err := st.GetSettings(ctx, "alice")
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if got != DefaultSettings() {
		t.Errorf("an unknown user gets %+v instead of the defaults", got)
	}

	want := DefaultSettings()
	want.Theme = "dark"
	want.Font = "geist"
	want.Density = "compact"
	want.OverviewDays = 21
	want.BandOpacity = 40
	want.BandFillOpacity = 25
	// Differs from the default, so storing it is actually tested.
	want.ShowBand = false
	if err := saveSettings(st, "alice", want); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if got, _ = st.GetSettings(ctx, "alice"); got != want {
		t.Errorf("round trip: %+v != %+v", got, want)
	}

	bad := DefaultSettings()
	bad.Theme = "neon"
	if err := saveSettings(st, "alice", bad); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("broken theme: %v, want ErrValidation", err)
	}

	bad = DefaultSettings()
	bad.Density = "cramped"
	if err := saveSettings(st, "alice", bad); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("broken density: %v, want ErrValidation", err)
	}
}

// Concurrent updates of different settings do not overwrite each other.
func TestUpdateSettingsIsAtomic(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if _, err := st.UpdateSettings(ctx, "alice", func(s *Settings) error {
		s.Theme = "dark"
		return nil
	}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	got, err := st.UpdateSettings(ctx, "alice", func(s *Settings) error {
		s.Font = "roboto"
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got.Theme != "dark" || got.Font != "roboto" {
		t.Errorf("one of the two changes was lost: %+v", got)
	}

	// A failing apply writes nothing.
	boom := errors.New("nope")
	if _, err := st.UpdateSettings(ctx, "alice", func(s *Settings) error {
		s.Font = "opensans"
		return boom
	}); !errors.Is(err, boom) {
		t.Errorf("UpdateSettings swallowed the error: %v", err)
	}
	if after, _ := st.GetSettings(ctx, "alice"); after.Font != "roboto" {
		t.Errorf("font = %q — an aborted update must write nothing", after.Font)
	}
}

// Language and time zone are stored; unknown time zones are rejected.
func TestLanguageAndTimeZone(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	want := DefaultSettings()
	want.Language = "de"
	want.TimeZone = "Europe/Berlin"
	if err := saveSettings(st, "alice", want); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if got, _ := st.GetSettings(ctx, "alice"); got != want {
		t.Errorf("round trip: %+v != %+v", got, want)
	}

	for _, tz := range []string{"Local", "Europe/Nowhere", "../../etc/passwd"} {
		bad := DefaultSettings()
		bad.TimeZone = tz
		if err := saveSettings(st, "alice", bad); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("zone %q: %v, want ErrValidation", tz, err)
		}
	}
	bad := DefaultSettings()
	bad.Language = "fr"
	if err := saveSettings(st, "alice", bad); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("language fr: %v, want ErrValidation", err)
	}
}

// A setting missing from the stored document gets its default, an invalid one
// (such as a removed option) is reset to it, and a removed setting is ignored.
func TestStoredSettingsFallBackToTheDefaults(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if _, err := st.db.Exec(`INSERT INTO users (id, created_at) VALUES ('alice', '');
		INSERT INTO user_settings (user_id, data, updated_at)
		VALUES ('alice', '{"theme":"dark","font":"lato","pattern":"image","bandOpacity":500,"surfaceBlur":30}', '')`); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetSettings(ctx, "alice")
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	want := DefaultSettings()
	want.Theme = "dark"
	if got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}
