// All data changes, including their undo steps.

import { api } from "./api.js";
import {
  state, habitById, upsertHabit, removeHabit, setEntryLocal,
  categoryById, upsertCategory, removeCategory, reorderCategoriesLocal,
  reorderHabitsLocal, groupedHabits,
} from "./state.js";
import { record, toast, errorText } from "./undo.js";
import { openEditor } from "./editor.js";
import { openValueDialog } from "./value.js";
import { formatRelative } from "./dates.js";
import * as H from "./habit.js";
import { t } from "./i18n.js";

/** Callbacks set by app.js. */
let deps = { refresh: async () => {}, currentHabitId: () => null, goHome: () => {} };

export function configureActions(next) {
  deps = { ...deps, ...next };
}

/**
 * Announces a message in the live region. The region is cleared first, so a
 * repeated message is announced again.
 */
let announceTimer = null;

function announce(text) {
  const el = document.getElementById("board-status");
  if (!el) return;
  clearTimeout(announceTimer);
  el.textContent = "";
  announceTimer = setTimeout(() => { el.textContent = text; }, 50);
}

// ---------- entries ----------

/** Handles a tap on a day cell: advances the value by one step. */
export function tapEntry(habitId, iso) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (!H.acceptsEntry(habit, iso)) {
    clearClosedDay(habit, iso);
    return;
  }
  const current = habit.entries[iso] ?? 0;
  const next = H.nextValue(habit, current);
  // Nothing to do at the maximum.
  if (next === current) return;
  writeEntry(habit, iso, next);
}

/** Handles a long press or right-click: opens the value dialog or toggles. */
export function editEntry(habitId, iso) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (!H.acceptsEntry(habit, iso)) {
    clearClosedDay(habit, iso);
    return;
  }
  if (habit.kind === "check") {
    writeEntry(habit, iso, (habit.entries[iso] ?? 0) > 0 ? 0 : 1);
    return;
  }
  openValueDialog(habit, iso, (value) => writeEntry(habit, iso, value));
}

/** Clears the value of an unscheduled day. */
function clearClosedDay(habit, iso) {
  if ((habit.entries[iso] ?? 0) > 0) writeEntry(habit, iso, 0);
}

/** Pending requests per cell, so that writes to the same day stay in order. */
const inFlight = new Map();

function serialize(key, task) {
  const chain = (inFlight.get(key) ?? Promise.resolve()).then(task, task);
  // Ignore failures, so the next write still runs.
  inFlight.set(key, chain.catch(() => {}));
  return chain;
}

/**
 * Writes a value and records the undo step. The value is shown immediately;
 * on failure the state is reloaded. Undo writes back the previous value
 * returned by the server.
 */
async function writeEntry(habit, iso, value) {
  setEntryLocal(habit.id, iso, value);

  let result;
  try {
    result = await serialize(`${habit.id}|${iso}`, () => api.setEntry(habit.id, iso, value));
  } catch (err) {
    toast(errorText(err), { error: true });
    await deps.refresh();
    return;
  }
  setEntryLocal(habit.id, iso, value, result);

  const when = formatRelative(iso, state.today);
  const cleared = value === 0 && result.previous > 0;
  // Taps show no toast, so announce them.
  announce(value === 0
    ? t("{name}, {when}: cleared", { name: habit.name, when })
    : `${habit.name}, ${when}: ${H.formatValue(habit, value)}`);
  // Clearing an unscheduled day cannot be undone, as the server would reject
  // the old value.
  if (!H.acceptsEntry(habit, iso)) {
    toast(t("Entry cleared: {name}, {when}", { name: habit.name, when }));
    return;
  }
  record({
    label: `${habit.name} — ${when}`,
    // Only clearing a day shows a toast.
    silent: !cleared,
    toastLabel: t("Entry cleared: {name}, {when}", { name: habit.name, when }),
    undo: () => api.setEntry(habit.id, iso, result.previous),
    redo: () => api.setEntry(habit.id, iso, value),
  });
}

// ---------- habits ----------

export function createHabit() {
  openEditor(null, async (input) => {
    const created = await api.createHabit(input);
    upsertHabit(created);
    record({
      label: t("\"{name}\" created", { name: created.name }),
      silent: true,
      undo: async () => {
        await api.deleteHabit(created.id);
        removeHabit(created.id);
      },
      redo: async () => upsertHabit(await api.restoreHabit(created.id)),
    });
    toast(t("\"{name}\" created", { name: created.name }));
  });
}

export function editHabit(id) {
  const habit = habitById(id);
  if (!habit) return;
  const before = writableFields(habit);

  openEditor(habit, async (input) => {
    upsertHabit(await api.updateHabit(id, input));
    record({
      label: t("\"{name}\" edited", { name: habit.name }),
      silent: true,
      undo: async () => upsertHabit(await api.updateHabit(id, before)),
      redo: async () => upsertHabit(await api.updateHabit(id, input)),
    });
  });
}

/**
 * Returns all fields the editor can change, for undoing an edit. Must include
 * every field the editor sends.
 */
function writableFields(habit) {
  return {
    name: habit.name,
    color: habit.color,
    icon: habit.icon ?? "",
    kind: habit.kind,
    categoryId: habit.categoryId,
    targetValue: habit.targetValue,
    stepValue: habit.stepValue,
    unit: habit.unit,
    frequency: { ...habit.frequency },
  };
}

