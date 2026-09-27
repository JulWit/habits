// Dialog for entering an exact value, opened by a long press or right-click on
// a day cell.

import { formatRelative } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { errorText, toast } from "./undo.js";
import { t, locale } from "./i18n.js";

let dialog;
let form;
let input;
let titleEl;
let hintEl;
let quickEl;
let onSave = null;
let currentStep = 1;
let maxInBox = 1;

/** Stored units per unit in the input box (see scaleOf in habit.js). */
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
  form.querySelector('[data-action="clear"]').addEventListener("click", () => submit(0));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(Math.max(0, Math.round((Number(input.value) || 0) * scale)));
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
function paintQuick(habit) {
  const jumps = QUICK_JUMPS[habit.kind];
  quickEl.hidden = !jumps;
  if (!jumps) return;

  const offsets = [-jumps[1], -jumps[0], jumps[0], jumps[1]];
  quickEl.replaceChildren(...offsets.map((offset) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button";
    b.textContent = (offset < 0 ? "−" : "+") + Math.abs(offset).toLocaleString(locale);
    b.addEventListener("click", () => setValue((Number(input.value) || 0) + offset));
    return b;
  }));
}

export function openValueDialog(habit, iso, handler) {
  onSave = handler;
  scale = H.scale(habit);
  currentStep = H.step(habit) / scale;
  // Maximum in input units.
  maxInBox = H.maxValue(habit) / scale;

  const value = habit.entries[iso] ?? 0;
  input.value = String(value / scale);
  input.max = String(maxInBox);
  // Allow any value, not only multiples of the step.
  input.step = scale === 1 ? "1" : "any";
  input.inputMode = scale === 1 ? "numeric" : "decimal";
  input.setAttribute("aria-label", H.unitLabel(habit)
    ? t("Value in {unit}", { unit: unitName(habit) })
    : t("Value"));

  paintQuick(habit);

  titleEl.textContent = `${habit.name} — ${formatRelative(iso, state.today)}`;
  hintEl.textContent = hintFor(habit, iso);

  dialog.showModal();
  input.select();
}

/** Returns the hint below the stepper: the target on `iso`, and the step if not 1. */
function hintFor(habit, iso) {
  const goal = t("Daily target: {target}", { target: H.formatValue(habit, H.target(habit, iso)) });
  // A step of 1 is not shown for counts.
  if (habit.kind === "count" && currentStep === 1) return goal;

  // The step is shown in input units.
  const unit = { distance: " km", time: " min" }[habit.kind] ?? "";
  return t("{goal} · step: {step}", { goal, step: `${currentStep.toLocaleString(locale)}${unit}` });
}

/** Returns the unit of the input value, for its accessible name. */
function unitName(habit) {
  return habit.kind === "distance" ? "km" : H.unitLabel(habit);
}

async function submit(value) {
  const handler = onSave;
  dialog.close();
  try {
    await handler(value);
  } catch (err) {
    toast(errorText(err), { error: true });
  }
}
