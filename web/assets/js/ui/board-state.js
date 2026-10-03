/**
 * @fileoverview How the overview is shown, shared by the overview, the title
 * bar and the settings: whether its habits are being arranged, whether only
 * the open ones are shown, and how many day columns fit. Neither is saved on
 * the server.
 *
 * Arranging needs every habit on the board, which the filter would hide along
 * with the handles: switching arranging on turns the filter off, and turning
 * the filter on ends arranging.
 */

import {ref} from '../vue.js';

/** Whether the habits are being arranged: the handles are shown. */
export const arranging = ref(false);

/**
 * Starts or ends arranging. Starting turns the filter off.
 * @param {boolean} on
 */
export function setArranging(on) {
  arranging.value = on;
  if (on && onlyOpen.value) setFilter(false);
}

/** localStorage key of the filter toggle; kept per device. */
const FILTER_KEY = 'habits.filterOpen';

/**
 * Whether only habits due and still open on the active day are shown.
 * Persisted in localStorage, so it survives a reload.
 */
export const onlyOpen = ref(loadFilter());

/**
 * Reads the stored filter. localStorage can be unavailable; the filter then
 * starts off and is not kept.
 * @return {boolean}
 */
function loadFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Sets the filter and stores it, if localStorage is available. Turning it on
 * ends arranging.
 * @param {boolean} on
 */
function setFilter(on) {
  onlyOpen.value = on;
  if (on) arranging.value = false;
  try {
    localStorage.setItem(FILTER_KEY, on ? '1' : '0');
  } catch {
    // Not kept.
  }
}

/** Switches the filter. */
export function toggleFilter() {
  setFilter(!onlyOpen.value);
}

/**
 * The number of day columns the overview shows; 0 before it could be
 * measured. Set by the overview, read by the settings' hints.
 */
export const shownDays = ref(0);