export async function deleteHabit(id) {
  const habit = habitById(id);
  if (!habit) return;
  try {
    await api.deleteHabit(id);
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  removeHabit(id);
  if (deps.currentHabitId() === id) deps.goHome();

  // Undo restores the soft-deleted habit.
  record({
    label: t("\"{name}\" deleted", { name: habit.name }),
    undo: async () => upsertHabit(await api.restoreHabit(id)),
    redo: async () => {
      await api.deleteHabit(id);
      removeHabit(id);
    },
  });
}

export async function toggleArchive(id) {
  const habit = habitById(id);
  if (!habit) return;
  const archived = !habit.archivedAt;
  const name = habit.name;

  try {
    await api.updateHabit(id, { archived });
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  if (archived && deps.currentHabitId() === id) deps.goHome();
  await deps.refresh();

  record({
    label: archived
      ? t("\"{name}\" archived", { name })
      : t("\"{name}\" reactivated", { name }),
    undo: async () => {
      await api.updateHabit(id, { archived: !archived });
      await deps.refresh();
    },
    redo: async () => {
      await api.updateHabit(id, { archived });
      await deps.refresh();
    },
  });
}

// ---------- categories ----------

/** Creates an empty category. */
export async function createCategory(name) {
  const wanted = (name ?? "").trim();
  if (!wanted) return;

  let created;
  try {
    created = await api.createCategory({ name: wanted });
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  upsertCategory(created);
  record({
    label: t("Category \"{name}\" created", { name: created.name }),
    silent: true,
    undo: async () => {
      await api.deleteCategory(created.id);
      removeCategory(created.id);
    },
    redo: async () => upsertCategory(await api.restoreCategory(created.id)),
  });
  toast(t("Category \"{name}\" created", { name: created.name }));
  // Returned so the picker can select it.
  return created;
}

/**
 * Saves a new order of the habits of one category. Habits of other categories
 * keep their positions.
 */
export async function setHabitOrder(ids) {
  const before = state.habits.map((h) => h.id);
  const wanted = [...ids];
  const inBlock = new Set(ids);
  const after = before.map((id) => (inBlock.has(id) ? wanted.shift() : id));

  reorderHabitsLocal(after);
  try {
    await api.reorderHabits(after);
  } catch (err) {
    reorderHabitsLocal(before);
    toast(errorText(err), { error: true });
  }
}

/**
 * Moves a habit one place up (-1) or down (+1) within its category, as shown
 * on the board.
 */
export async function moveHabit(id, delta) {
  const block = groupedHabits().find((b) => b.habits.some((h) => h.id === id));
  if (!block) return;
  const at = block.habits.findIndex((h) => h.id === id);
  const neighbour = block.habits[at + delta];
  if (!neighbour) return;

  const before = state.habits.map((h) => h.id);
  const after = [...before];
  const i = after.indexOf(id);
  const j = after.indexOf(neighbour.id);
  [after[i], after[j]] = [after[j], after[i]];

  reorderHabitsLocal(after);
  try {
    await api.reorderHabits(after);
  } catch (err) {
    reorderHabitsLocal(before);
    toast(errorText(err), { error: true });
  }
}

/**
 * Saves a new order of the categories. The board already shows it; on failure
 * the server's order is restored.
 */
export async function setCategoryOrder(ids) {
  const before = state.categories.map((c) => c.id);
  reorderCategoriesLocal(ids);
  try {
    await api.reorderCategories(ids);
  } catch (err) {
    reorderCategoriesLocal(before);
    toast(errorText(err), { error: true });
  }
}

/** Moves a category one place up (-1) or down (+1). No undo step is recorded. */
export async function moveCategory(id, delta) {
  const before = state.categories.map((c) => c.id);
  const from = before.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= before.length) return;

  const after = [...before];
  after.splice(to, 0, ...after.splice(from, 1));
  // Apply locally first; restored if the request fails.
  reorderCategoriesLocal(after);
  try {
    await api.reorderCategories(after);
  } catch (err) {
    reorderCategoriesLocal(before);
    toast(errorText(err), { error: true });
  }
}

/**
 * Updates a category and records the undo step. Errors are thrown for the
 * dialog to display.
 */
export async function updateCategory(id, { name, color, icon, showProgress }) {
  const category = categoryById(id);
  if (!category) return;
  const before = {
    name: category.name,
    color: category.color ?? "",
    icon: category.icon ?? "",
    showProgress: category.showProgress === true,
  };
  const after = { name, color, icon, showProgress };
  if (Object.keys(after).every((key) => after[key] === before[key])) return;

  upsertCategory(await api.updateCategory(id, after));
  record({
    label: t("Category \"{name}\" edited", { name: before.name }),
    silent: true,
    undo: async () => upsertCategory(await api.updateCategory(id, before)),
    redo: async () => upsertCategory(await api.updateCategory(id, after)),
  });
}

/**
 * Deletes a category. Its habits keep their category ID, so undo restores the
 * category unchanged.
 */
export async function deleteCategory(id) {
  const category = categoryById(id);
  if (!category) return;
  const affected = state.habits.filter((h) => h.categoryId === id).length;

  try {
    await api.deleteCategory(id);
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  removeCategory(id);

  record({
    label: affected === 0
      ? t("Category \"{name}\" deleted", { name: category.name })
      : affected === 1
        ? t("Category \"{name}\" deleted — 1 habit kept", { name: category.name })
        : t("Category \"{name}\" deleted — {n} habits kept", { name: category.name, n: affected }),
    undo: async () => {
      upsertCategory(await api.restoreCategory(id));
      await deps.refresh();
    },
    redo: async () => {
      await api.deleteCategory(id);
      removeCategory(id);
    },
  });
}
