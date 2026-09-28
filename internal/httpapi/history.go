package httpapi

import (
	"sync"

	"github.com/JulWit/habits/internal/domain"
)

// history holds what a habit's view computes from its whole history: its
// statistics, streak runs and first day.
type history struct {
	stats domain.Stats
	runs  []domain.StreakRun
	start domain.Date
}

// computeHistory computes the history of h from all its entries.
func computeHistory(h domain.Habit, entries map[domain.Date]domain.Entry, b basis) history {
	return history{
		stats: domain.ComputeStats(h, entries, b.today, b.windowDays),
		runs:  domain.StreakRuns(h, entries, b.today),
		start: domain.HistoryStart(h, entries),
	}
}

// historyCache keeps the history of each habit between requests, so that
// loading the state does not walk every habit's whole history each time.
//
// An entry holds as long as its key does: the habit's revision, which the
// database counts up on every change of its schedules and entries (see
// store.revisionTriggers), its kind, today and the rate window. Nothing has
// to be invalidated by hand.
type historyCache struct {
	mu   sync.Mutex
	byID map[string]cachedHistory
}

// historyKey is what a habit's history depends on besides its ID.
type historyKey struct {
	revision   int64
	kind       domain.Kind
	today      domain.Date
	windowDays int
}

type cachedHistory struct {
	key     historyKey
	history history
}

// of returns the history of h, from the cache or computed from the entries
// load returns.
func (c *historyCache) of(h domain.Habit, b basis, load func() (map[domain.Date]domain.Entry, error)) (history, error) {
	key := historyKey{revision: h.Revision, kind: h.Kind, today: b.today, windowDays: b.windowDays}
	c.mu.Lock()
	cached, ok := c.byID[h.ID]
	c.mu.Unlock()
	if ok && cached.key == key {
		return cached.history, nil
	}

	entries, err := load()
	if err != nil {
		return history{}, err
	}
	hist := computeHistory(h, entries, b)
	c.mu.Lock()
	if c.byID == nil {
		c.byID = map[string]cachedHistory{}
	}
	c.byID[h.ID] = cachedHistory{key: key, history: hist}
	c.mu.Unlock()
	return hist, nil
}
