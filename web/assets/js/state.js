// Client-side copy of the server state. Every change goes to the server first;
// its response replaces the local state.

import { daysBetween } from "./dates.js";

export const state = {
  user: null,
  // Complete once the state is loaded.
  settings: {},
  today: "",
  categories: [],
  habits: [],
  colors: [],
  icons: [],
  archivedCount: 0,
};

const listeners = new Set();

/**
 * Counts the changes of the state, so that data loaded for a view (see
 * remote-stats.js) can tell whether it may be outdated.
 */
let revision = 0;

export function stateRevision() {
  return revision;
}

/** Calls `fn` after every change of the state. */
export function subscribe(fn) {
  listeners.add(fn);
}

function notify() {
  revision++;
  for (const fn of listeners) fn(state);
}

export function replaceState(next) {
  Object.assign(state, next);
  notify();
}

export function habitById(id) {
  return state.habits.find((h) => h.id === id) ?? null;
}

/** Replaces a habit with the view returned by the server. */
export function upsertHabit(view) {
  const i = state.habits.findIndex((h) => h.id === view.id);
  if (i === -1) state.habits.push(view);
  else state.habits[i] = { ...state.habits[i], ...view };
  notify();
}

/**
 * Reorders the habits locally, before the server confirms. The caller restores
 * the old order if the request fails.
 */
export function reorderHabitsLocal(ids) {
  state.habits = inOrder(state.habits, ids);
  notify();
}

/**
 * Returns `items` sorted by `ids`, followed by the items missing from `ids`,
 * and renumbers their positions.
 */
function inOrder(items, ids) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const sorted = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const item of items) {
    if (!ids.includes(item.id)) sorted.push(item);
  }
  sorted.forEach((item, i) => { item.position = i; });
  return sorted;
}

export function removeHabit(id) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i !== -1) state.habits.splice(i, 1);
  notify();
}

/**
 * Replaces a habit by a copy that `change` modifies. Habits are never changed
 * in place, so that a view can tell a changed habit by its identity (see the
 * row cache in board-view.js).
 */
function changeHabit(id, change) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i === -1) return;
  const next = { ...state.habits[i] };
  change(next);
  state.habits[i] = next;
  notify();
}

/**
 * Shows a write of a day's entry ({value, skipped}) before the server has
 * answered. The day's status stays as it was until then (see isPending in
 * habit-helpers.js).
 */
export function showPending(habitId, date, entry) {
  changeHabit(habitId, (habit) => {
    habit.pending = { ...habit.pending, [date]: entry };
  });
}

/** Drops the pending write of a day, e.g. once the server refused it. */
export function dropPending(habitId, date) {
  if (!habitById(habitId)?.pending?.[date]) return;
  changeHabit(habitId, (habit) => {
    habit.pending = withoutKey(habit.pending, date);
  });
}

/**
 * Takes over the server's answer to a write of a day's entry: the stored
 * value, the day's status, and the statistics and streak runs.
 */
export function applyEntryAnswer(habitId, date, answer) {
  changeHabit(habitId, (habit) => {
    habit.pending = withoutKey(habit.pending, date);
    habit.entries = answer.value > 0
      ? { ...habit.entries, [date]: answer.value }
      : withoutKey(habit.entries, date);
    habit.days = withStatus(habit, date, answer.status);
    habit.stats = answer.stats;
    habit.streakRuns = answer.streakRuns ?? [];
    habit.historyStart = answer.historyStart;
    // The server updates the habit's timestamp on every write.
    if (answer.updatedAt) habit.updatedAt = answer.updatedAt;
  });
}

/** Returns a copy of `map` without `key`. */
function withoutKey(map, key) {
  const { [key]: _, ...rest } = map ?? {};
  return rest;
}

/**
 * Returns the habit's statuses with that of `date` set to `status`, if they
 * cover the day.
 */
function withStatus(habit, date, status) {
  if (!habit.days || !habit.daysFrom || !status) return habit.days;
  const i = daysBetween(habit.daysFrom, date);
  if (i < 0 || i >= habit.days.length) return habit.days;
  return habit.days.slice(0, i) + status + habit.days.slice(i + 1);
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

export function upsertCategory(category) {
  const i = state.categories.findIndex((c) => c.id === category.id);
  if (i === -1) state.categories.push(category);
  else state.categories[i] = category;
  notify();
}

/**
 * Reorders the categories locally, before the server confirms, and renumbers
 * their positions. The caller restores the old order if the request fails.
 */
export function reorderCategoriesLocal(ids) {
  state.categories = inOrder(state.categories, ids);
  notify();
}

export function removeCategory(id) {
  const i = state.categories.findIndex((c) => c.id === id);
  if (i !== -1) state.categories.splice(i, 1);
  notify();
}

/**
 * Returns the habits grouped by category in display order, followed by the
 * uncategorised habits. Habits of deleted categories count as uncategorised.
 */
export function groupedHabits() {
  const blocks = state.categories.map((category) => ({ category, habits: [] }));
  const byId = new Map(blocks.map((b) => [b.category.id, b]));
  const loose = { category: null, habits: [] };

  for (const habit of state.habits) {
    (byId.get(habit.categoryId) ?? loose).habits.push(habit);
  }
  if (loose.habits.length > 0) blocks.push(loose);
  return blocks.filter((b) => b.habits.length > 0 || b.category !== null);
}
