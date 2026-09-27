package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

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
	if err := st.SaveSettings(ctx, "alice", want); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if got, _ = st.GetSettings(ctx, "alice"); got != want {
		t.Errorf("round trip: %+v != %+v", got, want)
	}

	bad := DefaultSettings()
	bad.Theme = "neon"
	if err := st.SaveSettings(ctx, "alice", bad); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("broken theme: %v, want ErrValidation", err)
	}

	bad = DefaultSettings()
	bad.Density = "cramped"
	if err := st.SaveSettings(ctx, "alice", bad); !errors.Is(err, domain.ErrValidation) {
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
	if err := st.SaveSettings(ctx, "alice", want); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if got, _ := st.GetSettings(ctx, "alice"); got != want {
		t.Errorf("round trip: %+v != %+v", got, want)
	}

	for _, tz := range []string{"Local", "Europe/Nowhere", "../../etc/passwd"} {
		bad := DefaultSettings()
		bad.TimeZone = tz
		if err := st.SaveSettings(ctx, "alice", bad); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("zone %q: %v, want ErrValidation", tz, err)
		}
	}
	bad := DefaultSettings()
	bad.Language = "fr"
	if err := st.SaveSettings(ctx, "alice", bad); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("language fr: %v, want ErrValidation", err)
	}
}

// The migration to a settings document keeps every stored setting.
func TestSettingsMigrationKeepsTheValues(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	db := openAtMigration(t, path, "json_object(")
	if _, err := db.Exec(`INSERT INTO user_settings (user_id, theme, overview_days, show_archived,
		font, reorder_mode, pattern, align_weeks, band_color, band_opacity, bg_dim, bg_blur,
		surface_opacity, surface_blur, density, show_band, band_fill_opacity, language, time_zone,
		updated_at)
		VALUES ('alice', 'dark', 21, 1, 'geist', 'buttons', 'dots', 1, '#2563eb', 40, 60, 10,
		        70, 20, 'compact', 0, 25, 'de', 'Europe/Berlin', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	got, err := st.GetSettings(ctx, "alice")
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	want := Settings{
		Theme: "dark", OverviewDays: 21, ShowArchived: true, Font: "geist", Density: "compact",
		ReorderMode: "buttons", Pattern: "dots", AlignWeeks: true, BandColor: "blue",
		BandOpacity: 40, BandFillOpacity: 25, ShowBand: false, Language: "de",
		TimeZone: "Europe/Berlin",
	}
	if got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
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
