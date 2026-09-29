// Search dialog for habits and categories, opened from the title bar or with
// "/". Selecting a result opens it.

import {el} from './dom.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {categoryIconBadge, colorValue, habitIconBadge} from './icons.js';
import {closePage, openPage} from './page-stack.js';
import {groupedHabits, subscribe} from './state.js';

/**
 * A search result: a habit with its category, or a category with its habits.
 * @typedef {{
 *   kind: string,
 *   item: (!Habit|!Category),
 *   category: (?Category|undefined),
 *   habits: (!Array<!Habit>|undefined),
 * }}
 */
let SearchEntry;

/** @type {!HTMLDialogElement} */
let dialog;
/** @type {!HTMLInputElement} */
let input;
/** @type {!HTMLElement} */
let list;
/** @type {!HTMLElement} */
let empty;
/** @type {!HTMLButtonElement} */
let clear;

/**
 * The displayed results.
 * @type {!Array<!SearchEntry>}
 */
let results = [];
/** The index of the selected result. */
let active = 0;

/**
 * Callbacks set by app.js.
 * @type {!Object<string, !Function>}
 */
let deps;

/**
 * Initialises the search.
 * @param {!Object<string, !Function>} handlers the handlers of app.js
 */
export function initSearch(handlers) {
  deps = handlers;
  dialog = document.getElementById('search-dialog');
  input = document.getElementById('search-input');
  list = document.getElementById('search-results');
  empty = document.getElementById('search-empty');

  const button = document.getElementById('open-search');
  button.addEventListener('click', openSearch);
  // Without a keyboard the shortcut in the title means nothing; screen readers
  // would still read it out.
  if (matchMedia('(pointer: coarse)').matches) button.title = t('Search');
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  input.addEventListener('keydown', onKey);

  clear = document.getElementById('search-clear');
  clear.addEventListener('click', () => {
    input.value = '';
    active = 0;
    draw();
    input.focus();
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) choose(results[Number(option.dataset.index)]);
  });
  // Pointer and arrow keys move the same selection.
  list.addEventListener('pointermove', (event) => {
    const option = event.target.closest('[data-index]');
    if (option && Number(option.dataset.index) !== active) {
      active = Number(option.dataset.index);
      mark();
    }
  });

  // Close on a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closePage(dialog);
  });

  // Update the results when the state changes.
  subscribe(() => {
    if (dialog.open) draw();
  });
}

/**
 * Opens the search with an empty query.
 */
export function openSearch() {
  if (dialog.open) return;
  input.value = '';
  active = 0;
  // Open first, so that draw() can measure the list.
  openPage(dialog);
  draw();
  input.focus();
}

/**
 * Returns all searchable entries in board order.
 * @return {!Array<!SearchEntry>}
 */
function candidates() {
  const out = [];
  for (const {category, habits} of groupedHabits()) {
    if (category) out.push({kind: 'category', item: category, habits});
    for (const habit of habits) {
      out.push({kind: 'habit', item: habit, category});
    }
  }
  return out;
}

/**
 * Reports whether an entry matches the query, which is in lower case.
 * @param {!SearchEntry} entry
 * @param {string} query
 * @return {boolean}
 */
function matches(entry, query) {
  if (query === '') return true;
  // Habits also match the name of their category.
  const text = entry.kind === 'habit' ?
      `${entry.item.name} ${entry.category?.name ?? ''}` :
      entry.item.name;
  return text.toLowerCase().includes(query);
}

/**
 * Lists the results of the query.
 */
function draw() {
  const query = input.value.trim().toLowerCase();
  clear.hidden = input.value === '';
  results = candidates().filter((entry) => matches(entry, query));
  active = Math.min(active, Math.max(0, results.length - 1));

  list.replaceChildren(...results.map(option));
  list.hidden = results.length === 0;
  empty.hidden = results.length > 0;
  // Measure without the class's padding.
  list.classList.remove('is-scrolling');
  list.classList.toggle('is-scrolling', list.scrollHeight > list.clientHeight);
  mark();
}

/**
 * Builds the option of a result.
 * @param {!SearchEntry} entry
 * @param {number} index
 * @return {!HTMLElement}
 */
function option(entry, index) {
  const isHabit = entry.kind === 'habit';
  const meta = isHabit ? habitMeta(entry) : categoryMeta(entry);

  return el(
      'div',
      {
        class: [
          'search-option',
          isHabit && entry.item.archivedAt ? 'is-archived' : '',
        ],
        id: `search-option-${index}`,
        data: {index},
        role: 'option',
      },
      optionDot(entry),
      el('span', {class: 'search-option-name'}, entry.item.name),
      el('span', {class: 'search-option-meta'}, meta),
  );
}

/**
 * Returns the detail shown after a habit: its category, or without one its
 * target.
 * @param {!SearchEntry} entry
 * @return {string}
 */
function habitMeta(entry) {
  return entry.category?.name ?? habitHelpers.describeHabit(entry.item);
}

/**
 * Returns the detail shown after a category: its number of habits.
 * @param {!SearchEntry} entry
 * @return {string}
 */
function categoryMeta(entry) {
  const n = entry.habits.length;
  return n === 1 ? t('Category · 1 habit') : t('Category · {n} habits', {n});
}

/**
 * Returns the icon of a result, or a dot if it has none.
 * @param {!SearchEntry} entry
 * @return {!HTMLElement}
 */
function optionDot({kind, item}) {
  if (kind === 'habit') {
    return habitIconBadge(item, 'habit-icon is-small') ??
        el('span',
           {class: 'dot', style: {'--habit-color': colorValue(item.color)}});
  }
  return categoryIconBadge(item, 'habit-icon is-small') ??
      el('span', {class: 'dot is-category'});
}

/** Highlights the selected result and scrolls it into view. */
function mark() {
  for (const node of list.children) {
    node.setAttribute(
        'aria-selected', String(Number(node.dataset.index) === active));
  }
  const current = list.children[active];
  if (current) {
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({block: 'nearest'});
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

/**
 * Moves the selection with the arrow keys and chooses it with Enter.
 * @param {!KeyboardEvent} event
 */
function onKey(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (results.length === 0) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    active = (active + step + results.length) % results.length;
    mark();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (results[active]) choose(results[active]);
  }
}

/**
 * Closes the search and opens the chosen habit or category.
 * @param {!SearchEntry|undefined} entry
 * @return {!Promise<void>}
 */
async function choose(entry) {
  if (!entry) return;
  // The view takes the search's place in the history once its entry is gone.
  await closePage(dialog);
  if (entry.kind === 'habit') {
    deps.openHabit(entry.item.id);
  } else {
    deps.openCategory(entry.item.id);
  }
}
