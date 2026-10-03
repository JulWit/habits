/**
 * @fileoverview Client-side copy of the server state. Every change goes to the
 * server first; its response replaces the local state. The state is reactive,
 * so the Vue components render again whenever it changes.
 *
 * Habits and categories are frozen: they are never changed in place but
 * replaced by a changed copy (see changeHabit). Vue leaves frozen objects as
 * they are, so a habit's history is not wrapped in proxies, and a component
 * receiving a habit as a prop renders again only when it was replaced.
 */

import {reactive, ref} from '../vue.js';

/**
 * A day's entry as the client handles it.
 * @typedef {{value: number, skipped: boolean}}
 */
export let Entry;

/**
 * How often a habit is due (domain.Frequency); `kind` decides which of the
 * other fields apply, the others are 0 or "".
 * @typedef {{
 *   kind: string,
 *   timesPerWeek: number,
 *   timesPerMonth: number,
 *   timesAtMost: boolean,
 *   weekdays: number,
 *   intervalDays: number,
 *   weekInterval: number,
 *   weekOfMonth: number,
 *   anchorDate: string,
 * }}
 */
export let Frequency;

/**
 * A schedule of a habit, valid from `from` until the next one starts.
 * @typedef {{
 *   from: string,
 *   targetValue: number,
 *   targetType: string,
 *   frequency: !Frequency,
 * }}
 */
export let Schedule;

/**
 * The statistics of a habit (domain.Stats).
 * @typedef {{
 *   currentStreak: number,
 *   bestStreak: number,
 *   completionRate: number,
 *   expected: number,
 *   achieved: number,
 *   total: number,
 *   streakUnit: string,
 *   lastDone: string,
 * }}
 */
export let Stats;

/**
 * A habit as the server sends it (habitView), with the pending writes the
 * client adds while it waits for the server.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   color: string,
 *   icon: string,
 *   kind: string,
 *   categoryId: string,
 *   stepValue: number,
 *   unit: string,
 *   schedules: !Array<!Schedule>,
 *   position: number,
 *   archivedAt: ?string,
 *   stats: !Stats,
 *   entries: !Object<string, number>,
 *   streakRuns: !Array<{from: string, to: string}>,
 *   daysFrom: string,
 *   days: string,
 *   historyStart: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   pending?: !Object<string, !Entry>,
 * }}
 */
export let Habit;

/**
 * A category of habits.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   icon: string,
 *   color: string,
 *   showProgress: boolean,
 *   position: number,
 *   createdAt: string,
 *   updatedAt: string,
 * }}
 */
export let Category;

/**
 * The habits of a category on the overview; `category` is null for the
 * habits without one.
 * @typedef {{category: ?Category, habits: !Array<!Habit>}}
 */
export let Block;

/**
 * A habit as the editor sends it (POST /api/habits, PATCH /api/habits/{id}),
 * with its values in stored units.
 * @typedef {{
 *   name: string,
 *   color: string,
 *   icon: string,
 *   kind: string,
 *   categoryId: string,
 *   unit: string,
 *   targetValue: number,
 *   targetType: string,
 *   stepValue?: number,
 *   frequency: !Frequency,
 *   retroactive?: boolean,
 * }}
 */
export let HabitInput;

/**
 * A category as the editor sends it (PATCH /api/categories/{id}).
 * @typedef {{name: string, color: string, icon: string, showProgress: boolean}}
 */
export let CategoryInput;

/**
 * The totals of a habit's year as the server sums them
 * (GET /api/habits/{id}/totals).
 * @typedef {{
 *   buckets: !Array<{start: string, sum: number, cumulative: number}>,
 *   total: number,
 *   best: number,
 *   activeDays: number,
 * }}
 */
export let Totals;

/**
 * The day statistics of a year (domain.DayStats). A group has the average
 * share of completed habits of a weekday or month, null if nothing was due.
 * @typedef {{
 *   perfect: number,
 *   counted: number,
 *   currentStreak: number,
 *   bestStreak: number,
 *   average: ?number,
 *   completed: number,
 *   emptyDays: number,
 *   weekdays: !Array<{rate: ?number, perfect: number}>,
 *   firstMonth: number,
 *   months: !Array<{rate: ?number, perfect: number}>,
 *   bestWeekday: number,
 *   bestMonth: number,
 * }}
 */
export let DayStats;

/**
 * The habits due and done on one day (domain.DayTotal); `bonus` counts those
 * done beyond what their week or month needs.
 * @typedef {{date: string, due: number, done: number, bonus: number}}
 */
export let DayTotal;

