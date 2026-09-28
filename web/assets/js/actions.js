// All data changes, including their undo steps.

import { api } from "./api.js";
import {
  state, habitById, upsertHabit, removeHabit, setEntryLocal,
  categoryById, upsertCategory, removeCategory, reorderCategoriesLocal,
  reorderHabitsLocal, groupedHabits,
} from "./state.js";
import { record, toast, errorText } from "./undo.js";
import { openEditor } from "./editor.js";
import { openDayDialog } from "./value.js";
import { formatRelative } from "./dates.js";
import * as H from "./habit.js";
import {
  enqueue, discard, pending, flush, isConnectionError, isSessionExpired, isOffline, setOffline,
} from "./outbox.js";
import { t } from "./i18n.js";

/** Callbacks set by app.js. */
let deps;

export function configureActions(callbacks) {
  deps = callbacks;
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
  if (!H.isScheduled(habit, iso)) {
    clearClosedDay(habit, iso);
    return;
  }
  const { value, skipped } = H.entryOn(habit, iso);
  const next = H.nextValue(habit, value);
  // Nothing to do at the maximum; a skipped day takes the first step.
  if (next === value && !skipped) return;
  writeEntry(habit, iso, { value: next });
}

/**
 * Handles a long press or right-click: opens the day dialog with the value,
 * the skip and the note. A day that is not due only opens with something to
 * clear.
 */
export function editEntry(habitId, iso) {
  const habit = habitById(habitId);
  if (!habit) return;
  if (!H.isScheduled(habit, iso) && H.isEmpty(H.entryOn(habit, iso))) return;
  openDayDialog(habit, iso, (change) => writeEntry(habit, iso, change));
}

