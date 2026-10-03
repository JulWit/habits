// Test data shaped like the server's answers (see docs/API.md), and a
// localStorage for the modules that keep data on the device.

/** The kinds as GET /api/state describes them (domain.KindDescriptors). */
export const KINDS = {
  check: {scale: 1, step: 1, max: 1, unit: ''},
  count: {scale: 10, step: 10, max: 10000, unit: ''},
  time: {scale: 10, step: 50, max: 14400, unit: 'min'},
  distance: {scale: 1000, step: 500, max: 200000, unit: 'm'},
};

/** The day the tests take as today. */
export const TODAY = '2026-10-03';

/**
 * Returns a daily habit as the server sends it, with `overrides` applied.
 * `days` holds one status per day from `daysFrom` (domain.DayStatus).
 * @param {!Object<string, *>=} overrides
 * @return {!Object<string, *>}
 */
export function makeHabit(overrides = {}) {
  return {
    id: 'h1',
    name: 'Water',
    color: 'teal',
    icon: '',
    kind: 'check',
    categoryId: '',
    stepValue: 0,
    unit: '',
    schedules: [{
      from: '2026-01-01',
      targetValue: 1,
      targetType: 'at_least',
      frequency: {
        kind: 'daily',
        timesPerWeek: 0,
        timesPerMonth: 0,
        timesAtMost: false,
        weekdays: 0,
        intervalDays: 0,
        weekInterval: 0,
        weekOfMonth: 0,
        anchorDate: '',
      },
    }],
    position: 0,
    archivedAt: null,
    stats: {currentStreak: 0, bestStreak: 0, streakUnit: 'days'},
    entries: {},
    streakRuns: [],
    daysFrom: '2026-10-01',
    days: 'ooo',
    historyStart: '2026-01-01',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    ...overrides,
  };
}

/**
 * Installs an empty localStorage that keeps its values in memory, as Node has
 * none, and returns it.
 * @return {!Map<string, string>}
 */
export function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  return values;
}
