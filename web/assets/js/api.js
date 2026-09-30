/**
 * @fileoverview Client for the JSON API. Errors are thrown as ApiError.
 */

/** An error answer of the API, or a failed request. */
export class ApiError extends Error {
  /**
   * @param {string} message the English message
   * @param {number} status the HTTP status, 0 without a connection
   * @param {{
   *   cause: (*|undefined),
   *   code: (string|undefined),
   *   params: (?Object<string, *>|undefined),
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
 * Sends a request, with `body` as JSON.
 * @param {string} method
 * @param {string} path
 * @param {*=} body
 * @return {!Promise<*>} the answer, with `changeId` if the write recorded an
 *     undo step
 * @throws {!ApiError}
 */
async function request(method, path, body) {
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
    });
  } catch (cause) {
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
 * @param {*} data
 * @param {?string} changeId
 * @return {*}
 */
function withChange(data, changeId) {
  if (!changeId) return data;
  if (data === null || typeof data !== 'object') {
    return {changeId: Number(changeId)};
  }
  return {...data, changeId: Number(changeId)};
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
  loadState: (from) => request(
      'GET',
      from ? `/api/state?from=${encodeURIComponent(from)}` : '/api/state'),

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
   * @return {!Promise<!Totals>}
   */
  habitTotals: (id, year, grain) => {
    const path = `/api/habits/${encodeURIComponent(id)}/totals`;
    return request('GET', `${path}?year=${year}&grain=${grain}`);
  },

  /**
   * Loads the day statistics of `year`, of the habits of `categoryId` if
   * given.
   * @param {string} year
   * @param {string=} categoryId
   * @return {!Promise<!Days>}
   */
  days: (year, categoryId) => request(
      'GET',
      categoryId ?
          `/api/days?year=${year}&category=${encodeURIComponent(categoryId)}` :
          `/api/days?year=${year}`),

  /**
   * @param {!HabitInput} input
   * @return {!Promise<!Habit>}
   */
  createHabit: (input) => request('POST', '/api/habits', input),

  /**
   * Saves what the editor shows; a new target or frequency starts today
   * unless `retroactive` is set, a new kind converts the history.
   * @param {string} id
   * @param {!HabitInput} input
   * @return {!Promise<!Habit>}
   */
  updateHabit: (id, input) =>
      request('PATCH', `/api/habits/${encodeURIComponent(id)}`, input),

  /**
   * @param {string} id
   * @param {boolean} archived
   * @return {!Promise<!Habit>}
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
   * @param {{value: (number|undefined), skipped: (boolean|undefined)}} change
   * @return {!Promise<!Habit>}
   */
  setEntry: (habitId, date, change) => {
    const habit = encodeURIComponent(habitId);
    const day = encodeURIComponent(date);
    return request('PUT', `/api/habits/${habit}/entries/${day}`, change);
  },

  /**
   * Skips the due days without a value from `from` to `to` of the habits
   * `habitIds`, or of all; answers with the number of days skipped.
   * @param {{from: string, to: string, habitIds: (!Array<string>|undefined)}}
   *     input
   * @return {!Promise<{skipped: number}>}
   */
  skipDays: (input) => request('POST', '/api/skips', input),

  /**
   * Undoes the undo step `id`, or the latest.
   * @param {number=} id
   * @return {!Promise<{id: number, label: string, params: ?Object<string, *>}>}
   */
  undo: (id = 0) => request('POST', '/api/undo', {id}),

  /**
   * Redoes the undo step `id`, or the one undone last.
   * @param {number=} id
   * @return {!Promise<{id: number, label: string, params: ?Object<string, *>}>}
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
   * @return {!Promise<{habits: number, categories: number, skipped: number}>}
   */
  importHabits: (file) => request('POST', '/api/import', file),

  /**
   * Deletes everything: habits, entries, categories, settings and undo steps.
   * @return {!Promise<*>}
   */
  deleteAllData: () => request('DELETE', '/api/data'),

  /**
   * @param {{name: string}} input
   * @return {!Promise<!Category>}
   */
  createCategory: (input) => request('POST', '/api/categories', input),

  /**
   * @param {string} id
   * @param {!CategoryInput} input
   * @return {!Promise<!Category>}
   */
  updateCategory: (id, input) =>
      request('PATCH', `/api/categories/${encodeURIComponent(id)}`, input),

  /**
   * @param {string} id
   * @return {!Promise<?{changeId: number}>}
   */
  deleteCategory: (id) =>
      request('DELETE', `/api/categories/${encodeURIComponent(id)}`),

  /**
   * @param {!Array<string>} ids
   * @return {!Promise<*>}
   */
  reorderCategories: (ids) => request('POST', '/api/categories/reorder', {ids}),
};
