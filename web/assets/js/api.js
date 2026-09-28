// Client for the JSON API. Errors are thrown as ApiError.

export class ApiError extends Error {
  /**
   * @param {string} message  the English message
   * @param {number} status
   * @param {{cause?: unknown, code?: string, params?: object}} [options]
   *   code and params of the problem, by which errorText translates it
   */
  constructor(message, status, options = {}) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code;
    this.params = options.params;
  }
}

/**
 * Reports whether the reverse proxy answered in place of the API because the
 * session there has expired. It either refuses the request (401, 403),
 * redirects to its login page, or serves that page directly. A followed
 * redirect to a login page on another origin would fail like a lost
 * connection, so redirects are not followed and show up as "opaqueredirect".
 */
function sessionExpired(res) {
  if (res.status === 401 || res.status === 403) return true;
  if (res.type === "opaqueredirect") return true;
  return res.ok && (res.headers.get("Content-Type") ?? "").startsWith("text/html");
}

/** Sends a request, with `body` as JSON. */
async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The API never redirects; a redirect comes from the reverse proxy (see
      // sessionExpired).
      redirect: "manual",
    });
  } catch (cause) {
    throw new ApiError("No connection to the server", 0, { cause, code: "offline" });
  }

  if (sessionExpired(res)) {
    throw new ApiError("Session expired — please reload the page", res.status, {
      code: "session_expired",
    });
  }
  if (res.status === 204) return withChange(null, res.headers.get("Change-Id"));

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
    throw new ApiError(data?.detail ?? `${res.status} ${res.statusText}`, res.status, {
      code: data?.code,
      params: data?.params,
    });
  }
  return withChange(data, res.headers.get("Change-Id"));
}

/**
 * Adds the undo step a write recorded (the Change-Id header) to its answer as
 * `changeId`, for the undo button. An answer without a body becomes an object
 * holding only that.
 */
function withChange(data, changeId) {
  if (!changeId) return data;
  if (data === null || typeof data !== "object") return { changeId: Number(changeId) };
  return { ...data, changeId: Number(changeId) };
}

export const api = {
  // `from` extends the entry window into the past.
  loadState: (from) =>
    request("GET", from ? `/api/state?from=${encodeURIComponent(from)}` : "/api/state"),
  getHabit: (id) => request("GET", `/api/habits/${encodeURIComponent(id)}`),
  // A habit's values of `year` summed per `grain` (day, week or month).
  habitTotals: (id, year, grain) =>
    request("GET", `/api/habits/${encodeURIComponent(id)}/totals?year=${year}&grain=${grain}`),
  // The day statistics of `year`, of the habits of `categoryId` if given.
  days: (year, categoryId) => request("GET", categoryId
    ? `/api/days?year=${year}&category=${encodeURIComponent(categoryId)}`
    : `/api/days?year=${year}`),
  createHabit: (input) => request("POST", "/api/habits", input),
  // Saves what the editor shows; a new target or frequency starts today
  // unless `retroactive` is set, a new kind converts the history.
  updateHabit: (id, input) => request("PATCH", `/api/habits/${encodeURIComponent(id)}`, input),
  archiveHabit: (id, archived) =>
    request("PATCH", `/api/habits/${encodeURIComponent(id)}`, { archived }),
  deleteHabit: (id) => request("DELETE", `/api/habits/${encodeURIComponent(id)}`),
  reorderHabits: (ids) => request("POST", "/api/habits/reorder", { ids }),
  // `change` sets value, skipped or both; answers with the habit's full view.
  setEntry: (habitId, date, change) =>
    request("PUT", `/api/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`, change),
  // Skips the due days without a value from `from` to `to` of the habits
  // `habitIds`, or of all; answers with the number of days skipped.
  skipDays: (input) => request("POST", "/api/skips", input),
  // Undoes the undo step `id`, or the latest; redo the other way round.
  undo: (id = 0) => request("POST", "/api/undo", { id }),
  redo: (id = 0) => request("POST", "/api/redo", { id }),
  saveSettings: (settings) => request("PATCH", "/api/settings", settings),
  // The habits with their history, and the categories.
  exportHabits: () => request("GET", "/api/export"),
  importHabits: (file) => request("POST", "/api/import", file),
  // Everything: habits, entries, categories, settings and undo steps.
  deleteAllData: () => request("DELETE", "/api/data"),

  createCategory: (input) => request("POST", "/api/categories", input),
  updateCategory: (id, input) => request("PATCH", `/api/categories/${encodeURIComponent(id)}`, input),
  deleteCategory: (id) => request("DELETE", `/api/categories/${encodeURIComponent(id)}`),
  reorderCategories: (ids) => request("POST", "/api/categories/reorder", { ids }),
};
