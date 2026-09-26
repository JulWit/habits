// The edit dialog for a category: its name, colour and icon. Like the habit
// editor it only collects the input and hands it to its caller, and stays open
// with the server's message in place when a save is refused.

import { state, categoryById } from "./state.js";
import { errorText } from "./undo.js";
import { t } from "./i18n.js";
import { buildIconChoices, markIconChoice, colorLabel } from "./icons.js";

let dialog;
let form;
let errorBox;
let submitButton;
let colorHost;
let iconHost;
let selectedColor = "";
let selectedIcon = "";
let onSubmit = null;

export function initCategoryEditor() {
  dialog = document.getElementById("category-editor");
  form = document.getElementById("category-editor-form");
  errorBox = document.getElementById("category-editor-error");
  submitButton = document.getElementById("category-editor-submit");
  colorHost = document.getElementById("category-color-choices");
  iconHost = document.getElementById("category-icon-choices");

  form.addEventListener("submit", handleSubmit);
  // A message about the old input is wrong once the input changes, so it goes.
  // Colour and icon are plain buttons and fire neither event, hence click.
  for (const type of ["input", "change", "click"]) {
    form.addEventListener(type, (event) => {
      if (type === "click" && !event.target.closest("#category-color-choices, #category-icon-choices")) return;
      errorBox.hidden = true;
    });
  }
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());
}

/**
 * @param {string} id  the category to edit
 * @param {(input: {name: string, color: string, icon: string, showProgress: boolean}) => Promise<void>} handler
 */
export function openCategoryEditor(id, handler) {
  const category = categoryById(id);
  if (!category) return;
  onSubmit = handler;
  errorBox.hidden = true;

  form.elements.name.value = category.name;
  // Off unless switched on, which is also what a missing field means.
  form.elements.showProgress.checked = category.showProgress === true;
  buildSwatches();
  buildIconChoices(iconHost, state.icons, selectIcon);
  selectColor(category.color ?? "");
  selectIcon(category.icon ?? "");

  dialog.showModal();
  form.elements.name.focus();
  form.elements.name.select();
}

/**
 * The habit palette, after a first swatch for "no colour" - the neutral ink a
 * category is drawn in until it is given one.
 */
function buildSwatches() {
  colorHost.replaceChildren(
    ...["", ...state.colors].map((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = color ? "swatch" : "swatch is-none";
      if (color) b.style.background = color;
      b.dataset.color = color;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label",
        color ? t("Colour {color}", { color: colorLabel(color) }) : t("No colour"));
      b.title = color ? colorLabel(color) : t("No colour");
      b.addEventListener("click", () => selectColor(color));
      return b;
    }),
  );
}

function selectColor(color) {
  selectedColor = color;
  for (const el of colorHost.querySelectorAll(".swatch")) {
    el.setAttribute("aria-checked", String(el.dataset.color === color));
  }
  // The icons are drawn in the colour being picked, as the board will show them.
  iconHost.classList.toggle("is-neutral", !color);
  if (color) iconHost.style.setProperty("--habit-color", color);
  else iconHost.style.removeProperty("--habit-color");
}

function selectIcon(name) {
  selectedIcon = name;
  markIconChoice(iconHost, name);
}

async function handleSubmit(event) {
  // method="dialog" would close on submit; kept open until the server agrees.
  event.preventDefault();
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  try {
    await onSubmit({
      name: form.elements.name.value.trim(),
      color: selectedColor,
      icon: selectedIcon,
      showProgress: form.elements.showProgress.checked,
    });
    dialog.close();
  } catch (err) {
    errorBox.textContent = errorText(err);
    errorBox.hidden = false;
    // The box sits at the end of the scrolling body, which on a phone is below
    // the fold. Without this the save button seems to do nothing.
    errorBox.scrollIntoView({ block: "nearest" });
  } finally {
    submitButton.disabled = false;
  }
}