/** Clears the value of an unscheduled day. */
function clearClosedDay(habit, iso) {
  if (H.entryOn(habit, iso).value > 0) writeEntry(habit, iso, { value: 0 });
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
 * Returns `entry` with `change` ({value?, skipped?, note?}) applied, as
 * domain.EntryChange.Apply does, to show it before the server answers.
 */
function applied(entry, change) {
  const next = { ...entry };
  if ("value" in change) {
    next.value = change.value;
    next.skipped = false;
  }
  if ("skipped" in change) {
    next.skipped = change.skipped;
    if (change.skipped) next.value = 0;
  }
  if ("note" in change) next.note = change.note.trim();
  return next;
}

/** Reports whether `change` sets the value only, the one change the outbox keeps. */
function isValueOnly(change) {
  return Object.keys(change).length === 1 && "value" in change;
}

/**
 * Writes a change of a day's entry and records the undo step. The change is
 * shown immediately. A change of the value only waits in the outbox if it
 * cannot be sent now (see canSendLater); a skip or a note needs the server.
 * If the server rejects the change, it is taken back and the state reloaded.
 * Undo writes back the previous entry on the condition that the day still
 * holds this one, so it does not overwrite a change made elsewhere in the
 * meantime.
 */
async function writeEntry(habit, iso, change) {
  const before = H.entryOn(habit, iso);
  let after = applied(before, change);
  setEntryLocal(habit.id, iso, after);

  let previous;
  try {
    const result = await serialize(`${habit.id}|${iso}`, () => api.setEntry(habit.id, iso, change));
    sent(habit.id, iso);
    // The entry as stored, e.g. with the note trimmed.
    after = { value: result.value, skipped: result.skipped, note: result.note };
    previous = result.previous;
    setEntryLocal(habit.id, iso, after, result);
  } catch (err) {
    if (!canSendLater(err) || !isValueOnly(change)) {
      setEntryLocal(habit.id, iso, before);
      toast(errorText(err), { error: true });
      await deps.refresh();
      return;
    }
    queue(habit.id, iso, after.value, err);
    // The server did not answer; the entry before is known locally.
    previous = before;
  }

  const when = formatRelative(iso, state.today);
  // Taps show no toast, so announce them.
  announce(describeWrite(habit, when, after));
  // Clearing an unscheduled day cannot be undone, as the server would reject
  // the old value.
  if (!H.isScheduled(habit, iso)) {
    toast(t("Entry cleared: {name}, {when}", { name: habit.name, when }));
    return;
  }
  const cleared = after.value === 0 && !after.skipped && previous.value > 0;
  const skipped = after.skipped && !previous.skipped;
  record({
    label: `${habit.name} — ${when}`,
    // Only clearing or skipping a day shows a toast.
    silent: !cleared && !skipped,
    toastLabel: skipped
      ? t("Day skipped: {name}, {when}", { name: habit.name, when })
      : t("Entry cleared: {name}, {when}", { name: habit.name, when }),
    undo: () => putEntry(habit.id, iso, previous, after),
    redo: () => putEntry(habit.id, iso, after, previous),
  });
}

/** Describes a written entry for the live region. */
function describeWrite(habit, when, entry) {
  const name = habit.name;
  if (entry.skipped) return t("{name}, {when}: skipped", { name, when });
  if (entry.value > 0) return `${name}, ${when}: ${H.formatValue(habit, entry.value)}`;
  if (entry.note) return t("{name}, {when}: note saved", { name, when });
  return t("{name}, {when}: cleared", { name, when });
}

/**
 * Writes a whole entry for undo or redo, on the condition that the day still
 * holds `expect`. If it cannot be sent now, a change of the value only waits
 * in the outbox, and then without the condition: for each day the last value
 * wins.
 */
async function putEntry(habitId, iso, entry, expect) {
  try {
    await api.setEntry(habitId, iso, entry, expect);
    sent(habitId, iso);
  } catch (err) {
    if (!canSendLater(err) || entry.skipped || entry.note !== expect.note) throw err;
    queue(habitId, iso, entry.value, err);
  }
}

/**
 * Reports whether a failed write can wait in the outbox: the server could not
 * be reached, or the session at the reverse proxy has expired. Any other
 * error is a rejection that sending again would not change.
 */
function canSendLater(err) {
  return isConnectionError(err) || isSessionExpired(err);
}

/** Whether the notice about the expired session was shown since the last sent write. */
let expiredNoticeShown = false;

/** Handles a write that reached the server: a waiting older one is obsolete. */
function sent(habitId, iso) {
  discard(habitId, iso);
  setOffline(false);
  expiredNoticeShown = false;
}

/**
 * Queues a write that could not be sent (see canSendLater) and says so on the
 * first one.
 */
function queue(habitId, iso, value, err) {
  if (isSessionExpired(err)) {
    queueUntilSignedIn(habitId, iso, value, err);
    return;
  }
  const wasOffline = isOffline();
  setOffline(true);
  if (!enqueue(habitId, iso, value)) {
    toast(errorText(err), { error: true });
    return;
  }
  if (!wasOffline) toast(t("Offline — changes are kept on this device and sent later."));
}

/**
 * Queues a write refused for an expired session. It is sent once the page is
 * reloaded and the user has signed in again at the reverse proxy.
 */
function queueUntilSignedIn(habitId, iso, value, err) {
  if (!enqueue(habitId, iso, value)) {
    toast(errorText(err), { error: true });
    return;
  }
  if (expiredNoticeShown) return;
  expiredNoticeShown = true;
  toast(t("Session expired — changes are kept on this device and sent after you reload the page."), {
    error: true,
    timeout: 12000,
  });
}

/**
 * Sends the writes waiting in the outbox and reloads the state if any were
 * sent. Writes the server rejects are dropped with a message.
 */
export async function syncOutbox() {
  if (pending().length === 0) return;
  const n = await flush(
    // In order with other writes to the same day.
    (habitId, iso, value) => serialize(`${habitId}|${iso}`, () => api.setEntry(habitId, iso, { value })),
    (err) => toast(t("Not sent: {error}", { error: errorText(err) }), { error: true }),
  );
  if (n === 0) return;
  toast(n === 1 ? t("Back online — 1 change sent") : t("Back online — {n} changes sent", { n }));
  await deps.refresh();
}

/**
 * Skips a range of days ({from, to, note, habitIds}) and records the undo
 * step, which writes the entries before back. Errors are thrown for the
 * dialog to display.
 */
export async function skipDays(input) {
  const { changes } = await api.skipDays(input);
  if (changes.length === 0) {
    toast(t("Nothing to skip: the days are not due or already have an entry."));
    return;
  }
  await deps.refresh();
  // Forward from the entries before to the skipped ones, or back.
  const writes = (back) => changes.map((c) => ({
    habitId: c.habitId,
    date: c.date,
    expect: back ? c.entry : c.previous,
    entry: back ? c.previous : c.entry,
  }));
  record({
    label: changes.length === 1 ? t("1 day skipped") : t("{n} days skipped", { n: changes.length }),
    undo: () => api.writeEntries(writes(true)),
    redo: () => api.writeEntries(writes(false)),
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

  const name = category.name;
  let label;
  if (affected === 0) label = t("Category \"{name}\" deleted", { name });
  else if (affected === 1) label = t("Category \"{name}\" deleted — 1 habit kept", { name });
  else label = t("Category \"{name}\" deleted — {n} habits kept", { name, n: affected });

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
