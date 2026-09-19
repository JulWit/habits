// The exact-value dialog for counter and duration habits, opened by a long
// press or a right-click on a day cell.

import { formatRelative } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { errorText, toast } from "./undo.js";

let dialog;
let form;
let input;
let titleEl;
let hintEl;
let quickEl;
let onSave = null;
let currentStep = 1;
let maxInBox = 1;

/**
 * What one unit in the input box is worth in stored units.
 *
 * Every kind that allows a decimal place is stored finer than it is written —
 * metres under kilometres, tenths under counts and minutes — so everything
 * that leaves or enters the box passes through this factor. For a tick it is 1
 * and the code below reads as if it were not there.
 */
let scale = 1;

/**
 * The two jumps the quick buttons offer, in the unit the box is typed in.
 *
 * They are fixed rather than derived from the habit's step: the point of the
 * row is to reach 30 push-ups or half an hour in one press, which a multiple
 * of a step of seven would not do. A tick has nothing to jump to and is
 * missing here on purpose.
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
      // Snapped to the step, so a chain of +0,5 km cannot drift into 2,4999999
      // and a habit counted in fives stays on multiples of five.
      setValue(Math.round(next / currentStep) * currentStep);
    });
  }
  form.querySelector('[data-action="clear"]').addEventListener("click", () => submit(0));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(Math.max(0, Math.round((Number(input.value) || 0) * scale)));
  });
}

/** Writes a value into the box, kept inside the range the kind allows. */
function setValue(next) {
  const inRange = Math.min(maxInBox, Math.max(0, next));
  // Rounded to what the store can hold — 1 metre at the finest — so that a
  // chain of +0,5 km cannot leave 5,7000000000000002 standing in the box.
  input.value = String(Math.round(inRange * scale) / scale);
  input.focus();
}

/**
 * Builds the row of quick buttons for this habit.
 *
 * They add exactly what they say, rather than snapping to the step: the row is
 * a shortcut to a round number, and +5 that quietly becomes +6 would be a poor
 * one.
 */
function paintQuick(habit) {
  const jumps = QUICK_JUMPS[habit.kind];
  quickEl.hidden = !jumps;
  if (!jumps) return;

  const offsets = [-jumps[1], -jumps[0], jumps[0], jumps[1]];
  quickEl.replaceChildren(...offsets.map((offset) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button";
    b.textContent = (offset < 0 ? "−" : "+") + Math.abs(offset).toLocaleString("de-DE");
    b.addEventListener("click", () => setValue((Number(input.value) || 0) + offset));
    return b;
  }));
}

export function openValueDialog(habit, iso, handler) {
  onSave = handler;
  scale = H.scale(habit);
  currentStep = H.step(habit) / scale;
  // The cap follows the kind: a day of minutes, a thousand of whatever is
  // being counted, 200 kilometres - each divided down into what the box shows.
  maxInBox = H.maxValue(habit) / scale;

  const value = habit.entries[iso] ?? 0;
  input.value = String(value / scale);
  input.max = String(maxInBox);
  // Anything the kind can hold: tying the attribute to the habit's step would
  // make the browser reject a 7 that was typed into a habit counted in fives.
  input.step = scale === 1 ? "1" : "any";
  input.inputMode = scale === 1 ? "numeric" : "decimal";
  input.setAttribute("aria-label", `Wert${H.unitLabel(habit) ? ` in ${unitName(habit)}` : ""}`);

  paintQuick(habit);

  titleEl.textContent = `${habit.name} — ${formatRelative(iso, state.today)}`;
  hintEl.textContent = hintFor(habit);

  dialog.showModal();
  input.select();
}

/** The line under the stepper: the target, plus the step when it says anything. */
function hintFor(habit) {
  const goal = `Tagesziel: ${H.formatValue(habit, H.target(habit))}`;
  // A count of one is what everyone assumes anyway; every other step is worth
  // spelling out.
  if (habit.kind === "count" && currentStep === 1) return goal;

  // In the unit the box is typed in, not the one the value is stored in: half
  // a kilometre reads as 0,5 km here, so the hint matches what the buttons do
  // to the number above it.
  const unit = { distance: " km", time: " min" }[habit.kind] ?? "";
  return `${goal} · Schritt: ${currentStep.toLocaleString("de-DE")}${unit}`;
}

/** What the number in the box is measured in, for the field's accessible name. */
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
