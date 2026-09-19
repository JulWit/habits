// The category chooser: a second modal dialog opened from inside the habit
// editor. Nesting modals is what <dialog> already supports — the inner one goes
// on top of the outer in the browser's top layer — so the editor keeps its
// state while a category is picked or created.

import { state } from "./state.js";
import { icons } from "./icons.js";
import { errorText } from "./undo.js";

const NONE = "";

let dialog;
let list;
let createForm;
let nameInput;
let errorBox;

/** Resolves the promise handed out by openCategoryPicker. */
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
  // Escape and the backdrop close the dialog without going through choose().
  dialog.addEventListener("close", () => finish(null));
}

/**
 * @param {string} selected  the id currently assigned, "" for none
 * @returns {Promise<string|null>} the chosen id, or null if cancelled
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
  const options = [{ id: NONE, name: "No category" }, ...state.categories];

  // A habit can point at a category that was soft-deleted and is therefore not
  // in the live list. Dropping it here would silently reassign the habit on the
  // next save, so it is offered as an entry of its own.
  if (current !== NONE && !state.categories.some((c) => c.id === current)) {
    options.push({ id: current, name: "Deleted category", stale: true });
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
    // A fresh category is what the user wanted to file the habit under, so it
    // is selected straight away rather than only added to the list.
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