/**
 * The days of a year as GET /api/days sends them.
 * @typedef {{
 *   year: number,
 *   totals: !Array<!DayTotal>,
 *   stats: !DayStats,
 *   habits: number,
 *   expected: number,
 *   achieved: number,
 * }}
 */
export let Days;

/**
 * The state as GET /api/state sends it; `settings` are keyed by their JSON
 * name, `options` lists the choices of the enumerated settings.
 * @typedef {{
 *   user: {id: string, name: string, email: string},
 *   settings: !Object<string, *>,
 *   today: string,
 *   nextDayIn: number,
 *   categories: !Array<!Category>,
 *   habits: !Array<!Habit>,
 *   colors: !Array<string>,
 *   icons: !Array<string>,
 *   kinds: !Object<string, !Object<string, *>>,
 *   entriesFrom: string,
 *   earliestEntry: string,
 *   serverTimeZone: string,
 *   build: !Object<string, *>,
 *   options: !Object<string, !Array<!Object<string, string>>>,
 * }}
 */
export let LoadedState;

/**
 * The state the client keeps: a loaded state without the fields only loading
 * needs. `user` and `build` are null until the first load.
 * @typedef {{
 *   user: ?{id: string, name: string, email: string},
 *   settings: !Object<string, *>,
 *   today: string,
 *   categories: !Array<!Category>,
 *   habits: !Array<!Habit>,
 *   colors: !Array<string>,
 *   icons: !Array<string>,
 *   kinds: !Object<string, !Object<string, *>>,
 *   entriesFrom: string,
 *   earliestEntry: string,
 *   serverTimeZone: string,
 *   build: ?Object<string, *>,
 *   options: !Object<string, !Array<!Object<string, string>>>,
 * }}
 */
export let AppState;

/**
 * The loaded state; empty until the first load.
 * @type {!AppState}
 */
export const state = reactive({
  user: null,
  // Complete once the state is loaded.
  settings: {},
  today: '',
  categories: [],
  habits: [],
  colors: [],
  icons: [],
  kinds: {},
  entriesFrom: '',
  earliestEntry: '',
  serverTimeZone: '',
  build: null,
  options: {},
});

/**
 * Counts the changes of the state, so that data loaded for a view (see
 * remote-stats.js) can tell whether it may be outdated. Reactive, so a view
 * that reads it renders again after every change.
 */
const revision = ref(0);

/**
 * Returns the number of changes of the state so far.
 * @return {number}
 */
export function stateRevision() {
  return revision.value;
}

/** Counts a change of the state. */
function notify() {
  revision.value++;
}

/**
 * Replaces the state, or some of its fields, with what the server sent. The
 * habits and categories are frozen (see the file overview).
 * @param {!Object<string, *>} next
 */
export function replaceState(next) {
  const fields = {...next};
  if (next.habits) fields.habits = next.habits.map(freeze);
  if (next.categories) fields.categories = next.categories.map(freeze);
  Object.assign(state, fields);
  notify();
}

/**
 * Freezes a habit or category, which is then replaced rather than changed.
 * @param {T} record
 * @return {T} `record`
 * @template T
 */
function freeze(record) {
  return Object.freeze(record);
}

/**
 * @param {string} id
 * @return {?Habit} the habit with the ID, or null
 */
export function habitById(id) {
  return state.habits.find((h) => h.id === id) ?? null;
}

/**
 * Replaces a habit with the view returned by the server.
 * @param {!Habit} view
 */
export function upsertHabit(view) {
  const i = state.habits.findIndex((h) => h.id === view.id);
  if (i === -1) {
    state.habits.push(freeze({...view}));
  } else {
    state.habits[i] = freeze({...state.habits[i], ...view});
  }
  notify();
}

/**
 * Reorders the habits locally, before the server confirms. The caller restores
 * the old order if the request fails.
 * @param {!Array<string>} ids
 */
export function reorderHabitsLocal(ids) {
  state.habits = inOrder(state.habits, ids);
  notify();
}

/**
 * Returns `items` sorted by `ids`, followed by the items missing from `ids`,
 * with their positions renumbered. An item whose position changes is replaced
 * by a copy.
 * @param {!Array<T>} items
 * @param {!Array<string>} ids
 * @return {!Array<T>}
 * @template {{id: string, position: number}} T
 */
export function inOrder(items, ids) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const wanted = new Set(ids);
  const sorted = [
    ...ids.flatMap((id) => byId.get(id) ?? []),
    ...items.filter((item) => !wanted.has(item.id)),
  ];
  return sorted.map(
      (item, i) => item.position === i ? item : freeze({...item, position: i}));
}

