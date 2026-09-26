// Undo/redo and the toast that exposes it.
//
// Because nothing is persisted locally, every step is expressed as a pair of
// server calls: `undo` puts the previous state back, `redo` re-applies the
// change. That keeps undo correct across reloads of *other* clients and means
// the history never disagrees with the database.

import { t, locale } from "./i18n.js";

const MAX_HISTORY = 50;

const undoStack = [];
const redoStack = [];

/** Called after any undo or redo so the views can refresh. Set by app.js. */
let onChange = async () => {};

export function setChangeHandler(fn) {
  onChange = fn;
}

/**
 * Record an action that has already been carried out.
 * @param {{label: string, undo: () => Promise<void>, redo: () => Promise<void>,
 *          toastLabel?: string, silent?: boolean}} action
 */
export function record(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  // A new action invalidates the redo branch, as in any editor.
  redoStack.length = 0;

  if (!action.silent) {
    toast(action.toastLabel ?? action.label, {
      actionLabel: t("Undo"),
      onAction: undoLast,
    });
  }
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export async function undoLast() {
  const action = undoStack.pop();
  if (!action) return;
  try {
    await action.undo();
    redoStack.push(action);
    await onChange();
    toast(t("Undone: {label}", { label: action.label }), { actionLabel: t("Redo"), onAction: redoLast });
  } catch (err) {
    // The action is put back so the user can try again rather than silently
    // losing a step of history.
    undoStack.push(action);
    toast(errorText(err), { error: true });
  }
}

export async function redoLast() {
  const action = redoStack.pop();
  if (!action) return;
  try {
    await action.redo();
    undoStack.push(action);
    await onChange();
    toast(t("Redone: {label}", { label: action.label }), { actionLabel: t("Undo"), onAction: undoLast });
  } catch (err) {
    redoStack.push(action);
    toast(errorText(err), { error: true });
  }
}

export function errorText(err) {
  if (!err?.message) return t("Unknown error");
  // A message with placeholders comes with its template, which is the key the
  // dictionary holds; the finished sentence would never be found there.
  // Without one it is a fixed sentence and looked up as it is.
  if (!err.template) return t(String(err.message));
  const vars = {};
  for (const [name, value] of Object.entries(err.params ?? {})) {
    // Numbers in the reader's notation, words through the dictionary too: a
    // kind's label arrives in English. A word without an entry stays as sent.
    vars[name] = typeof value === "number" ? value.toLocaleString(locale) : t(String(value));
  }
  return t(err.template, vars);
}

const DEFAULT_TIMEOUT = 7000;
let container = null;

/**
 * @param {string} text
 * @param {{actionLabel?: string, onAction?: () => unknown, error?: boolean,
 *          timeout?: number}} [opts]
 */
export function toast(text, opts = {}) {
  container ??= document.getElementById("toasts");
  if (!container) return;

  const el = document.createElement("div");
  el.className = opts.error ? "toast is-error" : "toast";

  const label = document.createElement("span");
  label.className = "text";
  label.textContent = text;
  el.append(label);

  let timer;
  let gone = false;
  const dismiss = () => {
    gone = true;
    clearTimeout(timer);
    el.remove();
  };

  if (opts.actionLabel && opts.onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button";
    action.textContent = opts.actionLabel;
    action.addEventListener("click", () => {
      // Dismiss first: the handler shows its own toast, and two stacked toasts
      // about the same action read as a glitch.
      dismiss();
      opts.onAction();
    });
    el.append(action);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button";
  close.setAttribute("aria-label", t("Close"));
  close.textContent = "×";
  close.addEventListener("click", dismiss);
  el.append(close);

  // The clock stops while the pointer rests on the toast or focus is inside
  // it, and starts over once both have left: whoever is reaching for "Undo",
  // or reading the message slowly, should not lose it halfway.
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  let hovered = false;
  let focused = false;
  const hold = () => clearTimeout(timer);
  const resume = () => {
    if (gone || hovered || focused) return;
    clearTimeout(timer);
    timer = setTimeout(dismiss, timeout);
  };
  el.addEventListener("pointerenter", () => { hovered = true; hold(); });
  el.addEventListener("pointerleave", () => { hovered = false; resume(); });
  el.addEventListener("focusin", () => { focused = true; hold(); });
  el.addEventListener("focusout", (event) => {
    if (el.contains(event.relatedTarget)) return;
    focused = false;
    resume();
  });

  container.append(el);
  timer = setTimeout(dismiss, timeout);
  return dismiss;
}
