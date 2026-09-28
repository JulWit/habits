package store

import (
	"context"
	"testing"
	"time"

	"github.com/JulWit/habits/internal/domain"
)

// The schema rejects values the application never writes, and removing a user
// removes their data.
func TestSchemaConstraints(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	h := mustCreateHabit(t, st, "alice", countHabit(domain.KindCount, 10))
	if _, _, err := st.SetEntry(ctx, "alice", h.ID, day(2026, time.March, 1), 10, nil); err != nil {
		t.Fatal(err)
	}

	for name, stmt := range map[string]string{
		"unknown kind":    `UPDATE habits SET kind = 'weight'`,
		"zero value":      `UPDATE entries SET value = 0`,
		"text as number":  `UPDATE habits SET position = 'first'`,
		"malformed date":  `UPDATE entries SET date = '1.3.2026'`,
		"unknown user":    `UPDATE habits SET user_id = 'mallory'`,
		"invalid json":    `INSERT INTO user_settings VALUES ('alice', '{', '')`,
		"unknown freq":    `UPDATE habit_schedules SET freq_kind = 'hourly'`,
		"negative target": `UPDATE habit_schedules SET target_value = -1`,
	} {
		if _, err := st.db.Exec(stmt); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	if _, err := st.db.Exec(`DELETE FROM users WHERE id = 'alice'`); err != nil {
		t.Fatalf("deleting the user: %v", err)
	}
	for _, table := range []string{"habits", "habit_schedules", "entries"} {
		var n int
		st.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n)
		if n != 0 {
			t.Errorf("%s: %d rows left after deleting the user", table, n)
		}
	}
}
