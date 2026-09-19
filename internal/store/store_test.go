package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// openTestStore builds a real SQLite database in the test's temp directory and
// runs every migration against it. The driver is pure Go, so this needs no
// toolchain and no fixture file — and it means the migrations themselves are
// exercised on each run.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	st, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func mustCreateHabit(t *testing.T, st *Store, user string, h domain.Habit) domain.Habit {
	t.Helper()
	if err := st.CreateHabit(context.Background(), user, &h); err != nil {
		t.Fatalf("CreateHabit: %v", err)
	}
	return h
}

// day keeps the Date literals keyed, which vet insists on across packages.
func day(y int, m time.Month, d int) domain.Date {
	return domain.Date{Year: y, Month: m, Day: d}
}

func countHabit(kind domain.Kind, target int) domain.Habit {
	return domain.Habit{
		Name: "Test", Color: "#16a34a", Kind: kind, TargetValue: target,
		Frequency: domain.Frequency{Kind: domain.FreqDaily},
	}
}

// Every migration applies cleanly to an empty file, and re-opening the same
// file is a no-op rather than a second run.
func TestMigrationsAreIdempotent(t *testing.T) {
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
	if _, err := second.GetHabit(ctx, "alice", h.ID); err != nil {
		t.Errorf("habit did not survive the second start: %v", err)
	}
}

// One user must never see, read or write another's rows.
func TestHabitsAreScopedToTheirUser(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	mine := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))

	if _, err := st.GetHabit(ctx, "someone-else", mine.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetHabit foreign: %v, want ErrNotFound", err)
	}
	if err := st.SoftDeleteHabit(ctx, "someone-else", mine.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("SoftDelete foreign: %v, want ErrNotFound", err)
	}
	if _, err := st.SetEntry(ctx, "someone-else", mine.ID, day(2026, time.September, 18), 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("SetEntry foreign: %v, want ErrNotFound", err)
	}
	habits, err := st.ListHabits(ctx, "someone-else", true)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(habits) != 0 {
		t.Errorf("foreign list contains %d habits", len(habits))
	}
}

// The regression guard for the unbounded entry value: the API is reachable
// without the client that used to be the only thing enforcing the ceiling.
func TestSetEntryBoundsTheValue(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))
	day := day(2026, time.September, 18)

	for _, bad := range []int{-1, domain.KindDistance.MaxTarget() + 1, 1 << 40} {
		if _, err := st.SetEntry(ctx, "alice", h.ID, day, bad); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("SetEntry(%d) = %v, want ErrValidation", bad, err)
		}
	}
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, domain.KindDistance.MaxTarget()); err != nil {
		t.Errorf("the maximum itself must be allowed: %v", err)
	}
}

// Undo leans entirely on the returned previous value, and a zero clears the row
// rather than storing a zero.
func TestSetEntryReturnsThePreviousValueAndStaysSparse(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	day := day(2026, time.September, 18)

	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 30); err != nil || prev != 0 {
		t.Fatalf("first write: prev = %d, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 50); err != nil || prev != 30 {
		t.Fatalf("second write: prev = %d, want 30, err = %v", prev, err)
	}
	if prev, err := st.SetEntry(ctx, "alice", h.ID, day, 0); err != nil || prev != 50 {
		t.Fatalf("delete: prev = %d, want 50, err = %v", prev, err)
	}

	entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("EntriesForHabit: %v", err)
	}
	if _, present := entries[day]; present {
		t.Error("a day set to 0 must have no row, not a row holding 0")
	}
}

// The guard against silently reinterpreting a history: 5000 metres are not
// 500 repetitions.
func TestKindCannotChangeOnceThereIsAHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindDistance, 5000))

	// No entries yet: correcting a freshly created habit stays possible.
	changed := h
	changed.Kind = domain.KindCount
	changed.TargetValue = 80
	if err := st.UpdateHabit(ctx, "alice", &changed); err != nil {
		t.Fatalf("kind change without history must be allowed: %v", err)
	}

	// Now give it a history and try again.
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.September, 18), 50); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}
	again := changed
	again.Kind = domain.KindTime
	err := st.UpdateHabit(ctx, "alice", &again)
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("kind change with history: %v, want ErrValidation", err)
	}

	// And the habit is untouched — the transaction rolled the whole thing back.
	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Kind != domain.KindCount {
		t.Errorf("kind = %q, want count — the failure must not have written anything", after.Kind)
	}
}

// Renaming, recolouring and rescheduling a habit that has a history is exactly
// what the guard must not block.
func TestEverythingButTheKindStaysEditable(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 80))
	if _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.September, 18), 50); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}

	h.Name = "Wasser trinken"
	h.Color = "#0284c7"
	h.TargetValue = 100
	h.StepValue = 20
	h.Frequency = domain.Frequency{Kind: domain.FreqTimesPerWeek, TimesPerWeek: 4}
	if err := st.UpdateHabit(ctx, "alice", &h); err != nil {
		t.Fatalf("UpdateHabit: %v", err)
	}

	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.Name != "Wasser trinken" || after.TargetValue != 100 || after.StepValue != 20 {
		t.Errorf("changes did not arrive: %+v", after)
	}
	if after.Frequency.Kind != domain.FreqTimesPerWeek || after.Frequency.TimesPerWeek != 4 {
		t.Errorf("frequency did not arrive: %+v", after.Frequency)
	}
}

