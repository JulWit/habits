// Undo, redo and the toast. The server keeps the undo steps: every change
// that can be undone answers with the ID of its step (changeId, see api.js),
// and undo and redo ask the server to turn a step, or the latest one.

import { api } from "./api.js";
import { state } from "./state.js";
import { formatRelative } from "./dates.js";
import { t, locale, errorTemplate } from "./i18n.js";
import { el } from "./dom.js";

/** Called after every undo and redo, to reload the state. Set by app.js. */
let onChange = async () => {};

export function setChangeHandler(fn) {
  onChange = fn;
}

/**
 * Shows `text` in a toast with a button that undoes the step `changeId`. A
 * change without a step (e.g. one waiting offline) shows the text only.
 */
export function offerUndo(changeId, text) {
  if (!changeId) {
    toast(text);
    return;
  }
  toast(text, { actionLabel: t("Undo"), onAction: () => undoStep(changeId) });
}

/** Undoes the latest step, e.g. for Ctrl+Z. */
export function undoLast() {
  return undoStep(0);
}

/** Redoes the step undone last, e.g. for Ctrl+Y. */
export function redoLast() {
  return redoStep(0);
}

/** Undoes the step `id` (0 for the latest) and offers to redo it. */
async function undoStep(id) {
  try {
    const step = await api.undo(id);
    await onChange();
    toast(t("Undone: {label}", { label: stepLabel(step) }), {
      actionLabel: t("Redo"),
      onAction: () => redoStep(step.id),
    });
  } catch (err) {
    await failed(err);
  }
}

/** Redoes the step `id` (0 for the one undone last) and offers to undo it. */
async function redoStep(id) {
  try {
    const step = await api.redo(id);
    await onChange();
    toast(t("Redone: {label}", { label: stepLabel(step) }), {
      actionLabel: t("Undo"),
      onAction: () => undoStep(step.id),
    });
  } catch (err) {
    await failed(err);
  }
}

/**
 * Shows why a step could not be turned. If the data was changed elsewhere
 * meanwhile (409), the server has dropped the step and the state is reloaded.
 */
async function failed(err) {
  toast(errorText(err), { error: true });
  if (err?.status === 409) await onChange();
}

/**
 * Returns the label of a step in the UI language: its English template,
 * translated like any text, with its parameters; a date is shown relative to
 * today.
 */
function stepLabel(step) {
  const vars = {};
  for (const [name, value] of Object.entries(step.params ?? {})) {
    if (name === "date") vars[name] = formatRelative(value, state.today);
    else if (typeof value === "number") vars[name] = value.toLocaleString(locale);
    else vars[name] = value;
  }
  return t(step.label, vars);
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

  const action = opts.actionLabel && opts.onAction
    ? el("button", { type: "button", class: "button" }, opts.actionLabel)
    : null;
  const close = el("button", { type: "button", class: "icon-button", "aria-label": t("Close") }, "×");
  const box = el("div", { class: ["toast", opts.error && "is-error"] },
    el("span", { class: "text" }, text),
    action,
    close,
  );

  let timer;
  let gone = false;
  const dismiss = () => {
    gone = true;
    clearTimeout(timer);
    box.remove();
  };
  action?.addEventListener("click", () => {
    // The action handler shows its own toast.
    dismiss();
    opts.onAction();
  });
  close.addEventListener("click", dismiss);

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
  box.addEventListener("pointerenter", () => { hovered = true; hold(); });
  box.addEventListener("pointerleave", () => { hovered = false; resume(); });
  box.addEventListener("focusin", () => { focused = true; hold(); });
  box.addEventListener("focusout", (event) => {
    if (box.contains(event.relatedTarget)) return;
    focused = false;
    resume();
  });

  container.append(box);
  timer = setTimeout(dismiss, timeout);
  return dismiss;
}
