/**
 * @fileoverview Offline support. Entry writes that cannot reach the server wait
 * in an outbox in localStorage and are sent once the connection is back; the
 * last loaded state is kept as well, so the app starts without a connection.
 * Both are per user. Writing an entry sets an absolute value, so sending a
 * queued write later is safe: for each day the last value wins.
 */

import {plural, t} from '../util/i18n.js';

/** @import {Habit, LoadedState} from './state.js' */

/** Prefix of the localStorage key of a user's outbox. */
const OUTBOX = 'habits.outbox';

/** Prefix of the localStorage keys of the remembered state and its user. */
const STATE = 'habits.state';

/**
 * Called when the number of waiting writes or the connection changes.
 * @type {function(): void}
 */
let onStatus = () => {};
/** Whether the last request failed for want of a connection. */
let offline = false;

/**
 * Sets the function called when the status changes.
 * @param {function(): void} fn
 */
export function setStatusHandler(fn) {
  onStatus = fn;
}

/**
 * Reports whether the last request failed for want of a connection.
 * @return {boolean}
 */
export function isOffline() {
  return offline;
}

/**
 * Records whether the server was reachable.
 * @param {boolean} value
 */
export function setOffline(value) {
  if (offline === value) return;
  offline = value;
  onStatus();
}

/**
 * Reports whether `err` means the server could not be reached.
 * @param {*} err
 * @return {boolean}
 */
export function isConnectionError(err) {
  return err?.code === 'offline';
}

/**
 * Reports whether `err` means the session at the reverse proxy has expired.
 * Writes then wait as well, until the page is reloaded and signed in again.
 * @param {*} err
 * @return {boolean}
 */
export function isSessionExpired(err) {
  return err?.code === 'session_expired';
}

// ---------- storage ----------

/**
 * Reads a stored value. localStorage can be unavailable or full; offline
 * support is then off, and the app works as without it.
 * @param {string} key
 * @param {T} fallback returned if nothing is stored
 * @return {T}
 * @template T
 */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Stores a value as JSON; null removes it.
 * @param {string} key
 * @param {*} value
 * @return {boolean} whether it was stored
 */
function write(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}

/** The user the stored data belongs to, from the last loaded state. */
let user = read(`${STATE}.user`, '');

/**
 * Returns the storage key of the outbox of the user.
 * @return {string}
 */
const outboxKey = () => `${OUTBOX}.${user}`;
/**
 * Returns the storage key of the last state of the user.
 * @return {string}
 */
const stateKey = () => `${STATE}.${user}`;

// ---------- the last state ----------

/**
 * Keeps the loaded state for starting without a connection.
 * @param {!LoadedState} loaded
 */
export function rememberState(loaded) {
  const next = loaded.user?.id ?? '';
  if (next !== user) outbox = null;
  user = next;
  write(`${STATE}.user`, user);
  write(stateKey(), loaded);
}

/**
 * Returns the last loaded state, or null.
 * @return {?LoadedState}
 */
export function rememberedState() {
  return read(stateKey(), null);
}

/**
 * Drops the last state and the waiting writes, e.g. once the data is deleted.
 */
export function forget() {
  write(stateKey(), null);
  storeOutbox([]);
  onStatus();
}

// ---------- the outbox ----------

/**
 * A write waiting in the outbox.
 * @typedef {{habitId: string, date: string, value: number}}
 */
export let Write;

/**
 * The outbox as last read or written, so that it is parsed once rather than
 * on every call; null until it is read. Another tab of the app writes the same
 * storage, which drops the copy (see watchOtherTabs).
 * @type {?Array<!Write>}
 */
let outbox = null;

/**
 * Returns the waiting writes, oldest first. The list is a copy.
 * @return {!Array<!Write>}
 */
export function pending() {
  outbox ??= read(outboxKey(), []);
  return [...outbox];
}

/**
 * Stores the waiting writes.
 * @param {!Array<!Write>} list
 * @return {boolean} whether they were stored
 */
function storeOutbox(list) {
  outbox = list;
  return write(outboxKey(), list.length > 0 ? list : null);
}

/**
 * Reads the outbox again on next use once another tab of the app has sent or
 * queued writes.
 */
export function watchOtherTabs() {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === outboxKey()) {
      outbox = null;
      onStatus();
    }
  });
}

/**
 * Queues a write. A newer write to the same day replaces the older one.
 * Returns false if it could not be stored.
 * @param {string} habitId
 * @param {string} date
 * @param {number} value
 * @return {boolean}
 */
export function enqueue(habitId, date, value) {
  const list =
      pending().filter((w) => !(w.habitId === habitId && w.date === date));
  list.push({habitId, date, value});
  const ok = storeOutbox(list);
  onStatus();
  return ok;
}

/**
 * Removes the waiting write for a day, e.g. once a newer one has been sent.
 * With `value`, only a write of that value is removed, so a newer write queued
 * meanwhile stays.
 * @param {string} habitId
 * @param {string} date
 * @param {number=} value
 */
export function discard(habitId, date, value) {
  const list = pending();
  const rest = list.filter(
      (w) =>
          !(w.habitId === habitId && w.date === date &&
            (value === undefined || w.value === value)));
  if (rest.length === list.length) return;
  storeOutbox(rest);
  onStatus();
}

/**
 * Lays the waiting writes over the habits of a loaded state as pending writes
 * (see isPending in habit-helpers.js), so they stay visible until they are
 * sent. Writes to habits that no longer exist are left out. Returns `loaded`
 * with copies of the habits that have waiting writes; the habits passed in are
 * left as they are, as those of the state are frozen.
 * @param {T} loaded
 * @return {T}
 * @template {{habits?: !Array<!Habit>}} T
 */
export function overlay(loaded) {
  const waiting = pending();
  if (waiting.length === 0 || !loaded.habits) return loaded;
  const habits = loaded.habits.map((habit) => {
    const own = waiting.filter((w) => w.habitId === habit.id);
    if (own.length === 0) return habit;
    const pendingWrites = {...habit.pending};
    for (const w of own) {
      pendingWrites[w.date] = {value: w.value, skipped: false};
    }
    return {...habit, pending: pendingWrites};
  });
  return {...loaded, habits};
}

/**
 * The running flush, which a second call joins.
 * @type {?Promise<number>}
 */
let flushing = null;

/**
 * Sends the waiting writes in order with `send(habitId, date, value)`. Stops
 * at the first connection error or expired session and keeps the rest; a
 * write the server rejects is dropped and reported with `onRejected`.
 * Resolves to the number of writes sent.
 * @param {function(string, string, number): !Promise<*>} send
 * @param {function(*, !Write): void} onRejected
 * @return {!Promise<number>}
 */
export function flush(send, onRejected) {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const w of pending()) {
        try {
          await send(w.habitId, w.date, w.value);
          sent++;
        } catch (err) {
          if (isConnectionError(err)) {
            setOffline(true);
            return sent;
          }
          // Kept until the user has signed in again.
          if (isSessionExpired(err)) return sent;
          onRejected(err, w);
        }
        discard(w.habitId, w.date, w.value);
      }
      setOffline(false);
      return sent;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Describes the sync status for the header, or "" when all is sent.
 * @return {string}
 */
export function statusText() {
  const n = pending().length;
  if (n > 0) return plural(n, '{n} change waiting', '{n} changes waiting');
  return offline ? t('Offline') : '';
}
