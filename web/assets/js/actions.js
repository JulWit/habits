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
import {
  enqueue, discard, pending, flush, isConnectionError, isOffline, setOffline,
} from "./outbox.js";
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

/**
 * The last request per cell. Each write waits for the previous one to the same
 * day, so they reach the server in order.
 */
const inFlight = new Map();

function serialize(key, task) {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const request = previous.then(task);
  // Stored without its failure, so the next write still runs.
  inFlight.set(key, request.catch(() => {}));
  return request;
}

/**
 * Writes a value and records the undo step. The value is shown immediately.
 * Without a connection the write waits in the outbox; if the server rejects
 * it, the state is reloaded. Undo writes back the previous value on the
 * condition that the day still holds this one, so it does not overwrite a
 * change made elsewhere in the meantime.
 */
async function writeEntry(habit, iso, value) {
  const before = habit.entries[iso] ?? 0;
  setEntryLocal(habit.id, iso, value);

  let result;
  try {
    result = await serialize(`${habit.id}|${iso}`, () => api.setEntry(habit.id, iso, value));
    sent(habit.id, iso);
    setEntryLocal(habit.id, iso, value, result);
  } catch (err) {
    if (!isConnectionError(err)) {
      toast(errorText(err), { error: true });
      await deps.refresh();
      return;
    }
    queue(habit.id, iso, value);
    // The server did not answer; the value before is known locally.
    result = { previous: before };
  }

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
    undo: () => putEntry(habit.id, iso, result.previous, value),
    redo: () => putEntry(habit.id, iso, value, result.previous),
  });
}

/**
 * Writes a value for undo or redo, on the condition that the day still holds
 * `expect`. Without a connection the write waits in the outbox, and then
 * without the condition: for each day the last value wins.
 */
async function putEntry(habitId, iso, value, expect) {
  try {
    await api.setEntry(habitId, iso, value, expect);
    sent(habitId, iso);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    queue(habitId, iso, value);
  }
}

/** Handles a write that reached the server: a waiting older one is obsolete. */
function sent(habitId, iso) {
  discard(habitId, iso);
  setOffline(false);
}

/** Queues a write that could not be sent and says so on the first one. */
function queue(habitId, iso, value) {
  const wasOffline = isOffline();
  setOffline(true);
  if (!enqueue(habitId, iso, value)) {
    toast(errorText({ message: "No connection to the server", code: "offline" }), { error: true });
    return;
  }
  if (!wasOffline) toast(t("Offline — changes are kept on this device and sent later."));
}

/**
 * Sends the writes waiting in the outbox and reloads the state if any were
 * sent. Writes the server rejects are dropped with a message.
 */
export async function syncOutbox() {
  if (pending().length === 0) return;
  const n = await flush(
    // In order with other writes to the same day.
    (habitId, iso, value) => serialize(`${habitId}|${iso}`, () => api.setEntry(habitId, iso, value)),
    (err) => toast(t("Not sent: {error}", { error: errorText(err) }), { error: true }),
  );
  if (n === 0) return;
  toast(n === 1 ? t("Back online — 1 change sent") : t("Back online — {n} changes sent", { n }));
  await deps.refresh();
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
    stepValue: habit.stepValue,
    unit: habit.unit,
    // The whole schedule history, so that undo also restores a retroactive
    // change of target or frequency.
    schedules: habit.schedules.map((s) => ({ ...s, frequency: { ...s.frequency } })),
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
 * keep their positions: the category's slots are refilled in the new order.
 */
export function setHabitOrder(ids) {
  const inCategory = new Set(ids);
  const after = [];
  let next = 0;
  for (const habit of state.habits) {
    if (inCategory.has(habit.id)) {
      after.push(ids[next]);
      next++;
    } else {
      after.push(habit.id);
    }
  }
  saveHabitOrder(after);
}

/**
 * Moves a habit one place up (-1) or down (+1) within its category, as shown
 * on the board.
 */
export function moveHabit(id, delta) {
  const block = groupedHabits().find((b) => b.habits.some((h) => h.id === id));
  if (!block) return;
  const at = block.habits.findIndex((h) => h.id === id);
  const neighbour = block.habits[at + delta];
  if (!neighbour) return;

  const after = state.habits.map((h) => h.id);
  swap(after, after.indexOf(id), after.indexOf(neighbour.id));
  saveHabitOrder(after);
}

/** Moves a category one place up (-1) or down (+1). No undo step is recorded. */
export function moveCategory(id, delta) {
  const after = state.categories.map((c) => c.id);
  const from = after.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= after.length) return;

  swap(after, from, to);
  setCategoryOrder(after);
}

function swap(list, i, j) {
  [list[i], list[j]] = [list[j], list[i]];
}

/** Shows the new habit order at once and restores the old one if saving fails. */
async function saveHabitOrder(ids) {
  const before = state.habits.map((h) => h.id);
  reorderHabitsLocal(ids);
  try {
    await api.reorderHabits(ids);
  } catch (err) {
    reorderHabitsLocal(before);
    toast(errorText(err), { error: true });
  }
}

/**
 * Saves a new order of the categories. It is shown at once and restored if
 * saving fails.
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

  let label = t("Category \"{name}\" deleted — {n} habits kept", { name: category.name, n: affected });
  if (affected === 0) label = t("Category \"{name}\" deleted", { name: category.name });
  if (affected === 1) label = t("Category \"{name}\" deleted — 1 habit kept", { name: category.name });

  record({
    label,
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
