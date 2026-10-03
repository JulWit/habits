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

/**
 * A request the fake fetch received; the test answers it with `respond` or

 * * fails it, as a lost connection does, with `fail`.
 * @typedef {{
 * method:
 * string,
 *   path: string,
 *   body: *,
 *   respond: function(number, *=):
 * void,
 *   fail: function(): void,
 * }}
 */
let FakeRequest;

/**
 * Installs a fetch that keeps each request until the test answers it, and

 * * returns the requests received so far, oldest first.

 * * @return {!Array<!FakeRequest>}
 */
export function installFetch() {
  const requests = [];
  globalThis.fetch = (path, init = {}) => new Promise((resolve, reject) => {
    requests.push({
      method: init.method ?? 'GET',
      path: String(path),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      respond: (status, body = undefined) => resolve(new Response(
          body === undefined ? null : JSON.stringify(body),
          {status, headers: {'Content-Type': 'application/json'}})),
      fail: () => reject(new TypeError('NetworkError')),
    });
  });
  return requests;
}

/**
 * Waits until the promises and timers queued so far have run.

 * * @return {!Promise<void>}
 */
export function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Returns a state as GET /api/state sends it, with `habits`.

 * * @param {!Array<!Object<string, *>>} habits
 * @return {!Object<string, *>}

 */
export function loadedState(habits) {
  return {
    user: {id: 'u1', name: '', email: ''},
    settings: {showArchived: false},
    today: TODAY,
    categories: [],
    habits,
    colors: [],
    icons: [],
    kinds: KINDS,
    entriesFrom: '2026-01-01',
    earliestEntry: '',
    serverTimeZone: 'UTC',
    build: {},
    options: {},
  };
}
