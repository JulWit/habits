// Undo/redo history and the toast. Each action carries server calls to undo
// and redo it.

import { t, locale, errorTemplate } from "./i18n.js";

const MAX_HISTORY = 50;

const undoStack = [];
const redoStack = [];

/** Called after every undo and redo. Set by app.js. */
let onChange = async () => {};

export function setChangeHandler(fn) {
  onChange = fn;
}

/**
 * Records an action that has already been carried out.
 * @param {{label: string, undo: () => Promise<void>, redo: () => Promise<void>,
 *          toastLabel?: string, silent?: boolean}} action
 */
export function record(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  // A new action clears the redo stack.
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
    // Keep the action so it can be retried.
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

/**
 * Returns the message of an error in the UI language. Problems from the server
 * are translated by their code; without a translation, the English message is
 * shown.
 */
export function errorText(err) {
  if (!err?.message) return t("Unknown error");
  const template = err.code ? errorTemplate(err.code) : undefined;
  if (!template) return String(err.message);
  const vars = {};
  for (const [name, value] of Object.entries(err.params ?? {})) {
    // Numbers are formatted for the locale, strings are translated.
    vars[name] = typeof value === "number" ? value.toLocaleString(locale) : t(String(value));
  }
  return t(template, vars);
}

const DEFAULT_TIMEOUT = 7000;
let container = null;

/**
 * Shows a toast.
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
      // The action handler shows its own toast.
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

  // The timeout pauses while the toast is hovered or focused.
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