/**
 * Removes a habit from the state.
 * @param {string} id
 */
export function removeHabit(id) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i !== -1) state.habits.splice(i, 1);
  notify();
}

/**
 * Replaces a habit by a copy that `change` modifies. Habits are frozen and
 * never changed in place, so that a component can tell a changed habit by its
 * identity.
 * @param {string} id
 * @param {function(!Habit): void} change
 */
function changeHabit(id, change) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i === -1) return;
  const next = {...state.habits[i]};
  change(next);
  state.habits[i] = freeze(next);
  notify();
}

/**
 * Shows a write of a day's entry ({value, skipped}) before the server has
 * answered. The day's status stays as it was until then (see isPending in
 * habit-helpers.js).
 * @param {string} habitId
 * @param {string} date
 * @param {!Entry} entry
 */
export function showPending(habitId, date, entry) {
  changeHabit(habitId, (habit) => {
    habit.pending = {...habit.pending, [date]: entry};
  });
}

/**
 * Drops the pending write of a day, e.g. once the server refused it.
 * @param {string} habitId
 * @param {string} date
 */
export function dropPending(habitId, date) {
  if (!habitById(habitId)?.pending?.[date]) return;
  changeHabit(habitId, (habit) => {
    habit.pending = withoutKey(habit.pending, date);
  });
}

/**
 * Takes over the server's answer to a write of a day's entry: the habit with
 * its full history. The write of `date` is no longer pending; those of other
 * days still are.
 * @param {string} date
 * @param {!Habit} view
 */
export function applyEntryAnswer(date, view) {
  changeHabit(view.id, (habit) => {
    Object.assign(habit, view);
    habit.pending = withoutKey(habit.pending, date);
  });
}

/**
 * Returns a copy of the pending writes `map` without `key`.
 * @param {?Object<string, !Entry>|undefined} map
 * @param {string} key
 * @return {!Object<string, !Entry>}
 */
function withoutKey(map, key) {
  const {[key]: _, ...rest} = map ?? {};
  return rest;
}

/**
 * @param {string} id
 * @return {?Category} the category with the ID, or null
 */
export function categoryById(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

/**
 * Replaces a category with the one returned by the server.
 * @param {!Category} category
 */
export function upsertCategory(category) {
  const i = state.categories.findIndex((c) => c.id === category.id);
  if (i === -1) {
    state.categories.push(freeze({...category}));
  } else {
    state.categories[i] = freeze({...category});
  }
  notify();
}

/**
 * Reorders the categories locally, before the server confirms, and renumbers
 * their positions. The caller restores the old order if the request fails.
 * @param {!Array<string>} ids
 */
export function reorderCategoriesLocal(ids) {
  state.categories = inOrder(state.categories, ids);
  notify();
}

/**
 * Removes a category from the state.
 * @param {string} id
 */
export function removeCategory(id) {
  const i = state.categories.findIndex((c) => c.id === id);
  if (i !== -1) state.categories.splice(i, 1);
  notify();
}

/**
 * Returns the number of archived habits. The state holds them all.
 * @return {number}
 */
export function archivedCount() {
  return state.habits.filter((h) => h.archivedAt).length;
}

/**
 * Returns the habits shown on the overview grouped by category in display
 * order, followed by the uncategorised habits. Habits of deleted categories
 * count as uncategorised. Archived habits are included if `archived` is set,
 * by default if the showArchived setting is on.
 * @param {{archived?: boolean}=} options
 * @return {!Array<!Block>}
 */
export function groupedHabits({archived = state.settings.showArchived} = {}) {
  /** @type {!Array<!Block>} */
  const blocks = state.categories.map((category) => ({category, habits: []}));
  const byId = new Map(blocks.map((b) => [b.category?.id, b]));
  /** @type {!Block} */
  const loose = {category: null, habits: []};

  for (const habit of state.habits) {
    if (habit.archivedAt && !archived) continue;
    (byId.get(habit.categoryId) ?? loose).habits.push(habit);
  }
  if (loose.habits.length > 0) blocks.push(loose);
  return blocks.filter((b) => b.habits.length > 0 || b.category !== null);
}

/**
 * Returns the user's time zone, else the server's, or undefined (the
 * browser's own) if the browser knows neither.
 * @return {string|undefined}
 */
export function userTimeZone() {
  for (const zone of [state.settings?.timeZone, state.serverTimeZone]) {
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat('en', {timeZone: zone});
      return zone;
    } catch {
      // Unknown to the browser; try the next one.
    }
  }
  return undefined;
}
