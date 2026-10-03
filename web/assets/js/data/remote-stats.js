/**
 * @fileoverview Statistics a view loads from the server while it is shown: the
 * day statistics, a category's statistics and a habit's totals (useRemote).
 * They are loaded again once the state has changed, e.g. by a write. The
 * latest answers are kept, so a view shown again has them at once.
 */

import {errorText, toast} from '../ui/toast.js';
import {onScopeDispose, ref, shallowRef, watch} from '../vue.js';

import {isConnectionError} from './outbox.js';
import {stateRevision} from './state.js';

/** @import {Ref} from '../vue.js' */

/** How many answers are kept; the oldest one goes first. */
const CACHE_SIZE = 24;

/**
 * The latest answers by key, oldest first, with the state revision they were
 * loaded at.
 * @type {!Map<string, {value: *, revision: number}>}
 */
const cache = new Map();

/**
 * Keeps an answer, dropping the oldest beyond CACHE_SIZE.
 * @param {string} key
 * @param {*} value
 * @param {number} revision
 */
function remember(key, value, revision) {
  cache.delete(key);
  cache.set(key, {value, revision});
  while (cache.size > CACHE_SIZE) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * What useRemote returns: the shown answer (undefined before the first one),
 * whether one is loading, and the error of the last load (null if none).
 * @typedef {{
 *   data: !Ref<*>,
 *   loading: !Ref<boolean>,
 *   error: !Ref<*>,
 * }}
 */
export let Remote;

/**
 * Loads the answer for `key()` with `load` whenever the key or the state
 * changes, and keeps it in `data`. A null key loads nothing (e.g. while the
 * view is hidden). A request that a newer one replaces is aborted, and so is
 * the last when the calling component is unmounted.
 *
 * While a new key loads, `data` shows its kept answer if there is one;
 * otherwise the previous answer stays if `keep(oldKey, newKey)` allows it
 * (e.g. another year of the same category), or `data` is undefined. A failed
 * load leaves `data` as it is: offline, the header says why and the next
 * change of state tries again; other errors are shown in a toast.
 * @param {function(): ?string} key
 * @param {function(!AbortSignal): !Promise<*>} load
 * @param {{keep?: function(string, string): boolean}=} options
 * @return {!Remote}
 */
export function useRemote(key, load, {keep = () => false} = {}) {
  const data = shallowRef(undefined);
  const loading = ref(false);
  const error = shallowRef(null);
  /** @type {?AbortController} */
  let running = null;
  /** @type {?string} */
  let shownKey = null;

  watch(() => [key(), stateRevision()], async ([wanted, revision]) => {
    running?.abort();
    running = null;
    if (wanted === null) {
      loading.value = false;
      return;
    }
    const kept = cache.get(wanted);
    if (kept) {
      data.value = kept.value;
    } else if (shownKey === null || !keep(shownKey, wanted)) {
      data.value = undefined;
    }
    shownKey = wanted;
    if (kept?.revision === revision) {
      loading.value = false;
      return;
    }

    const controller = new AbortController();
    running = controller;
    loading.value = true;
    try {
      const value = await load(controller.signal);
      remember(wanted, value, revision);
      data.value = value;
      error.value = null;
    } catch (err) {
      if (controller.signal.aborted) return;
      error.value = err;
      if (!isConnectionError(err)) toast(errorText(err), {error: true});
    } finally {
      if (running === controller) {
        running = null;
        loading.value = false;
      }
    }
  }, {immediate: true});

  onScopeDispose(() => running?.abort());
  return {data, loading, error};
}
