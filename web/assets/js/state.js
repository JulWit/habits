// Client-side copy of the server state. Every change goes to the server first;
// its response replaces the local state.

export const state = {
  user: null,
  settings: { theme: "light", overviewDays: 0, showArchived: false },
  today: "",
  categories: [],
  habits: [],
  colors: [],
  icons: [],
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

/**
 * Sets a day's value locally. Stats and streak runs are taken from the server's
 * `answer` once it arrives.
 */
export function setEntryLocal(habitId, date, value, answer) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (value > 0) habit.entries[date] = value;
  else delete habit.entries[date];
  if (answer) {
    habit.stats = answer.stats;
    habit.streakRuns = answer.streakRuns ?? [];
    // The server updates the habit's timestamp on every write.
    if (answer.updatedAt) habit.updatedAt = answer.updatedAt;
  }
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
 * Reorders the categories locally, before the server confirms, and renumbers
 * their positions. The caller restores the old order if the request fails.
 */
export function reorderCategoriesLocal(ids) {
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  // Categories missing from `ids` are appended.
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
