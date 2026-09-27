// Habit page for creating and editing. It builds the request body and passes
// it to its caller.

import { WEEKDAY_SHORT, WEEKDAY_LONG } from "./dates.js";
import { state, categoryById } from "./state.js";
import { errorText } from "./undo.js";
import { openCategoryPicker } from "./categorypicker.js";
import {
  icons, buildIconChoices, markIconChoice, categoryIconBadge, colorLabel, colorValue,
} from "./icons.js";
import * as H from "./habit.js";
import { t } from "./i18n.js";
import { openPage, closePage, guardPage } from "./pages.js";

let dialog;
let form;
let errorBox;
let submitButton;
let titleEl;
let categoryButton;
let retroactiveBox;
let selectedColor = null;
let selectedIcon = "";
let selectedCategory = "";
let onSubmit = null;
/** The input as opened, to detect unsaved changes. */
let initial = "";
/** The habit being edited, or null when creating one. */
let editing = null;
/** Target and frequency as opened, to offer applying a change retroactively. */
let initialSchedule = "";

export function initEditor() {
  dialog = document.getElementById("editor");
  form = document.getElementById("editor-form");
  errorBox = document.getElementById("editor-error");
  submitButton = document.getElementById("editor-submit");
  titleEl = document.getElementById("editor-title");
  categoryButton = document.getElementById("category-picker");
  retroactiveBox = document.getElementById("editor-retroactive");

  buildWeekdayButtons();
  form.addEventListener("change", syncVisibility);
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);
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

/**
 * Handles any change of the input: hides the error message and offers to
 * apply a changed schedule retroactively.
 */
function onEdit() {
  errorBox.hidden = true;
  syncRetroactive();
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
        // The buttons change the input without an input event.
        onEdit();
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
      b.style.setProperty("--swatch", colorValue(color));
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
  document.getElementById("icon-choices").style.setProperty("--habit-color", colorValue(color));
}

function selectIcon(name) {
  selectedIcon = name;
  markIconChoice(document.getElementById("icon-choices"), name);
}

/**
 * Each measured kind has its own target and step field, so switching the kind
 * keeps what was typed for the others. Targets are prefilled with a default;
 * an empty step field means the kind's default step.
 */
const KIND_FIELDS = {
  count: { target: "targetCount", step: "stepCount", defaultTarget: 8 },
  time: { target: "targetTime", step: "stepTime", defaultTarget: 20 },
  distance: { target: "targetDistance", step: "stepDistance", defaultTarget: 5 },
};

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
  editing = habit;
  errorBox.hidden = true;
  buildSwatches();
  buildIconChoices(document.getElementById("icon-choices"), state.icons, selectIcon);
  selectedCategory = habit?.categoryId ?? "";
  paintCategory();

  const schedule = habit ? H.currentSchedule(habit) : null;
  const f = form.elements;
  titleEl.textContent = habit ? t("Edit habit") : t("New habit");
  submitButton.textContent = habit ? t("Save") : t("Create");

  f.name.value = habit?.name ?? "";
  f.kind.value = habit?.kind ?? "check";
  for (const [kind, fields] of Object.entries(KIND_FIELDS)) {
    f[fields.target].value = fields.defaultTarget;
    f[fields.step].value = "";
    if (habit?.kind === kind) {
      f[fields.target].value = schedule.targetValue / H.scale(kind);
      if (habit.stepValue) f[fields.step].value = habit.stepValue / H.scale(kind);
    }
  }
  f.unit.value = habit?.kind === "count" ? habit.unit : "";

  const freq = schedule?.frequency ?? { kind: "daily" };
  f.freq.value = freq.kind;
  f.timesPerWeek.value = freq.timesPerWeek || 3;
  f.intervalDays.value = freq.intervalDays || 3;
  f.anchorDate.value = freq.anchorDate || state.today;

  // Weekday schedules repeat every week, every n-th week, or in one week of
  // the month.
  f.weekRepeat.value = "weekly";
  f.weekInterval.value = 4;
  f.weekOfMonth.value = "1";
  f.weekAnchorDate.value = state.today;
  if (freq.kind === "weekdays" && freq.weekOfMonth) {
    f.weekRepeat.value = "monthly";
    f.weekOfMonth.value = String(freq.weekOfMonth);
  } else if (freq.kind === "weekdays" && freq.weekInterval > 1) {
    f.weekRepeat.value = "interval";
    f.weekInterval.value = freq.weekInterval;
    f.weekAnchorDate.value = freq.anchorDate || state.today;
  }

  const mask = freq.weekdays || 0;
  for (const b of document.querySelectorAll("#weekday-choices .weekday")) {
    b.setAttribute("aria-pressed", String((mask & (1 << Number(b.dataset.day))) !== 0));
  }

  selectColor(habit?.color ?? state.colors[0]);
  selectIcon(habit?.icon ?? "");
  syncVisibility();
  f.retroactive.checked = false;
  initialSchedule = scheduleKey(collect());
  syncRetroactive();
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

  // Only sent when the switch is offered, i.e. when editing a schedule.
  if (!retroactiveBox.hidden) {
    input.retroactive = f.retroactive.checked;
  }

  // Typed values are converted to stored units. An empty step field sends 0,
  // i.e. the kind's default step.
  const fields = KIND_FIELDS[kind];
  if (fields) {
    input.targetValue = Math.round(Number(f[fields.target].value) * H.scale(kind));
    input.stepValue = Math.round(Number(f[fields.step].value) * H.scale(kind));
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

/** Returns the part of the input that makes up the schedule. */
function scheduleKey(input) {
  return JSON.stringify([input.kind, input.targetValue, input.frequency]);
}

/**
 * Offers to apply a changed target or frequency to past days as well. Only
 * when editing, and not when the kind changes, which converts the history
 * anyway.
 */
function syncRetroactive() {
  const input = collect();
  syncKindHint(input.kind);
  const changed = editing !== null && input.kind === editing.kind &&
    scheduleKey(input) !== initialSchedule;
  retroactiveBox.hidden = !changed;
  if (!changed) form.elements.retroactive.checked = false;
}

/**
 * Explains what happens to the recorded days when the kind of a habit with
 * entries changes (domain.ConvertKind).
 */
function syncKindHint(kind) {
  const hint = document.getElementById("editor-kind-hint");
  const recorded = editing !== null &&
    (Object.keys(editing.entries ?? {}).length > 0 || (editing.stats?.total ?? 0) > 0);
  if (!recorded || kind === editing.kind) {
    hint.hidden = true;
    return;
  }
  if (kind === "check") {
    hint.textContent = t("Days that reached their target stay ticked; the others are cleared. The recorded values are not kept.");
  } else if (editing.kind === "check") {
    hint.textContent = t("Ticked days get the new daily target.");
  } else {
    hint.textContent = t("Recorded values keep their number in the new unit, e.g. 5 becomes 5 {unit}.",
      { unit: t(kind === "time" ? "minutes" : kind === "distance" ? "km" : "times") });
  }
  hint.hidden = false;
}
