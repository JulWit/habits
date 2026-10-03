/**
 * @fileoverview Client for the JSON API. Errors are thrown as ApiError; a
 * request aborted through its signal rejects with the browser's AbortError.
 */

/**
 * @import {Category, CategoryInput, Days, Habit, HabitInput, LoadedState,
 * Totals} from './state.js'
 */

/**
 * The undo step a write recorded, if any (see withChange).
 * @typedef {{changeId?: number}}
 */
export let Changed;

/**
 * An undo step as undo, redo and deleting a category answer with it.
 * @typedef {{id: number, label: string, params: ?Object<string, *>}}
 */
export let Step;

/** An error answer of the API, or a failed request. */
class ApiError extends Error {
  /**
   * @param {string} message the English message
   * @param {number} status the HTTP status, 0 without a connection
   * @param {{
   *   cause?: *,
   *   code?: string,
   *   params?: ?Object<string, *>,
   * }=} options code and params of the problem, by which errorText
   *     translates it
   */
  constructor(message, status, options = {}) {
    super(message, options);
    this.name = 'ApiError';
    /** @const {number} */
    this.status = status;
    /** @const {string|undefined} */
    this.code = options.code;
    /** @const {?Object<string, *>|undefined} */
    this.params = options.params;
  }
}

/**
 * Reports whether the reverse proxy answered in place of the API because the
 * session there has expired. It either refuses the request (401, 403),
 * redirects to its login page, or serves that page directly. A followed
 * redirect to a login page on another origin would fail like a lost
 * connection, so redirects are not followed and show up as "opaqueredirect".
 * @param {!Response} res
 * @return {boolean}
 */
function sessionExpired(res) {
  if (res.status === 401 || res.status === 403) return true;
  if (res.type === 'opaqueredirect') return true;
  return res.ok &&
      (res.headers.get('Content-Type') ?? '').startsWith('text/html');
}

/**
 * Sends a request, with `body` as JSON. `signal` aborts it, e.g. once a view
 * no longer needs the answer.
 * @param {string} method
 * @param {string} path
 * @param {*=} body
 * @param {!AbortSignal=} signal
 * @return {!Promise<*>} the answer, with `changeId` if the write recorded an
 *     undo step
 * @throws {!ApiError}
 */
async function request(method, path, body = undefined, signal = undefined) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined :
                                    {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      // The API never redirects; a redirect comes from the reverse proxy (see
      // sessionExpired).
      redirect: 'manual',
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError(
        'No connection to the server', 0, {cause, code: 'offline'});
  }

  if (sessionExpired(res)) {
    throw new ApiError('Session expired — please reload the page', res.status, {
      code: 'session_expired',
    });
  }
  if (res.status === 204) {
    return withChange(null, res.headers.get('Change-Id'));
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    // A problem details object (RFC 9457) with the extension members code and
    // params.
    throw new ApiError(
        data?.detail ?? `${res.status} ${res.statusText}`, res.status, {
          code: data?.code,
          params: data?.params,
        });
  }
  return withChange(data, res.headers.get('Change-Id'));
}

/**
 * Adds the undo step a write recorded (the Change-Id header) to its answer as
 * `changeId`, for the undo button. An answer without a body becomes an object
 * holding only that.
 * @param {?Object<string, *>} data the parsed answer; every answer of the API
 *     is a JSON object, null without a body
 * @param {?string} changeId
 * @return {?Object<string, *>}
 */
function withChange(data, changeId) {
  if (!changeId) return data;
  if (data === null || typeof data !== 'object') {
    return {changeId: Number(changeId)};
  }
  return {...data, changeId: Number(changeId)};
}

/**
 * Returns `path` with the query parameters `params`, leaving out the empty
 * ones.
 * @param {string} path
 * @param {!Object<string, (string|undefined)>} params
 * @return {string}
 */
