package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/settings"

	// SQLite driver, registered by main in the program.
	_ "modernc.org/sqlite"
)

// openTestStore opens a new database in a temporary directory.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// update runs fn in an Update of user and fails the test if it fails. It
// returns the ID of the undo step, if fn recorded one.
func update(t *testing.T, st *Store, user string, fn func(*Tx) error) int64 {
	t.Helper()
	id, err := st.Update(context.Background(), user, fn)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	return id
}

// read returns what fn reads in a View of user and fails the test if it
// fails.
func read[T any](t *testing.T, st *Store, user string, fn func(*Tx) (T, error)) T {
	t.Helper()
	var out T
	err := st.View(context.Background(), user, func(tx *Tx) error {
		var err error
		out, err = fn(tx)
		return err
	})
	if err != nil {
		t.Fatalf("View: %v", err)
	}
	return out
}

// queryInt returns the integer that query selects, e.g. a row count, and
// fails the test if the query fails.
func queryInt(t *testing.T, st *Store, query string) int {
	t.Helper()
	var n int
	if err := st.db.QueryRow(query).Scan(&n); err != nil {
		t.Fatalf("QueryRow(%q): %v", query, err)
	}
	return n
}

// mustCreateHabit creates h for user.
func mustCreateHabit(t *testing.T, st *Store, user string, h domain.Habit) domain.Habit {
	t.Helper()
	update(t, st, user, func(tx *Tx) error { return tx.CreateHabit(t.Context(), &h) })
	return h
}

// setEntry stores e as the entry of h on date, as one recorded undo step, and
// returns its ID.
func setEntry(t *testing.T, st *Store, user string, h domain.Habit, date domain.Date, e domain.Entry) int64 {
	t.Helper()
	return update(t, st, user, func(tx *Tx) error {
		tx.Record("{name} — {date}", "name", h.Name, "date", date.String())
		return tx.SetEntries(t.Context(), h, map[domain.Date]domain.Entry{date: e})
	})
}

// entriesOf returns the entries of the habit id of user.
func entriesOf(t *testing.T, st *Store, user, id string) map[domain.Date]domain.Entry {
	t.Helper()
	return read(t, st, user, func(tx *Tx) (map[domain.Date]domain.Entry, error) { return tx.HabitEntries(t.Context(), id) })
}

// habitOf returns the habit id of user.
func habitOf(t *testing.T, st *Store, user, id string) domain.Habit {
	t.Helper()
	return read(t, st, user, func(tx *Tx) (domain.Habit, error) { return tx.Habit(t.Context(), id) })
}

// day returns a Date (keyed fields, as required by vet).
func day(y int, m time.Month, d int) domain.Date {
	return domain.Date{Year: y, Month: m, Day: d}
}

func countHabit(kind domain.Kind, target int) domain.Habit {
	return domain.Habit{
		Name: "Test", Color: "green", Kind: kind,
		Schedules: []domain.Schedule{
			{From: day(2026, time.January, 1), TargetValue: target, Frequency: domain.Frequency{Kind: domain.FreqDaily}},
		},
	}
}

// Reopening a database keeps its data and does not create the schema again.
func TestReopeningKeepsTheData(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")

	first, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	h := mustCreateHabit(t, first, "alice", countHabit(domain.KindCheck, 1))
	first.Close()

	second, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer second.Close()
	habitOf(t, second, "alice", h.ID)
}

// A failing Update writes nothing.
func TestAFailingUpdateWritesNothing(t *testing.T) {
	st := openTestStore(t)
	boom := errors.New("boom")
	_, err := st.Update(context.Background(), "alice", func(tx *Tx) error {
		h := countHabit(domain.KindCheck, 1)
		if err := tx.CreateHabit(t.Context(), &h); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
	habits := read(t, st, "alice", func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context()) })
	if len(habits) != 0 {
		t.Errorf("%d habits saved by a failed update", len(habits))
	}
}

// A View cannot write.
func TestViewCannotWrite(t *testing.T) {
	st := openTestStore(t)
	err := st.View(context.Background(), "alice", func(tx *Tx) error {
		h := countHabit(domain.KindCheck, 1)
		return tx.CreateHabit(t.Context(), &h)
	})
	if err == nil {
		t.Error("a habit was created in a View")
	}
}

// Stored timestamps sort chronologically as text.
func TestStoredTimestampsSortChronologically(t *testing.T) {
	base := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	ordered := []time.Time{
		base,
		base.Add(1 * time.Nanosecond),
		base.Add(100 * time.Microsecond),
		base.Add(500 * time.Millisecond),    // the ".5" case
		base.Add(500100 * time.Microsecond), // ".5001", which must sort after it
		base.Add(1 * time.Second),
		base.Add(90 * 24 * time.Hour),
	}
	for i := 1; i < len(ordered); i++ {
		earlier, later := formatTime(ordered[i-1]), formatTime(ordered[i])
		if !(earlier < later) {
			t.Errorf("%q does not sort before %q", earlier, later)
		}
	}

	// Stored timestamps parse back to the original time.
	for _, want := range ordered {
		got, err := parseTime(formatTime(want))
		if err != nil {
			t.Errorf("parseTime(%q): %v", formatTime(want), err)
			continue
		}
		if !got.Equal(want) {
			t.Errorf("parseTime(formatTime(%v)) = %v, want %v", want, got, want)
		}
	}
}

// Deleting a user removes all their data, and only theirs.
func TestDeleteUserRemovesAllTheirData(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	var h domain.Habit
	update(t, st, "alice", func(tx *Tx) error {
		cat := domain.Category{Name: "Health"}
		if err := tx.CreateCategory(t.Context(), &cat); err != nil {
			return err
		}
		h = countHabit(domain.KindCount, 10)
		h.CategoryID = cat.ID
		if err := tx.CreateHabit(t.Context(), &h); err != nil {
			return err
		}
		prefs := settings.Default()
		prefs.Theme = "dark"
		return tx.SaveSettings(t.Context(), prefs)
	})
	setEntry(t, st, "alice", h, day(2026, time.January, 5), domain.Entry{Value: 20})
	mustCreateHabit(t, st, "bob", countHabit(domain.KindCheck, 1))

	update(t, st, "alice", func(tx *Tx) error { return tx.DeleteUser(t.Context()) })

	for _, table := range []string{"users", "user_settings", "categories", "habits", "habit_schedules", "entries", "changes"} {
		var n int
		if err := st.db.QueryRowContext(ctx, `SELECT count(*) FROM `+table+` WHERE `+ownerColumn(table)+` = 'alice'`).Scan(&n); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows of alice left", table, n)
		}
	}
	if got := read(t, st, "alice", settingsOf); got != settings.Default() {
		t.Errorf("settings = %+v; want the defaults", got)
	}
	if bobs := read(t, st, "bob", func(tx *Tx) ([]domain.Habit, error) { return tx.Habits(t.Context()) }); len(bobs) != 1 {
		t.Errorf("bob's habits = %d; want 1", len(bobs))
	}
}

// ownerColumn returns an expression for the user a row of table belongs to.
func ownerColumn(table string) string {
	switch table {
	case "users":
		return "id"
	case "habit_schedules", "entries":
		return "(SELECT user_id FROM habits WHERE habits.id = habit_id)"
	default:
		return "user_id"
	}
}
