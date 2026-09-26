package store

import (
	"context"
	"errors"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// Settings default cleanly, survive a round trip, and reject nonsense as a
// validation error rather than as a fault.
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
	// Off, because on is the default and would pass without being stored.
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

// Two settings changed at once must both survive — the dialog writes each
// control on its own, so this is the ordinary case, not an exotic one.
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
		s.Font = "lato"
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got.Theme != "dark" || got.Font != "lato" {
		t.Errorf("one of the two changes was lost: %+v", got)
	}

	// A failing apply writes nothing.
	boom := errors.New("nope")
	if _, err := st.UpdateSettings(ctx, "alice", func(s *Settings) error {
		s.Font = "poppins"
		return boom
	}); !errors.Is(err, boom) {
		t.Errorf("UpdateSettings swallowed the error: %v", err)
	}
	if after, _ := st.GetSettings(ctx, "alice"); after.Font != "lato" {
		t.Errorf("font = %q — an aborted update must write nothing", after.Font)
	}
}