function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value) query.set(name, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/**
 * The endpoints of the API; see docs/API.md. Each resolves to the answer, or
 * rejects with an ApiError.
 */
export const api = {
  /**
   * Loads the complete state; `from` extends the entry window into the past.
   * @param {string=} from
   * @return {!Promise<!LoadedState>}
   */
  loadState: (from) => request('GET', withQuery('/api/state', {from})),

  /**
   * Loads a habit with its full history.
   * @param {string} id
   * @return {!Promise<!Habit>}
   */
  getHabit: (id) => request('GET', `/api/habits/${encodeURIComponent(id)}`),

  /**
   * Loads a habit's values of `year` summed per `grain`.
   * @param {string} id
   * @param {string} year
   * @param {string} grain day, week or month
   * @param {!AbortSignal=} signal
   * @return {!Promise<!Totals>}
   */
  habitTotals: (id, year, grain, signal = undefined) => request(
      'GET',
      withQuery(`/api/habits/${encodeURIComponent(id)}/totals`, {year, grain}),
      undefined,
      signal),

  /**
   * Loads the day statistics of `year`, of the habits of `categoryId` if
   * given.
   * @param {string} year
   * @param {string=} categoryId
   * @param {!AbortSignal=} signal
   * @return {!Promise<!Days>}
   */
  days: (year, categoryId = undefined, signal = undefined) => request(
      'GET',
      withQuery('/api/days', {year, category: categoryId}),
      undefined,
      signal),

  /**
   * @param {!HabitInput} input
   * @return {!Promise<Habit & Changed>}
   */
  createHabit: (input) => request('POST', '/api/habits', input),

  /**
   * Saves what the editor shows; a new target or frequency starts today
   * unless `retroactive` is set. The kind cannot change.
   * @param {string} id
   * @param {!HabitInput} input
   * @return {!Promise<Habit & Changed>}
   */
  updateHabit: (id, input) =>
      request('PATCH', `/api/habits/${encodeURIComponent(id)}`, input),

  /**
   * @param {string} id
   * @param {boolean} archived
   * @return {!Promise<Habit & Changed>}
   */
  archiveHabit: (id, archived) =>
      request('PATCH', `/api/habits/${encodeURIComponent(id)}`, {archived}),

  /**
   * @param {string} id
   * @return {!Promise<?{changeId: number}>}
   */
  deleteHabit: (id) =>
      request('DELETE', `/api/habits/${encodeURIComponent(id)}`),

  /**
   * @param {!Array<string>} ids
   * @return {!Promise<*>}
   */
  reorderHabits: (ids) => request('POST', '/api/habits/reorder', {ids}),

  /**
   * Changes a day's entry; `change` sets value, skipped or both. Answers with
   * the habit's full view.
   * @param {string} habitId
   * @param {string} date
   * @param {{value?: number, skipped?: boolean, add?: number}} change `add`
   *     is a step added to the value the server has
   * @return {!Promise<Habit & Changed>}
   */
  setEntry: (habitId, date, change) => {
    const habit = encodeURIComponent(habitId);
    const day = encodeURIComponent(date);
    return request('PUT', `/api/habits/${habit}/entries/${day}`, change);
  },

  /**
   * Skips the due days without a value from `from` to `to` of the habits
   * `habitIds`, or of all; answers with the number of days skipped.
   * @param {{from: string, to: string, habitIds?: !Array<string>}}
   *     input
   * @return {!Promise<{skipped: number, changeId?: number}>}
   */
  skipDays: (input) => request('POST', '/api/skips', input),

  /**
   * Undoes the undo step `id`, or the latest.
   * @param {number=} id
   * @return {!Promise<!Step>}
   */
  undo: (id = 0) => request('POST', '/api/undo', {id}),

  /**
   * Redoes the undo step `id`, or the one undone last.
   * @param {number=} id
   * @return {!Promise<!Step>}
   */
  redo: (id = 0) => request('POST', '/api/redo', {id}),

  /**
   * @param {!Object<string, *>} settings the settings to change, keyed by
   *     their JSON name
   * @return {!Promise<!Object<string, *>>} all settings
   */
  saveSettings: (settings) => request('PATCH', '/api/settings', settings),

  /**
   * Loads the habits with their history, and the categories.
   * @return {!Promise<!Object<string, *>>}
   */
  exportHabits: () => request('GET', '/api/export'),

  /**
   * @param {!Object<string, *>} file an export
   * @return {!Promise<{habits: number, categories: number, skipped: number,
   *     changeId?: number}>}
   */
  importHabits: (file) => request('POST', '/api/import', file),

  /**
   * Deletes everything: habits, entries, categories, settings and undo steps.
   * @return {!Promise<*>}
   */
  deleteAllData: () => request('DELETE', '/api/data'),

  /**
   * @param {{name: string}} input
   * @return {!Promise<Category & Changed>}
   */
  createCategory: (input) => request('POST', '/api/categories', input),

  /**
   * @param {string} id
   * @param {!CategoryInput} input
   * @return {!Promise<Category & Changed>}
   */
  updateCategory: (id, input) =>
      request('PATCH', `/api/categories/${encodeURIComponent(id)}`, input),

  /**
   * Deletes a category; answers with the undo step it recorded.
   * @param {string} id
   * @return {!Promise<!Step>}
   */
  deleteCategory: (id) =>
      request('DELETE', `/api/categories/${encodeURIComponent(id)}`),

  /**
   * @param {!Array<string>} ids
   * @return {!Promise<*>}
   */
  reorderCategories: (ids) => request('POST', '/api/categories/reorder', {ids}),
};
