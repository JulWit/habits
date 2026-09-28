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
  if (res.status === 204) return null;

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
  return data;
}

export const api = {
  // `from` extends the entry window into the past.
  loadState: (from) =>
    request("GET", from ? `/api/state?from=${encodeURIComponent(from)}` : "/api/state"),
  getHabit: (id) => request("GET", `/api/habits/${encodeURIComponent(id)}`),
  createHabit: (input) => request("POST", "/api/habits", input),
  updateHabit: (id, input) => request("PATCH", `/api/habits/${encodeURIComponent(id)}`, input),
  deleteHabit: (id) => request("DELETE", `/api/habits/${encodeURIComponent(id)}`),
  restoreHabit: (id) => request("POST", `/api/habits/${encodeURIComponent(id)}/restore`, {}),
  reorderHabits: (ids) => request("POST", "/api/habits/reorder", { ids }),
  // With `expect`, the server only writes while the day still holds that value
  // and answers 409 otherwise.
  setEntry: (habitId, date, value, expect) =>
    request(
      "PUT",
      `/api/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`,
      expect === undefined ? { value } : { value, expect },
    ),
  saveSettings: (settings) => request("PATCH", "/api/settings", settings),
  // The habits and categories with their settings, without entries.
  exportHabits: () => request("GET", "/api/export"),
  importHabits: (file) => request("POST", "/api/import", file),
  // Everything: habits, entries, categories and settings.
  deleteAllData: () => request("DELETE", "/api/data"),

  createCategory: (input) => request("POST", "/api/categories", input),
  updateCategory: (id, input) => request("PATCH", `/api/categories/${encodeURIComponent(id)}`, input),
  deleteCategory: (id) => request("DELETE", `/api/categories/${encodeURIComponent(id)}`),
  restoreCategory: (id) => request("POST", `/api/categories/${encodeURIComponent(id)}/restore`, {}),
  reorderCategories: (ids) => request("POST", "/api/categories/reorder", { ids }),
};
