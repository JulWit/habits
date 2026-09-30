/**
 * @fileoverview Offline support. Entry writes that cannot reach the server wait
 * in an outbox in localStorage and are sent once the connection is back; the
 * last loaded state is kept as well, so the app starts without a connection.
 * Both are per user. Writing an entry sets an absolute value, so sending a
 * queued write later is safe: for each day the last value wins.
 */

import {t} from '../util/i18n.js';

const OUTBOX = 'habits.outbox';
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
  user = loaded.user?.id ?? '';
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
  write(outboxKey(), null);
  onStatus();
}

// ---------- the outbox ----------

/**
 * Returns the waiting writes: [{habitId, date, value}], oldest first.
 * @return {!Array<{habitId: string, date: string, value: number}>}
 */
export function pending() {
  return read(outboxKey(), []);
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
  const ok = write(outboxKey(), list);
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
  write(outboxKey(), rest.length ? rest : null);
  onStatus();
}

/**
 * Lays the waiting writes over a loaded state as pending writes (see
 * isPending in habit-helpers.js), so they stay visible until they are sent.
 * Writes to habits that no longer exist are left out.
 * @param {!LoadedState} loaded
 * @return {!LoadedState} `loaded`
 */
export function overlay(loaded) {
  for (const w of pending()) {
    const habit = loaded.habits?.find((h) => h.id === w.habitId);
    if (!habit) continue;
    habit.pending ??= {};
    habit.pending[w.date] = {value: w.value, skipped: false};
  }
  return loaded;
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
 */

/**
 * @param {function(string, string, number): !Promise<*>} send
 * @param {function(*, {habitId: string, date: string, value: number}): void}
 *     onRejected
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
  if (n === 1) return t('1 change waiting');
  if (n > 1) return t('{n} changes waiting', {n});
  return offline ? t('Offline') : '';
}
