// Client for the JSON API. Errors are thrown as ApiError.

import { t } from "./i18n.js";

export class ApiError extends Error {
  /**
   * @param {string} message  the English message
   * @param {number} status
   * @param {{cause?: unknown, template?: string, params?: object}} [options]
   *   template and params of the message, used for translation
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
 * Sends a request. With `type`, `body` is sent as is with that content type;
 * otherwise it is sent as JSON.
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
    // The Authelia session has expired.
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
  // `from` extends the entry window into the past.
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

  // Sends the file as the request body.
  uploadBackground: (file) => request("PUT", "/api/background", file, file.type),
  deleteBackground: () => request("DELETE", "/api/background"),

  createCategory: (input) => request("POST", "/api/categories", input),
  updateCategory: (id, input) => request("PATCH", `/api/categories/${encodeURIComponent(id)}`, input),
  deleteCategory: (id) => request("DELETE", `/api/categories/${encodeURIComponent(id)}`),
  restoreCategory: (id) => request("POST", `/api/categories/${encodeURIComponent(id)}/restore`, {}),
  reorderCategories: (ids) => request("POST", "/api/categories/reorder", { ids }),
};
