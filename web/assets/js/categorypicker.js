// Category picker, opened as a nested dialog from the habit editor.

import { state } from "./state.js";
import { icons, categoryIconBadge } from "./icons.js";
import { errorText } from "./undo.js";
import { t } from "./i18n.js";

const NONE = "";

let dialog;
let list;
let createForm;
let nameInput;
let errorBox;

/** Resolves the promise returned by openCategoryPicker. */
let settle = null;
let current = NONE;

let deps = { createCategory: async () => null };

export function initCategoryPicker(handlers) {
  deps = { ...deps, ...handlers };
  dialog = document.getElementById("category-dialog");
  list = document.getElementById("category-list");
  createForm = document.getElementById("category-create");
  nameInput = createForm.elements.name;
  errorBox = document.getElementById("category-error");

  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-value]");
    if (option) choose(option.dataset.value);
  });

  createForm.addEventListener("submit", onCreate);
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => choose(null));
  // Escape and backdrop clicks cancel.
  dialog.addEventListener("close", () => finish(null));
}

/**
 * Opens the category picker.
 * @param {string} selected  the current category ID, "" for none
 * @returns {Promise<string|null>} the chosen ID, or null if cancelled
 */
export function openCategoryPicker(selected) {
  current = selected ?? NONE;
  errorBox.hidden = true;
  nameInput.value = "";
  paintList();
  dialog.showModal();
  return new Promise((resolve) => {
    settle = resolve;
  });
}

function paintList() {
  const options = [{ id: NONE, name: t("No category") }, ...state.categories];

  // A deleted category is still offered, so that saving does not change the
  // habit's category.
  if (current !== NONE && !state.categories.some((c) => c.id === current)) {
    options.push({ id: current, name: t("Deleted category"), stale: true });
  }

  list.replaceChildren(...options.map((option) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = option.stale ? "picker-option is-stale" : "picker-option";
    row.dataset.value = option.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(option.id === current));

    const label = document.createElement("span");
    label.className = "picker-option-name";
    label.textContent = option.name;

    const mark = document.createElement("span");
    mark.className = "picker-option-mark";
    if (option.id === current) mark.innerHTML = icons.check;

    const badge = categoryIconBadge(option, "habit-icon is-small");
    if (badge) row.append(badge);
    row.append(label, mark);
    return row;
  }));
}

async function onCreate(event) {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  const submit = createForm.querySelector("button");
  submit.disabled = true;
  try {
    const created = await deps.createCategory(name);
    // Select the newly created category.
    if (created) choose(created.id);
  } catch (err) {
    errorBox.textContent = errorText(err);
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function choose(value) {
  finish(value);
  if (dialog.open) dialog.close();
}

function finish(value) {
  const resolve = settle;
  settle = null;
  if (resolve) resolve(value);
}
