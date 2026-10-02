/**
 * @fileoverview Routing: the view the URL names, as reactive state, and the
 * navigation between the views. The hash names the view (#/habit/{id},
 * #/category/{id}, #/days, #/styleguide); without one, the overview is shown.
 */

import {reactive} from '../vue.js';

import {ensureFullHistory} from './loader.js';
import {habitById, state} from './state.js';

/**
 * The shown view: "board", "habit", "category", "days" or "styleguide", and
 * for a habit or category its ID.
 * @type {{view: string, id: ?string}}
 */
export const route = reactive({view: 'board', id: null});

/**
 * Returns the ID of the habit the URL names, or null.
 * @return {?string}
 */
export function currentHabitId() {
  const match = location.hash.match(/^#\/habit\/([\w-]+)$/);
  return match ? match[1] : null;
}

/**
 * Returns the ID of the category the URL names, or null.
 * @return {?string}
 */
function currentCategoryId() {
  const match = location.hash.match(/^#\/category\/([\w-]+)$/);
  return match ? match[1] : null;
}

/**
 * Opens a view as a new history entry, marked as opened by the app, so that
 * its back button can return through the history.
 * @param {string} hash
 */
function openView(hash) {
  history.pushState({view: true}, '', hash);
  syncRoute();
}

/**
 * Opens the habit view.
 * @param {string} id
 */
export function openHabit(id) {
  openView(`#/habit/${id}`);
}

/**
 * Opens the category view.
 * @param {string} id
 */
export function openCategory(id) {
  openView(`#/category/${id}`);
}

/** Opens the day statistics. */
export function openDays() {
  openView('#/days');
}

/**
 * Leaves the current view. A view opened in the app goes back one entry, as
 * the system back button does, so the next back does not return to it; this
 * also returns from a habit to the category it was opened from. Otherwise
 * (a view opened by its URL) it goes to the overview. Uses pushState, as
 * setting location.hash to "" leaves a "#" and does not reliably fire
 * hashchange.
 */
export function goHome() {
  if (history.state?.view) {
    history.back();
    return;
  }
  if (location.hash) {
    history.pushState(null, '', location.pathname + location.search);
  }
  syncRoute();
}

/**
 * Returns to the overview without a history entry, e.g. for a removed habit.
 */
function replaceWithOverview() {
  history.replaceState(null, '', location.pathname + location.search);
}

/**
 * Reports whether the state has been loaded. Before, a habit or category the
 * URL names, e.g. after a reload of its view, may yet exist.
 * @return {boolean}
 */
function stateLoaded() {
  return state.today !== '';
}

/**
 * Shows the view `name`.
 * @param {string} name
 * @param {?string=} id the habit or category shown
 */
function show(name, id = null) {
  route.view = name;
  route.id = id;
}

/**
 * Shows the view the URL names. Called when the URL or the state changes, so
 * a habit or category that no longer exists leads back to the overview.
 */
export function syncRoute() {
  // The style guide needs no data.
  if (location.hash === '#/styleguide') {
    show('styleguide');
    return;
  }

  if (location.hash === '#/days') {
    show('days');
    return;
  }

  const categoryId = currentCategoryId();
  if (categoryId) {
    if (state.categories.some((c) => c.id === categoryId)) {
      show('category', categoryId);
      return;
    }
    // The category no longer exists; before the state is loaded, it may yet.
    if (stateLoaded()) replaceWithOverview();
  }

  const habitId = currentHabitId();
  if (habitId) {
    if (habitById(habitId)) {
      show('habit', habitId);
      // Shown from the loaded entries, then again once the full history
      // arrives.
      ensureFullHistory(habitId);
      return;
    }
    // The habit no longer exists; before the state is loaded, it may yet.
    if (stateLoaded()) replaceWithOverview();
  }

  show('board');
}
