// Day dialog, opened by a long press or right-click on a day cell: the value
// (or for a check habit whether it is done) and whether the day is skipped.
// It passes only what changed to its caller.

import {formatRelative} from './dates.js';
import {el} from './dom.js';
import * as habitHelpers from './habit-helpers.js';
import {locale, t} from './i18n.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText, toast} from './undo.js';

/**
 * A change of a day's entry: the parts that differ.
 * @typedef {{value: (number|undefined), skipped: (boolean|undefined)}}
 */
let EntryChange;

/** @type {!HTMLDialogElement} */
let dialog;
/** @type {!HTMLFormElement} */
let form;
/** @type {!HTMLInputElement} */
let input;
/** @type {!HTMLElement} */
let titleEl;
/** @type {!HTMLElement} */
let hintEl;
/** @type {!HTMLElement} */
let quickEl;
/**
 * Saves the change; set when the dialog opens.
 * @type {?function(!EntryChange): !Promise<void>}
 */
let onSave = null;
/** The step of the habit in input units. */
let currentStep = 1;
/** The kind's maximum in input units. */
let maxInBox = 1;
/**
 * The habit as the dialog opened.
 * @type {?Habit}
 */
let habit = null;
/**
 * The entry as the dialog opened.
 * @type {?Entry}
 */
let before = null;

/** Stored units per unit in the input box (see scale in habit-helpers.js). */
let scale = 1;

/**
 * Quick buttons per kind, in input units. They are fixed values, independent
 * of the habit's step. KindCheck has none.
 * @const {!Object<string, !Array<number>>}
 */
const QUICK_JUMPS = {
  count: [5, 10],
  time: [5, 15],
  distance: [0.5, 1],
};

/**
 * Initialises the day dialog.
 */
export function initValueDialog() {
  dialog = document.getElementById('day-editor');
  form = document.getElementById('day-editor-form');
  input = form.elements.value;
  titleEl = document.getElementById('day-editor-title');
  hintEl = document.getElementById('day-editor-hint');
  quickEl = document.getElementById('day-editor-quick');

  for (const b of form.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const next =
          (Number(input.value) || 0) + Number(b.dataset.step) * currentStep;
      // Round to a multiple of the step.
      setValue(Math.round(next / currentStep) * currentStep);
    });
  }
  form.elements.skipped.addEventListener('change', syncSkip);
  form.querySelector('[data-action="clear"]').addEventListener('click', () => {
    submit({value: 0, skipped: false});
  });
  // A tap on the backdrop cancels, as in the search: without a keyboard there
  // is no Escape.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closePage(dialog);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(collect());
  });
}

/**
 * Sets the input value, clamped to the kind's range.
 * @param {number} next in input units
 */
function setValue(next) {
  const inRange = Math.min(maxInBox, Math.max(0, next));
  // Round to stored-unit precision to avoid floating-point artefacts.
  input.value = String(Math.round(inRange * scale) / scale);
  input.focus();
}

/**
 * Builds the quick buttons. They add their exact value, without rounding.
 */
function paintQuick() {
  const jumps = QUICK_JUMPS[habit.kind];
  quickEl.hidden = !jumps;
  if (!jumps) return;

  const offsets = [-jumps[1], -jumps[0], jumps[0], jumps[1]];
  quickEl.replaceChildren(...offsets.map((offset) => {
    const b =
        el('button', {type: 'button', class: 'button'},
           (offset < 0 ? '−' : '+') + Math.abs(offset).toLocaleString(locale));
    b.addEventListener(
        'click', () => setValue((Number(input.value) || 0) + offset));
    return b;
  }));
}

/**
 * A skipped day has no value, so the value controls are off while skipping.
 */
function syncSkip() {
  document.getElementById('day-editor-controls').disabled =
      form.elements.skipped.checked;
}

/**
 * Opens the day dialog. `handler` receives the change ({value?, skipped?})
 * with the parts that differ from the entry as it was.
 * @param {!Habit} target
 * @param {string} iso
 * @param {function(!EntryChange): !Promise<void>} handler
 */
export function openDayDialog(target, iso, handler) {
  onSave = handler;
  habit = target;
  before = habitHelpers.entryOn(habit, iso);
  const check = habit.kind === 'check';
  scale = habitHelpers.scale(habit.kind);
  currentStep = habitHelpers.step(habit) / scale;
  // Maximum in input units.
  maxInBox = habitHelpers.maxValue(habit) / scale;

  document.getElementById('day-editor-measured').hidden = check;
  document.getElementById('day-editor-done').hidden = check === false;
  input.disabled = check;
  form.elements.done.checked = before.value > 0;

  input.value = String(before.value / scale);
  input.max = String(maxInBox);
  // Allow any value, not only multiples of the step.
  input.step = scale === 1 ? '1' : 'any';
  input.inputMode = scale === 1 ? 'numeric' : 'decimal';
  input.setAttribute(
      'aria-label',
      habitHelpers.unitLabel(habit) ? t('Value in {unit}', {unit: unitName()}) :
                                      t('Value'));
  paintQuick();

  form.elements.skipped.checked = before.skipped;
  syncSkip();

  titleEl.textContent = `${habit.name} — ${formatRelative(iso, state.today)}`;
  hintEl.textContent = hintFor(iso);

  openPage(dialog);
  // The first control that can be used.
  if (before.skipped) {
    form.elements.skipped.focus();
  } else if (check) {
    form.elements.done.focus();
  } else {
    input.select();
  }
}

/**
 * Returns the entry as entered.
 * @return {!Entry}
 */
function collect() {
  const skipped = form.elements.skipped.checked;
  let value = habit.kind === 'check' ?
      (form.elements.done.checked ? 1 : 0) :
      Math.max(0, Math.round((Number(input.value) || 0) * scale));
  if (skipped) value = 0;
  return {value, skipped};
}

/**
 * Returns the hint below the stepper: the target on `iso` (or the limit), and
 * the step if not 1.
 * @param {string} iso
 * @return {string}
 */
function hintFor(iso) {
  const amount =
      habitHelpers.formatValue(habit, habitHelpers.target(habit, iso));
  const goal = habitHelpers.isLimit(habit, iso) ?
      t('Daily limit: {target}', {target: amount}) :
      t('Daily target: {target}', {target: amount});
  // A step of 1 is not shown for counts.
  if (habit.kind === 'count' && currentStep === 1) return goal;

  // The step is shown in input units.
  const unit = {distance: ' km', time: ' min'}[habit.kind] ?? '';
  return t(
      '{goal} · step: {step}',
      {goal, step: `${currentStep.toLocaleString(locale)}${unit}`});
}

/**
 * Returns the unit of the input value, for its accessible name.
 * @return {string}
 */
function unitName() {
  return habit.kind === 'distance' ? 'km' : habitHelpers.unitLabel(habit);
}

/**
 * Passes the parts of `entry` that differ from the entry as it was to the
 * handler. A value is only sent for a day that is not skipped, as a skip
 * clears it anyway.
 * @param {!Entry} entry
 * @return {!Promise<void>}
 */
async function submit(entry) {
  const change = {};
  if (entry.skipped !== before.skipped) change.skipped = entry.skipped;
  if (!entry.skipped && entry.value !== before.value) {
    change.value = entry.value;
  }

  const handler = onSave;
  closePage(dialog, {force: true});
  if (Object.keys(change).length === 0) return;
  try {
    await handler(change);
  } catch (err) {
    toast(errorText(err), {error: true});
  }
}
