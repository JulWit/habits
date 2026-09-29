package store

import (
	"testing"

	"github.com/JulWit/habits/internal/domain"
)

// All schedule versions survive a round trip, oldest first.
func TestSchedulesRoundTrip(t *testing.T) {
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 60))

	later := h.Current().From.AddDays(10)
	weekdays := domain.Frequency{Kind: domain.FreqWeekdays, Weekdays: 0b10101}
	if err := h.Reschedule(domain.Schedule{TargetValue: 80, Frequency: weekdays}, later, false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	update(t, st, "alice", func(tx *Tx) error { return tx.SaveHabit(t.Context(), &h) })

	all := habitOf(t, st, "alice", h.ID).Schedules
	if len(all) != 2 {
		t.Fatalf("got %d schedules, want 2: %+v", len(all), all)
	}
	if all[0].TargetValue != 60 || all[1].TargetValue != 80 || all[1].From != later {
		t.Errorf("schedules = %+v, want the target 60, then 80 from %v", all, later)
	}
	if all[1].Frequency.Kind != domain.FreqWeekdays {
		t.Errorf("current frequency = %+v, want the newer one", all[1].Frequency)
	}

	listed := read(t, st, "alice", func(tx *Tx) ([]domain.Habit, error) { return tx.ActiveHabits(t.Context()) })
	if len(listed) != 1 || len(listed[0].Schedules) != 2 {
		t.Errorf("ActiveHabits = %+v, want one habit with 2 schedules", listed)
	}
}
