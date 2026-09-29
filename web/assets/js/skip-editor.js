// Page for skipping a range of days, e.g. a holiday: of one habit or of all
// that are not archived. It passes the input to its caller and stays open with
// the error message if skipping fails.

import {addDays} from './dates.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText} from './undo.js';

let dialog;
let form;
let errorBox;
let submitButton;
let onSubmit = null;
/** The habit the page was opened for, or null for all habits. */
let habit = null;

export function initSkipDialog() {
  dialog = document.getElementById('skip-editor');
  form = document.getElementById('skip-editor-form');
  errorBox = document.getElementById('skip-editor-error');
  submitButton = document.getElementById('skip-editor-submit');

  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', () => {
    errorBox.hidden = true;
  });
  // The last day cannot lie before the first.
  form.elements.from.addEventListener('change', () => {
    form.elements.to.min = form.elements.from.value;
    if (form.elements.to.value < form.elements.from.value) {
      form.elements.to.value = form.elements.from.value;
    }
  });
}

/**
 * Opens the page for `target`, with the choice of all habits, or for all
 * habits if `target` is null. `handler` receives {from, to, habitIds}; no
 * habitIds means all habits.
 */
export function openSkipDialog(target, handler) {
  habit = target;
  onSubmit = handler;
  errorBox.hidden = true;

  const f = form.elements;
  // A week from today, the usual holiday.
  f.from.value = state.today;
  f.to.value = addDays(state.today, 6);
  f.to.min = f.from.value;
  f.scope.value = 'one';
  document.getElementById('skip-editor-scope').hidden = habit === null;
  if (habit) {
    document.getElementById('skip-editor-scope-one').textContent = habit.name;
  }

  openPage(dialog);
  f.from.focus();
}

function collect() {
  const f = form.elements;
  const one = habit !== null && f.scope.value === 'one';
  return {
    from: f.from.value,
    to: f.to.value,
    habitIds: one ? [habit.id] : [],
  };
}

async function handleSubmit(event) {
  // Keep the page open until the server accepts the input.
  event.preventDefault();
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  try {
    await onSubmit(collect());
    closePage(dialog, {force: true});
  } catch (err) {
    errorBox.textContent = errorText(err);
    errorBox.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
}
