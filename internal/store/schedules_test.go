package store

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// All schedule versions survive a round trip, oldest first.
func TestSchedulesRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 60))

	prev := h.Current()
	h.TargetValue = 80
	h.Frequency = domain.Frequency{Kind: domain.FreqWeekdays, Weekdays: 0b10101}
	later := prev.From.AddDays(10)
	if err := h.Reschedule(prev, later, false); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	if err := st.UpdateHabit(ctx, "alice", &h); err != nil {
		t.Fatalf("UpdateHabit: %v", err)
	}

	got, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	all := got.Schedules()
	if len(all) != 2 {
		t.Fatalf("got %d schedules, want 2: %+v", len(all), all)
	}
	if all[0].TargetValue != 60 || all[1].TargetValue != 80 || all[1].From != later {
		t.Errorf("schedules = %+v", all)
	}
	if got.TargetValue != 80 || got.Frequency.Kind != domain.FreqWeekdays {
		t.Errorf("current = %d %+v, want the newer schedule", got.TargetValue, got.Frequency)
	}

	listed, err := st.ListHabits(ctx, "alice", false)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(listed) != 1 || len(listed[0].Schedules()) != 2 {
		t.Errorf("ListHabits did not load both schedules: %+v", listed)
	}
}

// The migration to versioned schedules keeps each habit's target and
// frequency as its first schedule, starting on its creation day.
func TestScheduleMigrationKeepsTheCurrentSchedule(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")

	// Build the schema as it was before versioned schedules.
	db := openAtMigration(t, path, "CREATE TABLE habit_schedules")
	created := formatTime(time.Date(2025, 3, 4, 7, 0, 0, 0, time.UTC))
	if _, err := db.Exec(`INSERT INTO habits (id, user_id, name, color, kind, target_value,
		freq_kind, freq_weekdays, freq_week_interval, created_at, updated_at)
		VALUES ('h1', 'alice', 'Old', '#16a34a', 'count', 70, 'weekdays', 5, 1, ?, ?)`,
		created, created); err != nil {
		t.Fatal(err)
	}
	db.Close()

	st, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	h, err := st.GetHabit(ctx, "alice", "h1")
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	want := domain.Schedule{
		From:        day(2025, time.March, 4),
		TargetValue: 70,
		Frequency:   domain.Frequency{Kind: domain.FreqWeekdays, Weekdays: 5, WeekInterval: 1},
	}
	if all := h.Schedules(); len(all) != 1 || all[0] != want {
		t.Errorf("schedules = %+v, want [%+v]", all, want)
	}
}

// openAtMigration creates a database at path with all migrations applied that
// come before the first one containing marker, and returns it open.
func openAtMigration(t *testing.T, path, marker string) *sql.DB {
	t.Helper()
	before := slices.IndexFunc(migrations, func(m string) bool { return strings.Contains(m, marker) })
	if before < 0 {
		t.Fatalf("no migration contains %q", marker)
	}
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, m := range migrations[:before] {
		if _, err := db.Exec(m); err != nil {
			t.Fatalf("old migration: %v", err)
		}
	}
	if _, err := db.Exec(fmt.Sprintf("PRAGMA user_version = %d", before)); err != nil {
		t.Fatal(err)
	}
	return db
}
