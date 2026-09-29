// Statistics a view loads from the server when it is shown: the day
// statistics, a category's statistics and a habit's totals. They are kept per
// key and loaded again once the state has changed, e.g. by a write; until the
// new answer arrives, the view shows the previous one.

import {isConnectionError} from './outbox.js';
import {stateRevision} from './state.js';
import {errorText, toast} from './undo.js';

/**
 * The loaded answers by key.
 * @type {!Map<string, {value: *, revision: number, loading: boolean}>}
 */
const loaded = new Map();

/**
 * Returns the answer loaded for `key`, or undefined before the first one has
 * arrived. Loads it with `fetch` if there is none yet or the state has changed
 * since, and calls `onLoad` once a new answer has arrived, for the view to
 * render again.
 * @param {string} key
 * @param {function(): !Promise<T>} fetch
 * @param {function(): void} onLoad
 * @return {T|undefined}
 * @template T
 */
export function remote(key, fetch, onLoad) {
  let entry = loaded.get(key);
  if (!entry) {
    entry = {value: undefined, revision: -1, loading: false};
    loaded.set(key, entry);
  }
  const revision = stateRevision();
  if (entry.revision !== revision && !entry.loading) {
    entry.loading = true;
    fetch()
        .then((value) => {
          entry.value = value;
          entry.revision = revision;
          onLoad();
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
  return entry.value;
}
