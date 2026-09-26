// Thin wrapper around the JSON API. The application is online-first: there is
// no local cache and no offline queue, so every call here is the single source
// of truth and failures are surfaced rather than swallowed.

import { t } from "./i18n.js";

export class ApiError extends Error {
  /**
   * @param {string} message  the whole sentence, in English
   * @param {number} status
   * @param {{cause?: unknown, template?: string, params?: object}} [options]
   *   what the server filled `message` from. The dictionary is keyed by the
   *   template, not by the finished sentence, so these are what gets translated.
   */
  constructor(message, status, options = {}) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.template = options.template;
    this.params = options.params;
  }
}

/**
 * One request.
 *
 * `type` switches the body from JSON to whatever is passed: an upload sends the
 * file as it is, everything else is serialised.
 */
async function request(method, path, body, type) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined
        ? undefined
        : { "Content-Type": type || "application/json" },
      body: body === undefined ? undefined : (type ? body : JSON.stringify(body)),
    });
  } catch (cause) {
    throw new ApiError(t("No connection to the server"), 0, { cause });
  }

  if (res.status === 401 || res.status === 403) {
    // Authelia's session expired behind our back. Reloading sends the user
    // through the proxy's login flow instead of leaving a dead page behind.
    throw new ApiError(t("Session expired — please reload the page"), res.status);
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
    throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status, {
      template: data?.message,
      params: data?.params,
    });
  }
  return data;
}

export const api = {
  // Whether archived habits are included is a stored setting, so the server
  // already knows. `from` widens the entry window when the board has been paged
  // back past what the default window covers.
  loadState: (from) =>
    request("GET", from ? `/api/state?from=${encodeURIComponent(from)}` : "/api/state"),
  getHabit: (id) => request("GET", `/api/habits/${encodeURIComponent(id)}`),
  createHabit: (input) => request("POST", "/api/habits", input),
  updateHabit: (id, input) => request("PATCH", `/api/habits/${encodeURIComponent(id)}`, input),
  deleteHabit: (id) => request("DELETE", `/api/habits/${encodeURIComponent(id)}`),
  restoreHabit: (id) => request("POST", `/api/habits/${encodeURIComponent(id)}/restore`, {}),
  reorderHabits: (ids) => request("POST", "/api/habits/reorder", { ids }),
  setEntry: (habitId, date, value) =>
    request(
      "PUT",
      `/api/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`,
      { value },
    ),
  saveSettings: (settings) => request("PATCH", "/api/settings", settings),

  // The file itself as the body, not a form: there is one field, and this is
  // what fetch sends when handed a File. The type travels with it, but the
  // server decides from the bytes either way.
  uploadBackground: (file) => request("PUT", "/api/background", file, file.type),
  deleteBackground: () => request("DELETE", "/api/background"),

  createCategory: (input) => request("POST", "/api/categories", input),
  updateCategory: (id, input) => request("PATCH", `/api/categories/${encodeURIComponent(id)}`, input),
  deleteCategory: (id) => request("DELETE", `/api/categories/${encodeURIComponent(id)}`),
  restoreCategory: (id) => request("POST", `/api/categories/${encodeURIComponent(id)}/restore`, {}),
  reorderCategories: (ids) => request("POST", "/api/categories/reorder", { ids }),
};
