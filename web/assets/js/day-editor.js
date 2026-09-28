// Day dialog, opened by a long press or right-click on a day cell: the value
// (or for a check habit whether it is done) and whether the day is skipped.
// It passes only what changed to its caller.

import { formatRelative } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit-helpers.js";
import { errorText, toast } from "./undo.js";
import { t, locale } from "./i18n.js";
import { openPage, closePage } from "./page-stack.js";
import { el } from "./dom.js";

let dialog;
let form;
let input;
let titleEl;
let hintEl;
let quickEl;
let onSave = null;
let currentStep = 1;
let maxInBox = 1;
/** The habit and its entry as the dialog opened. */
let habit = null;
let before = null;

/** Stored units per unit in the input box (see scale in habit-helpers.js). */
let scale = 1;

/**
 * Quick buttons per kind, in input units. They are fixed values, independent
 * of the habit's step. KindCheck has none.
 */
const QUICK_JUMPS = {
  count: [5, 10],
  time: [5, 15],
  distance: [0.5, 1],
};

export function initValueDialog() {
  dialog = document.getElementById("value-popover");
  form = document.getElementById("value-form");
  input = form.elements.value;
  titleEl = document.getElementById("value-title");
  hintEl = document.getElementById("value-hint");
  quickEl = document.getElementById("value-quick");

  for (const b of form.querySelectorAll("[data-step]")) {
    b.addEventListener("click", () => {
      const next = (Number(input.value) || 0) + Number(b.dataset.step) * currentStep;
      // Round to a multiple of the step.
      setValue(Math.round(next / currentStep) * currentStep);
    });
  }
  form.elements.skipped.addEventListener("change", syncSkip);
  form.querySelector('[data-action="clear"]').addEventListener("click", () => {
    submit({ value: 0, skipped: false });
  });
  // A tap on the backdrop cancels, as in the search: without a keyboard there
  // is no Escape.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePage(dialog);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(collect());
  });
}

/** Sets the input value, clamped to the kind's range. */
function setValue(next) {
  const inRange = Math.min(maxInBox, Math.max(0, next));
  // Round to stored-unit precision to avoid floating-point artefacts.
  input.value = String(Math.round(inRange * scale) / scale);
  input.focus();
}

/** Builds the quick buttons. They add their exact value, without rounding. */
function paintQuick() {
  const jumps = QUICK_JUMPS[habit.kind];
  quickEl.hidden = !jumps;
  if (!jumps) return;

  const offsets = [-jumps[1], -jumps[0], jumps[0], jumps[1]];
  quickEl.replaceChildren(...offsets.map((offset) => {
    const b = el("button", { type: "button", class: "button" },
      (offset < 0 ? "−" : "+") + Math.abs(offset).toLocaleString(locale));
    b.addEventListener("click", () => setValue((Number(input.value) || 0) + offset));
    return b;
  }));
}

/** A skipped day has no value, so the value controls are off while skipping. */
function syncSkip() {
  document.getElementById("value-controls").disabled = form.elements.skipped.checked;
}

/**
 * Opens the day dialog. `handler` receives the change ({value?, skipped?})
 * with the parts that differ from the entry as it was.
 */
export function openDayDialog(target, iso, handler) {
  onSave = handler;
  habit = target;
  before = H.entryOn(habit, iso);
  const check = habit.kind === "check";
  scale = H.scale(habit.kind);
  currentStep = H.step(habit) / scale;
  // Maximum in input units.
  maxInBox = H.maxValue(habit) / scale;

  document.getElementById("value-measured").hidden = check;
  document.getElementById("value-done").hidden = check === false;
  input.disabled = check;
  form.elements.done.checked = before.value > 0;

  input.value = String(before.value / scale);
  input.max = String(maxInBox);
  // Allow any value, not only multiples of the step.
  input.step = scale === 1 ? "1" : "any";
  input.inputMode = scale === 1 ? "numeric" : "decimal";
  input.setAttribute("aria-label", H.unitLabel(habit)
    ? t("Value in {unit}", { unit: unitName() })
    : t("Value"));
  paintQuick();

  form.elements.skipped.checked = before.skipped;
  syncSkip();

  titleEl.textContent = `${habit.name} — ${formatRelative(iso, state.today)}`;
  hintEl.textContent = hintFor(iso);

  openPage(dialog);
  // The first control that can be used.
  if (before.skipped) form.elements.skipped.focus();
  else if (check) form.elements.done.focus();
  else input.select();
}

/** Returns the entry as entered. */
function collect() {
  const skipped = form.elements.skipped.checked;
  let value = habit.kind === "check"
    ? (form.elements.done.checked ? 1 : 0)
    : Math.max(0, Math.round((Number(input.value) || 0) * scale));
  if (skipped) value = 0;
  return { value, skipped };
}

/**
 * Returns the hint below the stepper: the target on `iso` (or the limit), and
 * the step if not 1.
 */
function hintFor(iso) {
  const amount = H.formatValue(habit, H.target(habit, iso));
  const goal = H.isLimit(habit, iso)
    ? t("Daily limit: {target}", { target: amount })
    : t("Daily target: {target}", { target: amount });
  // A step of 1 is not shown for counts.
  if (habit.kind === "count" && currentStep === 1) return goal;

  // The step is shown in input units.
  const unit = { distance: " km", time: " min" }[habit.kind] ?? "";
  return t("{goal} · step: {step}", { goal, step: `${currentStep.toLocaleString(locale)}${unit}` });
}

/** Returns the unit of the input value, for its accessible name. */
function unitName() {
  return habit.kind === "distance" ? "km" : H.unitLabel(habit);
}

/**
 * Passes the parts of `entry` that differ from the entry as it was to the
 * handler. A value is only sent for a day that is not skipped, as a skip
 * clears it anyway.
 */
async function submit(entry) {
  const change = {};
  if (entry.skipped !== before.skipped) change.skipped = entry.skipped;
  if (!entry.skipped && entry.value !== before.value) change.value = entry.value;

  const handler = onSave;
  closePage(dialog, { force: true });
  if (Object.keys(change).length === 0) return;
  try {
    await handler(change);
  } catch (err) {
    toast(errorText(err), { error: true });
  }
}
