// Every mutation lives here, so undo has exactly one place to hook into and
// the views stay free of API knowledge.

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

/** Set by app.js: reloads the whole state and reports the active route. */
let deps = { refresh: async () => {}, currentHabitId: () => null, goHome: () => {} };

export function configureActions(next) {
  deps = { ...deps, ...next };
}

/**
 * Says one line into the off-screen live region.
 *
 * Cleared first and set a tick later, because a live region handed the same
 * string twice says nothing the second time — and tapping two days to the same
 * value has to be audible both times.
 *
 * A timer rather than requestAnimationFrame: a frame callback does not run in a
 * tab that is throttled or not painting, and the announcement would simply
 * never arrive. A timer fires either way.
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

/** A tap advances the day by one step, or toggles a yes/no habit. */
export function tapEntry(habitId, iso) {
  const habit = habitById(habitId);
  if (!habit) return;
  const current = habit.entries[iso] ?? 0;
  const next = H.nextValue(habit, current);
  // At the per-kind ceiling a tap has nothing left to do. Writing anyway would
  // cost a request and put an undo step on the stack that undoes nothing.
  if (next === current) return;
  writeEntry(habit, iso, next);
}

/** A long press or right-click: exact value for counters, plain toggle else. */
export function editEntry(habitId, iso) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (habit.kind === "check") {
    writeEntry(habit, iso, (habit.entries[iso] ?? 0) > 0 ? 0 : 1);
    return;
  }
  openValueDialog(habit, iso, (value) => writeEntry(habit, iso, value));
}

/**
 * Requests in flight per cell, so writes to the same day are sent in order.
 *
 * Without this, tapping a counter eight times in a row would fire eight
 * overlapping requests whose order of arrival is not guaranteed, and the last
 * one to land — not the last one tapped — would win.
 */
const inFlight = new Map();

function serialize(key, task) {
  const chain = (inFlight.get(key) ?? Promise.resolve()).then(task, task);
  // The stored link swallows rejections so one failed write does not poison
  // every later write to the same cell.
  inFlight.set(key, chain.catch(() => {}));
  return chain;
}

/**
 * Writes a value and registers the undo step.
 *
 * The new value is shown before the request completes: a check-mark that waits
 * for a round trip feels broken, and it also lets the next tap read the value
 * this one just set instead of racing it. The server stays the authority — a
 * failed write reloads the real state.
 *
 * The server answers with the value it replaced, so undo never has to trust a
 * locally remembered "before" state — it writes that value back.
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
  setEntryLocal(habit.id, iso, value, result.stats);

  const when = formatRelative(iso, state.today);
  const cleared = value === 0 && result.previous > 0;
  // Ticking a habit raises no toast on purpose, so this is the only thing a
  // screen reader gets told about a tap.
  announce(value === 0
    ? `${habit.name}, ${when}: gelöscht`
    : `${habit.name}, ${when}: ${H.formatValue(habit, value)}`);
  record({
    label: `${habit.name} — ${when}`,
    // Only clearing a day interrupts with a toast; ticking something off is
    // not destructive and should stay quiet.
    silent: !cleared,
    toastLabel: `Eintrag gelöscht: ${habit.name}, ${when}`,
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
      label: `„${created.name}" angelegt`,
      silent: true,
      undo: async () => {
        await api.deleteHabit(created.id);
        removeHabit(created.id);
      },
      redo: async () => upsertHabit(await api.restoreHabit(created.id)),
    });
    toast(`„${created.name}" angelegt`);
  });
}

export function editHabit(id) {
  const habit = habitById(id);
  if (!habit) return;
  const before = writableFields(habit);

  openEditor(habit, async (input) => {
    upsertHabit(await api.updateHabit(id, input));
    record({
      label: `„${habit.name}" bearbeitet`,
      silent: true,
      undo: async () => upsertHabit(await api.updateHabit(id, before)),
      redo: async () => upsertHabit(await api.updateHabit(id, input)),
    });
  });
}

/**
 * The fields the editor may change, used to restore a habit after an edit.
 *
 * Every field the editor sends has to appear here. PATCH reads an absent field
 * as "leave it alone", so one missing from this snapshot is silently not undone
 * — the edit half-survives its own undo.
 */