// A habit may not be filed under someone else's category, and not under one
// that does not exist.
func TestHabitCannotJoinAForeignCategory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	theirs := domain.Category{Name: "Sport"}
	if err := st.CreateCategory(ctx, "someone-else", &theirs); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = theirs.ID
	if err := st.CreateHabit(ctx, "alice", &h); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("foreign category: %v, want ErrValidation", err)
	}

	h.CategoryID = "does-not-exist"
	if err := st.CreateHabit(ctx, "alice", &h); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown category: %v, want ErrValidation", err)
	}
}

// Deleting is soft, so undo can bring the habit back with its history intact.
func TestSoftDeleteKeepsTheHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	day := day(2026, time.September, 18)
	if _, err := st.SetEntry(ctx, "alice", h.ID, day, 1); err != nil {
		t.Fatalf("SetEntry: %v", err)
	}

	if err := st.SoftDeleteHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("SoftDeleteHabit: %v", err)
	}
	if habits, _ := st.ListHabits(ctx, "alice", true); len(habits) != 0 {
		t.Error("a deleted habit must no longer be listed")
	}
	// Purging only takes what is past the window.
	if n, err := st.PurgeDeleted(ctx, 30*24*time.Hour); err != nil || n != 0 {
		t.Errorf("PurgeDeleted removed %d rows too early (err %v)", n, err)
	}

	if err := st.RestoreHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("RestoreHabit: %v", err)
	}
	entries, err := st.EntriesForHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("EntriesForHabit: %v", err)
	}
	if entries[day] != 1 {
		t.Errorf("the history did not come back: %+v", entries)
	}
}

// Past the retention window the row and its entries go for good.
func TestPurgeRemovesWhatIsPastTheWindow(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	if err := st.SoftDeleteHabit(ctx, "alice", h.ID); err != nil {
		t.Fatalf("SoftDeleteHabit: %v", err)
	}

	// A negative window puts the cutoff in the future, so the row is past it
	// whatever the clock's resolution — on Windows two calls to time.Now() a
	// few statements apart can return the very same instant.
	n, err := st.PurgeDeleted(ctx, -time.Hour)
	if err != nil {
		t.Fatalf("PurgeDeleted: %v", err)
	}
	if n != 1 {
		t.Errorf("PurgeDeleted entfernte %d Zeilen, want 1", n)
	}
	if err := st.RestoreHabit(ctx, "alice", h.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("after the purge: %v, want ErrNotFound", err)
	}
}

// Stored timestamps are compared as text — by the purge, and as the tie-break
// in every list — so the text order has to be the chronological order. A
// trimmed fraction would break that: ".5Z" sorts after ".5001Z".
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

	// And the format still parses back to the instant it came from.
	for _, want := range ordered {
		got, err := parseTime(formatTime(want))
		if err != nil {
			t.Errorf("parseTime(%q): %v", formatTime(want), err)
			continue
		}
		if !got.Equal(want) {
			t.Errorf("round trip: %v != %v", got, want)
		}
	}

	// Rows written before the padding existed still read back correctly.
	if _, err := parseTime("2026-09-19T12:00:00.5Z"); err != nil {
		t.Errorf("old timestamp without padding: %v", err)
	}
}

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
	want.OverviewDays = 21
	want.BandOpacity = 40
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

// A soft-deleted category leaves its habits alone; they only look uncategorised
// until it comes back.
func TestCategorySoftDeleteLeavesHabitsAssigned(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	c := domain.Category{Name: "Sport"}
	if err := st.CreateCategory(ctx, "alice", &c); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	h := countHabit(domain.KindCheck, 1)
	h.CategoryID = c.ID
	h = mustCreateHabit(t, st, "alice", h)

	if err := st.SoftDeleteCategory(ctx, "alice", c.ID); err != nil {
		t.Fatalf("SoftDeleteCategory: %v", err)
	}
	if cats, _ := st.ListCategories(ctx, "alice"); len(cats) != 0 {
		t.Error("the deleted category is still listed")
	}
	after, err := st.GetHabit(ctx, "alice", h.ID)
	if err != nil {
		t.Fatalf("GetHabit: %v", err)
	}
	if after.CategoryID != c.ID {
		t.Errorf("categoryId = %q — the assignment must stay", after.CategoryID)
	}

	if err := st.RestoreCategory(ctx, "alice", c.ID); err != nil {
		t.Fatalf("RestoreCategory: %v", err)
	}
	if cats, _ := st.ListCategories(ctx, "alice"); len(cats) != 1 {
		t.Error("the category did not come back")
	}
}

// Reordering only touches the caller's own rows.
func TestReorderIgnoresForeignIDs(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	b := mustCreateHabit(t, st, "alice", countHabit(domain.KindCheck, 1))
	theirs := mustCreateHabit(t, st, "someone-else", countHabit(domain.KindCheck, 1))

	if err := st.ReorderHabits(ctx, "alice", []string{b.ID, theirs.ID, a.ID}); err != nil {
		t.Fatalf("ReorderHabits: %v", err)
	}
	habits, err := st.ListHabits(ctx, "alice", true)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(habits) != 2 || habits[0].ID != b.ID || habits[1].ID != a.ID {
		t.Errorf("order = %v", habits)
	}
	// The other user's habit kept its own position.
	if other, _ := st.ListHabits(ctx, "someone-else", true); len(other) != 1 {
		t.Error("the foreign list was touched")
	}
}
