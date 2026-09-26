// Habit page for creating and editing. It builds the request body and passes
// it to its caller.

import { WEEKDAY_SHORT, WEEKDAY_LONG } from "./dates.js";
import { state, categoryById } from "./state.js";
import { errorText } from "./undo.js";
import { openCategoryPicker } from "./categorypicker.js";
import { icons, buildIconChoices, markIconChoice, categoryIconBadge, colorLabel } from "./icons.js";
import * as H from "./habit.js";
import { t } from "./i18n.js";
import { openPage, closePage, guardPage } from "./pages.js";

let dialog;
let form;
let errorBox;
let submitButton;
let titleEl;
let categoryButton;
let selectedColor = null;
let selectedIcon = "";
let selectedCategory = "";
let onSubmit = null;
/** The input as opened, to detect unsaved changes. */
let initial = "";

export function initEditor() {
  dialog = document.getElementById("editor");
  form = document.getElementById("editor-form");
  errorBox = document.getElementById("editor-error");
  submitButton = document.getElementById("editor-submit");
  titleEl = document.getElementById("editor-title");
  categoryButton = document.getElementById("category-picker");

  buildWeekdayButtons();
  form.addEventListener("change", syncVisibility);
  // Clear the error message on any input.
  for (const type of ["input", "change", "click"]) {
    form.addEventListener(type, (event) => {
      if (type === "click" && !event.target.closest(".weekday")) return;
      errorBox.hidden = true;
    });
  }
  form.addEventListener("submit", handleSubmit);
  guardPage(dialog, () => JSON.stringify(collect()) !== initial);

  categoryButton.addEventListener("click", async () => {
    // null means the picker was cancelled.
    const chosen = await openCategoryPicker(selectedCategory);
    if (chosen !== null) {
      selectedCategory = chosen;
      paintCategory();
    }
  });
}

/** Shows the selected category on its button. */
function paintCategory() {
  const none = selectedCategory === "";
  const label = document.createElement("span");
  label.className = none ? "picker-value is-empty" : "picker-value";
  // A deleted category is shown by name.
  label.textContent = none
    ? t("No category")
    : categoryById(selectedCategory)?.name ?? t("Deleted category");

  const caret = document.createElement("span");
  caret.className = "picker-caret";
  caret.innerHTML = icons.chevron;

  const category = none ? null : categoryById(selectedCategory);
  const badge = category && categoryIconBadge(category, "habit-icon is-small");
  categoryButton.replaceChildren(...(badge ? [badge] : []), label, caret);
}

function buildWeekdayButtons() {
  const host = document.getElementById("weekday-choices");
  host.replaceChildren(
    ...WEEKDAY_SHORT.map((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "weekday";
      b.textContent = label;
      b.dataset.day = String(i);
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", WEEKDAY_LONG[i]);
      b.addEventListener("click", () => {
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
      });
      return b;
    }),
  );
}

function buildSwatches() {
  const host = document.getElementById("color-choices");
  host.replaceChildren(
    ...state.colors.map((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.setProperty("--swatch", color);
      b.dataset.color = color;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t("Colour {color}", { color: colorLabel(color) }));
      b.title = colorLabel(color);
      b.addEventListener("click", () => selectColor(color));
      return b;
    }),
  );
}

function selectColor(color) {
  selectedColor = color;
  for (const el of document.querySelectorAll("#color-choices .swatch")) {
    el.setAttribute("aria-checked", String(el.dataset.color === color));
  }
  // Show the icons in the selected colour.
  document.getElementById("icon-choices").style.setProperty("--habit-color", color);
}

function selectIcon(name) {
  selectedIcon = name;
  markIconChoice(document.getElementById("icon-choices"), name);
}

/** Stored units per unit typed into a target field. */
const unitsPerTyped = (kind) => H.scaleOf(kind);

/**
 * Shows only the fields of the selected kind and frequency. Hidden fields are
 * disabled so they are excluded from form validation.
 */
function syncVisibility() {
  const kind = form.elements.kind.value;
  const freq = form.elements.freq.value;
  const repeat = form.elements.weekRepeat.value;
  for (const el of form.querySelectorAll("[data-when-kind]")) {
    setSectionActive(el, el.dataset.whenKind === kind);
  }
  // Sections that depend on the repeat mode.
  for (const el of form.querySelectorAll("[data-when-freq]")) {
    const repeatMatches = !el.dataset.whenRepeat || el.dataset.whenRepeat === repeat;
    setSectionActive(el, el.dataset.whenFreq === freq && repeatMatches);
  }
}

function setSectionActive(section, active) {
  section.hidden = !active;
  for (const input of section.querySelectorAll("input, textarea, select")) {
    input.disabled = !active;
  }
}

/**
 * Opens the habit dialog.
 * @param {object|null} habit  the habit to edit, or null to create one
 * @param {(input: object) => Promise<void>} handler
 */
