// All data changes. The server keeps an undo step for each change that can be
// undone; its answer carries the step's ID (changeId), which the toast offers
// to undo (see undo.js).

import { api } from "./api.js";
import {
  state, habitById, upsertHabit, removeHabit, showPending, dropPending, applyEntryAnswer,
  categoryById, upsertCategory, removeCategory, reorderCategoriesLocal,
  reorderHabitsLocal, groupedHabits,
} from "./state.js";
import { offerUndo, toast, errorText } from "./undo.js";
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

/** Returns an answer without the ID of its undo step, as kept in the state. */
function withoutChange({ changeId, ...rest }) {
  return rest;
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
 * Handles a long press or right-click: opens the day dialog with the value
 * and the skip. A day that is not due only opens with something to clear.
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
 * Returns `entry` with `change` ({value?, skipped?}) applied: what the cell
 * shows until the server answers. A value ends a skip, a skip clears the
 * value.
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
  return next;
}

/** Reports whether `change` sets the value only, the one change the outbox keeps. */
function isValueOnly(change) {
  return Object.keys(change).length === 1 && "value" in change;
}

/**
 * Writes a change of a day's entry. The change is shown at once as pending;
 * the server's answer brings the day's status. A change of the value only
 * waits in the outbox if it cannot be sent now (see canSendLater); a skip
 * needs the server. If the server rejects the change, it is taken back and
 * the state reloaded. Clearing or skipping a day offers to undo it.
 */
async function writeEntry(habit, iso, change) {
  const before = H.entryOn(habit, iso);
  let after = applied(before, change);
  showPending(habit.id, iso, after);
  const historyStart = habit.historyStart;

  let previous = before;
  let changeId = null;
  try {
    const result = await serialize(`${habit.id}|${iso}`, () => api.setEntry(habit.id, iso, change));
    sent(habit.id, iso);
    // The entry as stored.
    after = { value: result.value, skipped: result.skipped };
    previous = result.previous;
    changeId = result.changeId;
    applyEntryAnswer(habit.id, iso, result);
    // An entry before the history's start moves it, which changes the status
    // of other days of a limit.
    if (result.historyStart !== historyStart) await deps.refresh();
  } catch (err) {
    if (!canSendLater(err) || !isValueOnly(change)) {
      dropPending(habit.id, iso);
      toast(errorText(err), { error: true });
      await deps.refresh();
      return;
    }
    queue(habit.id, iso, after.value, err);
  }

  const when = formatRelative(iso, state.today);
  // Taps show no toast, so announce them.
  announce(describeWrite(habit, when, after));
  const name = habit.name;
  if (after.skipped && !previous.skipped) {
    offerUndo(changeId, t("Day skipped: {name}, {when}", { name, when }));
  } else if (after.value === 0 && !after.skipped && previous.value > 0) {
    offerUndo(changeId, t("Entry cleared: {name}, {when}", { name, when }));
  }
}

/** Describes a written entry for the live region. */
function describeWrite(habit, when, entry) {
  const name = habit.name;
  if (entry.skipped) return t("{name}, {when}: skipped", { name, when });
  if (entry.value > 0) return `${name}, ${when}: ${H.formatValue(habit, entry.value)}`;
  return t("{name}, {when}: cleared", { name, when });
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
 * Skips a range of days ({from, to, habitIds}) as one undo step. Errors are
 * thrown for the dialog to display.
 */
export async function skipDays(input) {
  const { skipped, changeId } = await api.skipDays(input);
  if (skipped === 0) {
    toast(t("Nothing to skip: the days are not due or already have an entry."));
    return;
  }
  await deps.refresh();
  offerUndo(changeId, skipped === 1 ? t("1 day skipped") : t("{n} days skipped", { n: skipped }));
}

// ---------- habits ----------

export function createHabit() {
  openEditor(null, async (input) => {
    const created = withoutChange(await api.createHabit(input));
    upsertHabit(created);
    toast(t("\"{name}\" created", { name: created.name }));
  });
}

/** Opens the editor for a habit and saves what it sends. */
export function editHabit(id) {
  const habit = habitById(id);
  if (!habit) return;
  openEditor(habit, async (input) => {
    upsertHabit(withoutChange(await api.updateHabit(id, input)));
  });
}

export async function deleteHabit(id) {
  const habit = habitById(id);
  if (!habit) return;
  let answer;
  try {
    answer = await api.deleteHabit(id);
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  removeHabit(id);
  if (deps.currentHabitId() === id) deps.goHome();
  offerUndo(answer?.changeId, t("\"{name}\" deleted", { name: habit.name }));
}

export async function toggleArchive(id) {
  const habit = habitById(id);
  if (!habit) return;
  const archived = !habit.archivedAt;
  let answer;
  try {
    answer = await api.archiveHabit(id, archived);
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  if (archived && deps.currentHabitId() === id) deps.goHome();
  await deps.refresh();
  const name = habit.name;
  offerUndo(answer?.changeId, archived
    ? t("\"{name}\" archived", { name })
    : t("\"{name}\" reactivated", { name }));
}

// ---------- categories ----------

/** Creates an empty category. */
export async function createCategory(name) {
  const wanted = (name ?? "").trim();
  if (!wanted) return;

  let created;
  try {
    created = withoutChange(await api.createCategory({ name: wanted }));
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  upsertCategory(created);
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

/** Moves a category one place up (-1) or down (+1). Reordering is no undo step. */
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

/** Updates a category. Errors are thrown for the dialog to display. */
export async function updateCategory(id, { name, color, icon, showProgress }) {
  if (!categoryById(id)) return;
  upsertCategory(withoutChange(await api.updateCategory(id, { name, color, icon, showProgress })));
}

/**
 * Deletes a category. Its habits stay, without a category; undo puts them
 * back.
 */
export async function deleteCategory(id) {
  const category = categoryById(id);
  if (!category) return;
  const affected = state.habits.filter((h) => h.categoryId === id).length;

  let answer;
  try {
    answer = await api.deleteCategory(id);
  } catch (err) {
    toast(errorText(err), { error: true });
    return;
  }
  removeCategory(id);
  await deps.refresh();

  const name = category.name;
  let label;
  if (affected === 0) label = t("Category \"{name}\" deleted", { name });
  else if (affected === 1) label = t("Category \"{name}\" deleted — 1 habit kept", { name });
  else label = t("Category \"{name}\" deleted — {n} habits kept", { name, n: affected });
  offerUndo(answer?.changeId, label);
}
