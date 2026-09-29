// Category picker, a page opened on top of the habit editor.

import {el} from './dom.js';
import {t} from './i18n.js';
import {categoryIconBadge} from './icons.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText} from './undo.js';

/**
 * The value of "no category".
 * @const {string}
 */
const NONE = '';

/** @type {!HTMLDialogElement} */
let dialog;
/** @type {!HTMLElement} */
let list;
/** @type {!HTMLFormElement} */
let createForm;
/** @type {!HTMLInputElement} */
let nameInput;
/** @type {!HTMLElement} */
let errorBox;

/**
 * Resolves the promise returned by openCategoryPicker.
 * @type {?function(?string): void}
 */
let settle = null;
/** The ID of the selected category, NONE for none. */
let current = NONE;

/**
 * Callbacks set by app.js.
 * @type {{createCategory: function(string): !Promise<(!Category|undefined)>}}
 */
let deps;

/**
 * Initialises the category picker.
 * @param {{createCategory: function(string): !Promise<(!Category|undefined)>}}
 *     handlers
 */
export function initCategoryPicker(handlers) {
  deps = handlers;
  dialog = document.getElementById('category-picker');
  list = document.getElementById('category-picker-list');
  createForm = document.getElementById('category-picker-create');
  nameInput = createForm.elements.name;
  errorBox = document.getElementById('category-picker-error');

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-value]');
    if (option) choose(option.dataset.value);
  });

  createForm.addEventListener('submit', onCreate);
  // Leaving the page by its back button, Escape or the system back cancels.
  dialog.addEventListener('close', () => finish(null));
}

/**
 * Opens the category picker.
 * @param {string} selected the current category ID, "" for none
 * @return {!Promise<?string>} the chosen ID, or null if cancelled
 */
export function openCategoryPicker(selected) {
  current = selected ?? NONE;
  errorBox.hidden = true;
  nameInput.value = '';
  paintList();
  openPage(dialog);
  return new Promise((resolve) => {
    settle = resolve;
  });
}

/**
 * Lists the categories to choose from, "no category" first.
 */
function paintList() {
  const options = [{id: NONE, name: t('No category')}, ...state.categories];

  // A deleted category is still offered, so that saving does not change the
  // habit's category.
  if (current !== NONE && !state.categories.some((c) => c.id === current)) {
    options.push({id: current, name: t('Deleted category'), stale: true});
  }

  // The selection is shown by the accent fill, as in the dropdowns.
  list.replaceChildren(...options.map(
      (option) => el(
          'button',
          {
            type: 'button',
            class: ['picker-option', option.stale && 'is-stale'],
            data: {value: option.id},
            role: 'option',
            'aria-selected': String(option.id === current),
          },
          categoryIconBadge(option, 'habit-icon is-small'),
          el('span', {class: 'picker-option-name'}, option.name),
          )));
}

/**
 * Creates a category from the form and chooses it.
 * @param {!Event} event
 * @return {!Promise<void>}
 */
async function onCreate(event) {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  const submit = createForm.querySelector('button');
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

/**
 * Chooses a category and closes the picker.
 * @param {string} value
 */
function choose(value) {
  finish(value);
  closePage(dialog);
}

/**
 * Resolves the open picker's promise, once.
 * @param {?string} value
 */
function finish(value) {
  const resolve = settle;
  settle = null;
  if (resolve) resolve(value);
}
