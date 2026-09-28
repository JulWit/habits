// Category edit page. It passes the input to its caller and stays open with
// the error message if saving fails.

import { state, categoryById } from "./state.js";
import { errorText } from "./undo.js";
import { t } from "./i18n.js";
import { openPage, closePage, guardPage } from "./page-stack.js";
import { buildIconChoices, markIconChoice, colorLabel, colorValue } from "./icons.js";
import { el } from "./dom.js";

let dialog;
let form;
let errorBox;
let submitButton;
let colorHost;
let iconHost;
let selectedColor = "";
let selectedIcon = "";
let onSubmit = null;
/** The input as opened, to detect unsaved changes. */
let initial = "";

export function initCategoryEditor() {
  dialog = document.getElementById("category-editor");
  form = document.getElementById("category-editor-form");
  errorBox = document.getElementById("category-editor-error");
  submitButton = document.getElementById("category-editor-submit");
  colorHost = document.getElementById("category-editor-colors");
  iconHost = document.getElementById("category-editor-icons");

  form.addEventListener("submit", handleSubmit);
  guardPage(dialog, () => JSON.stringify(collect()) !== initial);
  // Clear the error message on any input. The colour and icon buttons change
  // the input without an input event.
  const hideError = () => { errorBox.hidden = true; };
  form.addEventListener("input", hideError);
  form.addEventListener("change", hideError);
  form.addEventListener("click", (event) => {
    if (event.target.closest("#category-editor-colors, #category-editor-icons")) hideError();
  });
}

/**
 * Opens the editor for a category.
 * @param {string} id  the category to edit
 * @param {(input: {name: string, color: string, icon: string, showProgress: boolean}) => Promise<void>} handler
 */
export function openCategoryEditor(id, handler) {
  const category = categoryById(id);
  if (!category) return;
  onSubmit = handler;
  errorBox.hidden = true;

  form.elements.name.value = category.name;
  // A missing value means off.
  form.elements.showProgress.checked = category.showProgress === true;
  buildSwatches();
  buildIconChoices(iconHost, state.icons, selectIcon);
  selectColor(category.color ?? "");
  selectIcon(category.icon ?? "");
  initial = JSON.stringify(collect());

  openPage(dialog);
  form.elements.name.focus();
  form.elements.name.select();
}

/** Builds the colour swatches: "no colour" followed by the habit palette. */
function buildSwatches() {
  colorHost.replaceChildren(
    ...["", ...state.colors].map((color) => {
      const b = el("button", {
        type: "button",
        class: ["swatch", !color && "is-none"],
        style: { "--swatch": color ? colorValue(color) : undefined },
        data: { color },
        role: "radio",
        "aria-label": color ? t("Colour {color}", { color: colorLabel(color) }) : t("No colour"),
        title: color ? colorLabel(color) : t("No colour"),
      });
      b.addEventListener("click", () => selectColor(color));
      return b;
    }),
  );
}

function selectColor(color) {
  selectedColor = color;
  for (const node of colorHost.querySelectorAll(".swatch")) {
    node.setAttribute("aria-checked", String(node.dataset.color === color));
  }
  // Show the icons in the selected colour.
  iconHost.classList.toggle("is-neutral", !color);
  if (color) iconHost.style.setProperty("--habit-color", colorValue(color));
  else iconHost.style.removeProperty("--habit-color");
}

function selectIcon(name) {
  selectedIcon = name;
  markIconChoice(iconHost, name);
}

/** Returns the input of the form. */
function collect() {
  return {
    name: form.elements.name.value.trim(),
    color: selectedColor,
    icon: selectedIcon,
    showProgress: form.elements.showProgress.checked,
  };
}

async function handleSubmit(event) {
  // Keep the dialog open until the server accepts the input.
  event.preventDefault();
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  try {
    await onSubmit(collect());
    closePage(dialog, { force: true });
  } catch (err) {
    errorBox.textContent = errorText(err);
    errorBox.hidden = false;
    // The error message may be outside the visible area.
    errorBox.scrollIntoView({ block: "nearest" });
  } finally {
    submitButton.disabled = false;
  }
}
