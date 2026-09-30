// Client-side copy of the server state. Every change goes to the server first;
// its response replaces the local state. The state is reactive, so the Vue
// components render again whenever it changes.

import {reactive} from './vue.js';

/**
 * A day's entry as the client handles it.
 * @typedef {{value: number, skipped: boolean}}
 */
export let Entry;

/**
 * A schedule of a habit, valid from `from` until the next one starts.
 * @typedef {{
 *   from: string,
 *   targetValue: number,
 *   targetType: string,
 *   frequency: !Object,
 * }}
 */
export let Schedule;

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
 *   stats: !Object,
 *   entries: !Object<string, number>,
 *   streakRuns: !Array<{from: string, to: string}>,
 *   daysFrom: string,
 *   days: string,
 *   historyStart: string,
 *   pending: (!Object<string, !Entry>|undefined),
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
 * }}
 */
export let Category;

/**
 * The habits of a category on the overview; `category` is null for the
 * habits without one.
 * @typedef {{category: ?Category, habits: !Array<!Habit>}}
 */
export let Block;

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
  options: {},
});

/** @type {!Set<function(!Object): void>} */
const listeners = new Set();

/**
 * Counts the changes of the state, so that data loaded for a view (see
 * remote-stats.js) can tell whether it may be outdated.
 */
let revision = 0;

/**
 * Returns the number of changes of the state so far.
 * @return {number}
 */
export function stateRevision() {
  return revision;
}

/**
 * Calls `fn` after every change of the state.
 * @param {function(!Object): void} fn
 */
export function subscribe(fn) {
  listeners.add(fn);
}

/** Counts a change of the state and tells the listeners. */
function notify() {
  revision++;
  for (const fn of listeners) {
    fn(state);
  }
}

/**
 * Replaces the state with what the server sent.
 * @param {!Object} next
 */
export function replaceState(next) {
  Object.assign(state, next);
  notify();
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
    state.habits.push(view);
  } else {
    state.habits[i] = {...state.habits[i], ...view};
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
 * and renumbers their positions.
 * @param {!Array<T>} items
 * @param {!Array<string>} ids
 * @return {!Array<T>}
 * @template T
 */
function inOrder(items, ids) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const sorted = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const item of items) {
    if (!ids.includes(item.id)) sorted.push(item);
  }
  sorted.forEach((item, i) => {
    item.position = i;
  });
  return sorted;
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
 * Replaces a habit by a copy that `change` modifies. Habits are never changed
 * in place, so that a view can tell a changed habit by its identity (see the
 * row cache in board-view.js).
 * @param {string} id
 * @param {function(!Habit): void} change
 */
function changeHabit(id, change) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i === -1) return;
  const next = {...state.habits[i]};
  change(next);
  state.habits[i] = next;
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
 * Returns a copy of `map` without `key`.
 * @param {?Object<string, T>|undefined} map
 * @param {string} key
 * @return {!Object<string, T>}
 * @template T
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
    state.categories.push(category);
  } else {
    state.categories[i] = category;
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
 * count as uncategorised. Archived habits are left out unless the
 * showArchived setting is on.
 * @return {!Array<!Block>}
 */
export function groupedHabits() {
  const blocks = state.categories.map((category) => ({category, habits: []}));
  const byId = new Map(blocks.map((b) => [b.category.id, b]));
  const loose = {category: null, habits: []};

  for (const habit of state.habits) {
    if (habit.archivedAt && !state.settings.showArchived) continue;
    (byId.get(habit.categoryId) ?? loose).habits.push(habit);
  }
  if (loose.habits.length > 0) blocks.push(loose);
  return blocks.filter((b) => b.habits.length > 0 || b.category !== null);
}