function writableFields(habit) {
  return {
    name: habit.name,
    color: habit.color,
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

  // Deletion is soft on the server, so undo brings the habit back with its
  // whole history instead of recreating an empty one.
  record({
    label: `„${habit.name}" gelöscht`,
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
    label: archived ? `„${name}" archiviert` : `„${name}" reaktiviert`,
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

/**
 * Creates a category.
 *
 * The new category starts empty: habits move into it through the editor, which
 * keeps "make a group" and "put something in it" as two separate, individually
 * undoable steps.
 */
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
    label: `Kategorie „${created.name}" angelegt`,
    silent: true,
    undo: async () => {
      await api.deleteCategory(created.id);
      removeCategory(created.id);
    },
    redo: async () => upsertCategory(await api.restoreCategory(created.id)),
  });
  toast(`Kategorie „${created.name}" angelegt`);
  // Returned so the picker can select the category it just created.
  return created;
}

/**
 * Writes the new order of one block's habits, the way a drag leaves it.
 *
 * Positions are a single sequence across every habit, but a drag only speaks
 * about one block. The global list is therefore walked once, and wherever it
 * holds a habit from that block, the next one from the new order takes its
 * place — so the block's own sequence changes while every habit outside it
 * keeps the exact slot it had.
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
 * Moves a habit one place up (-1) or down (+1) inside its own block.
 *
 * Positions are a single sequence across all habits, so the whole list is sent;
 * swapping the two entries rather than splicing keeps every habit outside this
 * block exactly where it was, whatever order the blocks happen to be in.
 *
 * The neighbours come from groupedHabits(), the same function the board draws
 * from, so "the row above" always means the row the user can actually see —
 * including habits whose category was deleted and that share the leftover block.
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
 * Writes a whole category order, the way a drag leaves it.
 *
 * The board has already rearranged itself — the dragged block sits where it was
 * dropped — so there is nothing to apply optimistically here; only the failure
 * path has work to do, and it puts the list back the way the server still has
 * it.
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

/**
 * Moves a category one place up (-1) or down (+1).
 *
 * No undo step: the opposite arrow is the undo, and a toast after every nudge
 * would bury the board under messages.
 */
export async function moveCategory(id, delta) {
  const before = state.categories.map((c) => c.id);
  const from = before.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= before.length) return;

  const after = [...before];
  after.splice(to, 0, ...after.splice(from, 1));
  // Applied first so the block moves under the click; put back if the server
  // refuses.
  reorderCategoriesLocal(after);
  try {
    await api.reorderCategories(after);
  } catch (err) {
    reorderCategoriesLocal(before);
    toast(errorText(err), { error: true });
  }
}

export async function renameCategory(id, name) {
  const category = categoryById(id);
  if (!category || name === category.name) return;
  const before = category.name;

  try {
    upsertCategory(await api.updateCategory(id, { name }));
  } catch (err) {
    toast(errorText(err), { error: true });
    await deps.refresh();
    return;
  }
  record({
    label: `Kategorie „${before}" umbenannt`,
    silent: true,
    undo: async () => upsertCategory(await api.updateCategory(id, { name: before })),
    redo: async () => upsertCategory(await api.updateCategory(id, { name })),
  });
}

/**
 * Deletes a category. The habits inside are not touched — they keep pointing at
 * it and fall into the "Ohne Kategorie" block, so undo rebuilds the block
 * exactly as it was rather than having to reassign anything.
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
      ? `Kategorie „${category.name}" gelöscht`
      : `Kategorie „${category.name}" gelöscht — ${affected} Gewohnheit${affected === 1 ? "" : "en"} bleiben erhalten`,
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
