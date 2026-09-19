// The single client-side copy of the server state. It is a cache of the last
// response, never a source of truth: every mutation goes to the server and the
// answer replaces what is here.

export const state = {
  user: null,
  settings: { theme: "light", overviewDays: 0, showArchived: false },
  today: "",
  categories: [],
  habits: [],
  colors: [],
  archivedCount: 0,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

export function replaceState(next) {
  Object.assign(state, next);
  notify();
}

export function habitById(id) {
  return state.habits.find((h) => h.id === id) ?? null;
}

/** Swap in an updated habit view returned by a mutation. */
export function upsertHabit(view) {
  const i = state.habits.findIndex((h) => h.id === view.id);
  if (i === -1) state.habits.push(view);
  else state.habits[i] = { ...state.habits[i], ...view };
  notify();
}

/**
 * Puts the habits in the given order.
 *
 * The counterpart to reorderCategoriesLocal: applied before the server has
 * confirmed, and rolled back by the caller if the request fails.
 */
export function reorderHabitsLocal(ids) {
  const byId = new Map(state.habits.map((h) => [h.id, h]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const habit of state.habits) {
    if (!ids.includes(habit.id)) next.push(habit);
  }
  next.forEach((habit, i) => { habit.position = i; });
  state.habits = next;
  notify();
}

export function removeHabit(id) {
  const i = state.habits.findIndex((h) => h.id === id);
  if (i !== -1) state.habits.splice(i, 1);
  notify();
}

/** Apply a single day's value locally so the cell updates without a full reload. */
export function setEntryLocal(habitId, date, value, stats) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (value > 0) habit.entries[date] = value;
  else delete habit.entries[date];
  if (stats) habit.stats = stats;
  notify();
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
 * Puts the categories in the given order.
 *
 * Applied before the server has confirmed, so the block moves under the click
 * rather than a moment later; the caller puts the old order back if the request
 * fails. The positions are renumbered too, so anything reading them agrees with
 * the order of the list.
 */
export function reorderCategoriesLocal(ids) {
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  // Anything the caller did not mention keeps its place at the end, so a
  // category created in another tab cannot fall out of the list.
  for (const category of state.categories) {
    if (!ids.includes(category.id)) next.push(category);
  }
  next.forEach((category, i) => { category.position = i; });
  state.categories = next;
  notify();
}

export function removeCategory(id) {
  const i = state.categories.findIndex((c) => c.id === id);
  if (i !== -1) state.categories.splice(i, 1);
  notify();
}

/**
 * Habits arranged into the blocks the overview draws: one per category in
 * display order, then the leftovers.
 *
 * A habit pointing at a category that is not in the live list — soft-deleted,
 * so still restorable — falls into the uncategorised block rather than
 * disappearing.
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