export function openEditor(habit, handler) {
  onSubmit = handler;
  errorBox.hidden = true;
  buildSwatches();
  buildIconChoices(document.getElementById("icon-choices"), state.icons, selectIcon);
  selectedCategory = habit?.categoryId ?? "";
  paintCategory();

  const f = form.elements;
  titleEl.textContent = habit ? t("Edit habit") : t("New habit");
  submitButton.textContent = habit ? t("Save") : t("Create");

  f.name.value = habit?.name ?? "";
  f.kind.value = habit?.kind ?? "check";
  // Each kind has its own target field.
  f.targetCount.value = habit?.kind === "count" ? habit.targetValue / unitsPerTyped(habit.kind) : 8;
  f.targetTime.value = habit?.kind === "time" ? habit.targetValue / unitsPerTyped(habit.kind) : 20;
  f.targetDistance.value = habit?.kind === "distance"
    ? habit.targetValue / unitsPerTyped(habit.kind)
    : 5;
  f.unit.value = habit?.kind === "count" ? habit.unit : "";
  // Each kind has its own step field. Empty means the kind's default step.
  f.stepCount.value = habit?.kind === "count" && habit.stepValue
    ? habit.stepValue / unitsPerTyped(habit.kind)
    : "";
  f.stepTime.value = habit?.kind === "time" && habit.stepValue
    ? habit.stepValue / unitsPerTyped(habit.kind)
    : "";
  f.stepDistance.value = habit?.kind === "distance" && habit.stepValue
    ? habit.stepValue / unitsPerTyped(habit.kind)
    : "";

  const freq = habit?.frequency ?? { kind: "daily" };
  f.freq.value = freq.kind;
  f.timesPerWeek.value = freq.timesPerWeek || 3;
  f.intervalDays.value = freq.intervalDays || 3;
  f.anchorDate.value = freq.anchorDate || state.today;

  const narrowed = freq.kind === "weekdays";
  f.weekRepeat.value = narrowed && freq.weekOfMonth
    ? "monthly"
    : narrowed && freq.weekInterval > 1 ? "interval" : "weekly";
  f.weekInterval.value = narrowed && freq.weekInterval > 1 ? freq.weekInterval : 4;
  f.weekOfMonth.value = String(narrowed && freq.weekOfMonth ? freq.weekOfMonth : 1);
  f.weekAnchorDate.value = (narrowed && freq.anchorDate) || state.today;

  const mask = freq.weekdays || 0;
  for (const b of document.querySelectorAll("#weekday-choices .weekday")) {
    b.setAttribute("aria-pressed", String((mask & (1 << Number(b.dataset.day))) !== 0));
  }

  selectColor(habit?.color ?? state.colors[0]);
  selectIcon(habit?.icon ?? "");
  syncVisibility();
  initial = JSON.stringify(collect());
  openPage(dialog);
  f.name.focus();
}

function collect() {
  const f = form.elements;
  const kind = f.kind.value;
  const input = {
    name: f.name.value.trim(),
    color: selectedColor,
    icon: selectedIcon,
    kind,
    categoryId: selectedCategory,
    unit: kind === "count" ? f.unit.value.trim() : "",
    targetValue: 1,
    frequency: {
      kind: f.freq.value, timesPerWeek: 0, weekdays: 0, intervalDays: 0,
      weekInterval: 0, weekOfMonth: 0, anchorDate: "",
    },
  };

  // An empty step field sends 0, i.e. the kind's default step.
  if (kind === "count") {
    input.targetValue = Math.round(Number(f.targetCount.value) * unitsPerTyped(kind));
    input.stepValue = Math.round(Number(f.stepCount.value) * unitsPerTyped(kind));
  }
  if (kind === "time") {
    input.targetValue = Math.round(Number(f.targetTime.value) * unitsPerTyped(kind));
    input.stepValue = Math.round(Number(f.stepTime.value) * unitsPerTyped(kind));
  }
  // Round to whole metres.
  if (kind === "distance") {
    input.targetValue = Math.round(Number(f.targetDistance.value) * unitsPerTyped(kind));
    input.stepValue = Math.round(Number(f.stepDistance.value) * unitsPerTyped(kind));
  }

  switch (input.frequency.kind) {
    case "times_per_week":
      input.frequency.timesPerWeek = Number(f.timesPerWeek.value);
      break;
    case "weekdays": {
      let mask = 0;
      for (const b of document.querySelectorAll("#weekday-choices .weekday")) {
        if (b.getAttribute("aria-pressed") === "true") mask |= 1 << Number(b.dataset.day);
      }
      input.frequency.weekdays = mask;
      const repeat = f.weekRepeat.value;
      input.frequency.weekInterval = repeat === "interval" ? Number(f.weekInterval.value) : 1;
      input.frequency.weekOfMonth = repeat === "monthly" ? Number(f.weekOfMonth.value) : 0;
      if (repeat === "interval") input.frequency.anchorDate = f.weekAnchorDate.value || state.today;
      break;
    }
    case "custom_interval":
      input.frequency.intervalDays = Number(f.intervalDays.value);
      input.frequency.anchorDate = f.anchorDate.value || state.today;
      break;
  }
  return input;
}

async function handleSubmit(event) {
  // Keep the dialog open until the server accepts the input.
  event.preventDefault();
  if (!form.reportValidity()) return;

  const input = collect();
  if (input.frequency.kind === "weekdays" && input.frequency.weekdays === 0) {
    return showError(t("Please select at least one weekday."));
  }

  submitButton.disabled = true;
  try {
    await onSubmit(input);
    closePage(dialog, { force: true });
  } catch (err) {
    showError(errorText(err));
  } finally {
    submitButton.disabled = false;
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  // The error message may be outside the visible area.
  errorBox.scrollIntoView({ block: "nearest" });
}
