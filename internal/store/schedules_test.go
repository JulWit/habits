package store

import (
	"context"
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// All schedule versions survive a round trip, oldest first.
func TestSchedulesRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 60))

	later := h.Current().From.AddDays(10)
	weekdays := domain.Frequency{Kind: domain.FreqWeekdays, Weekdays: 0b10101}
	if err := h.Reschedule(domain.Schedule{TargetValue: 80, Frequency: weekdays}, later, false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	if err := st.UpdateHabit(ctx, "alice", &h, nil); err != nil {
		t.Fatalf("UpdateHabit: %v", err)
	}

	got, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	all := got.Schedules
	if len(all) != 2 {
		t.Fatalf("got %d schedules, want 2: %+v", len(all), all)
	}
	if all[0].TargetValue != 60 || all[1].TargetValue != 80 || all[1].From != later {
		t.Errorf("schedules = %+v", all)
	}
	if all[1].Frequency.Kind != domain.FreqWeekdays {
		t.Errorf("current frequency = %+v, want the newer one", all[1].Frequency)
	}

	listed, err := st.ListHabits(ctx, "alice", false)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(listed) != 1 || len(listed[0].Schedules) != 2 {
		t.Errorf("ListHabits did not load both schedules: %+v", listed)
	}
}
