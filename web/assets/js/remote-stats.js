/**
 * @fileoverview Statistics a view loads from the server when it is shown: the
 * day statistics, a category's statistics and a habit's totals. They are kept
 * per key and loaded again once the state has changed, e.g. by a write; until
 * the new answer arrives, the view shows the previous one.
 */

import {isConnectionError} from './outbox.js';
import {stateRevision} from './state.js';
import {errorText, toast} from './undo.js';
import {shallowRef} from './vue.js';

/**
 * The loaded answers by key. Only `value` is reactive: a view that shows it
 * renders again when a new answer arrives.
 * @type {!Map<string, {value: !Object, revision: number, loading: boolean}>}
 */
const loaded = new Map();

/**
 * Returns the answer loaded for `key`, or undefined before the first one has
 * arrived. Loads it with `fetch` if there is none yet or the state has changed
 * since. Called while a view renders, which then renders again once a new
 * answer has arrived or the state has changed.
 * @param {string} key
 * @param {function(): !Promise<T>} fetch
 * @return {T|undefined}
 * @template T
 */
export function remote(key, fetch) {
  let entry = loaded.get(key);
  if (!entry) {
    entry = {value: shallowRef(undefined), revision: -1, loading: false};
    loaded.set(key, entry);
  }
  const revision = stateRevision();
  if (entry.revision !== revision && !entry.loading) {
    entry.loading = true;
    fetch()
        .then((value) => {
          entry.revision = revision;
          entry.value.value = value;
        })
        .catch((err) => {
          // Offline, the view shows what it has, the header says why, and the
          // next render tries again. Other errors wait for a change of state.
          if (isConnectionError(err)) return;
          entry.revision = revision;
          toast(errorText(err), {error: true});
        })
        .finally(() => {
          entry.loading = false;
        });
  }
  return entry.value.value;
}
