// Loading the state from the server: at start, when the day ends, when the
// page becomes visible again and while offline or writes are waiting. Writes
// still waiting in the outbox are laid over every loaded state and sent.

import {syncOutbox} from './actions.js';
import {api} from './api.js';
import {t} from './i18n.js';
import {isConnectionError, isOffline, overlay, pending, rememberedState, rememberState, setOffline, setStatusHandler, statusText} from './outbox.js';
import {replaceState, state, upsertHabit} from './state.js';
import {errorText, toast} from './undo.js';
import {reactive} from './vue.js';

/**
 * The sync status for the title bar: the number of waiting writes or
 * "Offline" as `text`, "" when all is sent.
 */
export const syncStatus = reactive({text: ''});

/**
 * The start date of the loaded entries, or null for the default window. Kept
 * for all subsequent reloads.
 * @type {?string}
 */
let historyFrom = null;

/** When the state was last loaded (Date.now()), 0 before the first load. */
let lastLoaded = 0;

/** When the loaded `today` ends (Date.now()). */
let dayEndsAt = Infinity;

/**
 * The timer that reloads the state when the loaded `today` ends.
 * @type {number|undefined}
 */
let dayTimer;

/**
 * Loads the state from the server. Writes still waiting in the outbox are laid
 * over it and sent. Without a connection, the last loaded state is shown
 * instead (on startup), or the current one is kept.
 * @return {!Promise<void>}
 */
export async function refresh() {
  let loaded;
  try {
    loaded = await api.loadState(historyFrom);
  } catch (err) {
    if (!isConnectionError(err)) {
      toast(errorText(err), {error: true, timeout: 12000});
      return;
    }
    setOffline(true);
    const remembered = state.user ? null : rememberedState();
    if (remembered) {
      replaceState(overlay(remembered));
      toast(t('Offline — showing the last loaded state'));
    } else if (state.user) {
      // Keep the current state, with writes queued since (e.g. by undo).
      replaceState(overlay({habits: state.habits}));
    } else {
      toast(errorText(err), {error: true, timeout: 12000});
    }
    return;
  }
  rememberState(loaded);
  setOffline(false);
  lastLoaded = Date.now();
  reloadAtNextDay(loaded.nextDayIn);
  // The reloaded state only contains the entry window again.
  fullHistoryLoaded.clear();
  replaceState(overlay(loaded));
  if (pending().length > 0) syncOutbox();
}

/**
 * Reloads the state once the day the server called today is over, so a board
 * left open over midnight moves on to the new day. `ms` comes from the
 * server, which knows the user's time zone. A sleeping device may delay the
 * timer; the reload when the page becomes visible covers that.
 * @param {number|undefined} ms
 */
function reloadAtNextDay(ms) {
  if (typeof ms !== 'number') return;
  clearTimeout(dayTimer);
  dayEndsAt = Date.now() + ms;
  // A second later, so the server has surely reached the new day.
  dayTimer = setTimeout(refresh, ms + 1000);
}

/**
 * How old the state may be when the page becomes visible again before it is
 * reloaded, e.g. to show changes made on another device meanwhile.
 */
const STALE_MS = 10_000;

/**
 * Reports whether the shown state may be outdated: a new day, or loaded a
 * while ago.
 * @return {boolean}
 */
function isStale() {
  const now = Date.now();
  return now >= dayEndsAt || now - lastLoaded > STALE_MS;
}

/** How often to try again while offline or while writes are waiting. */
const RETRY_MS = 30_000;

/**
 * Keeps the sync status up to date and retries: when the browser reports a
 * connection, when the page becomes visible, and every RETRY_MS while
 * something is pending. A page that becomes visible also reloads a state that
 * may be outdated (isStale).
 */
export function initSync() {
  /** Shows the current sync status. */
  const paint = () => {
    syncStatus.text = statusText();
  };
  setStatusHandler(paint);
  paint();

  /** Sends the waiting writes, or reloads the state after being offline. */
  const retry = () => {
    if (pending().length > 0) {
      syncOutbox();
    } else if (isOffline()) {
      refresh();
    }
  };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Sending the waiting writes reloads the state afterwards.
    if (pending().length > 0) {
      syncOutbox();
    } else if (isOffline() || isStale()) {
      refresh();
    }
  });
  setInterval(() => {
    if (isOffline() || pending().length > 0) retry();
  }, RETRY_MS);
}

/**
 * Loads entries back to `from`, unless they are already loaded.
 * @param {string} from
 * @return {!Promise<void>}
 */
export async function extendHistory(from) {
  if (historyFrom !== null && from >= historyFrom) return;
  historyFrom = from;
  await refresh();
}

/**
 * IDs of habits whose complete history has been loaded. /api/state only
 * contains recent entries; the habit view loads the rest per habit.
 * @const {!Set<string>}
 */
const fullHistoryLoaded = new Set();

/**
 * Loads the complete history of a habit, once per loaded state.
 * @param {string} id
 * @return {!Promise<void>}
 */
export async function ensureFullHistory(id) {
  if (fullHistoryLoaded.has(id)) return;
  fullHistoryLoaded.add(id);
  try {
    upsertHabit(await api.getHabit(id));
  } catch (err) {
    fullHistoryLoaded.delete(id);
    // Offline, the view shows the loaded entries; the header says why.
    if (!isConnectionError(err)) toast(errorText(err), {error: true});
  }
}
