// Undo/redo and the toast that exposes it.
//
// Because nothing is persisted locally, every step is expressed as a pair of
// server calls: `undo` puts the previous state back, `redo` re-applies the
// change. That keeps undo correct across reloads of *other* clients and means
// the history never disagrees with the database.

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
      actionLabel: "Rückgängig",
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
    toast(`Rückgängig: ${action.label}`, { actionLabel: "Wiederholen", onAction: redoLast });
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
    toast(`Wiederholt: ${action.label}`, { actionLabel: "Rückgängig", onAction: undoLast });
  } catch (err) {
    redoStack.push(action);
    toast(errorText(err), { error: true });
  }
}

export function errorText(err) {
  return err?.message ? String(err.message) : "Unbekannter Fehler";
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
  const dismiss = () => {
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
  close.setAttribute("aria-label", "Schließen");
  close.textContent = "×";
  close.addEventListener("click", dismiss);
  el.append(close);

  container.append(el);
  timer = setTimeout(dismiss, opts.timeout ?? DEFAULT_TIMEOUT);
  return dismiss;
}
