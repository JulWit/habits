/**
 * @fileoverview How many day columns fit on the overview, measured on the
 * window and the size tokens of the stylesheet. Fewer than a week tighten the
 * board: stacked (names above their days) or tight (smaller columns), set on
 * <html> together with the size tokens, as the day header uses them too.
 */

import {route} from '../data/route.js';
import {state} from '../data/state.js';
import {arranging, onlyOpen, shownDays} from '../ui/board-state.js';
import {onMounted, onUnmounted, watch} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/** Minimum number of day columns. */
const MIN_DAYS = 7;

/**
 * Widest day column of a stacked board, in px: the touch target size of
 * Material Design (48dp), more than Apple's 44pt.
 */
const STACKED_CELL_MAX = 48;

/**
 * The size tokens the columns are computed from, in px (see base.css and
 * board.css): the cell, the minimum name column, the card's padding, the
 * reorder column (0 without handles), and the smallest cell and name column
 * of a tight board.
 * @typedef {{
 *   cell: number,
 *   labelMin: number,
 *   padX: number,
 *   tools: number,
 *   cellTightMin: number,
 *   labelTightMin: number,
 * }}
 */
let Tokens;

/**
 * Reads the size tokens of <html> at once, from one computed style.
 * @return {!Tokens}
 */
function readTokens() {
  const style = getComputedStyle(document.documentElement);
  /**
   * Returns a token in pixels, or 0 if it is not set.
   * @param {string} name
   * @return {number}
   */
  const px = (name) => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    // Defaults as in the grid template.
    cell: px('--cell') || 40,
    labelMin: px('--label-min') || 148,
    padX: px('--block-pad-x'),
    tools: px('--tools-col'),
    cellTightMin: px('--cell-tight-min'),
    labelTightMin: px('--label-tight-min'),
  };
}

/**
 * Returns the available width, measured on the container of the board, as
 * the board's own width depends on the number of columns. While the overview
 * is hidden, the width it would have: the window, up to its maximum width,
 * less its padding.
 * @param {!HTMLElement} container
 * @return {number}
 */
function availableWidth(container) {
  const style = getComputedStyle(container);
  const outer = container.hidden ? Math.min(
                                       document.documentElement.clientWidth,
                                       parseFloat(style.maxWidth) || Infinity) :
                                   container.clientWidth;
  return outer - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * Returns the width of `width` left for the name and day columns: without the
 * card's padding and border, and without the reorder column (zero without
 * handles; as --tools-track).
 * @param {number} width
 * @param {!Tokens} tokens
 * @return {number}
 */
function roomForColumns(width, {padX, tools}) {
  const track = tools > 0 ? tools + padX + 2 : 0;
  const card = 2 * padX + 2;
  return width - track - card;
}

/**
 * The layout of the board: the number of day columns, and whether and how it
 * is tightened, with the sizes of its cells and name column then.
 * @typedef {{
 *   days: number,
 *   mode: string,
 *   cell?: number,
 *   label?: number,
 * }}
 */
export let BoardLayout;

/**
 * Returns the layout of `width`: the setting `wanted` (0 for as many as fit),
 * limited to what fits. At least a week is shown, tightening the board if
 * needed; a fixed setting below seven is respected. A tightened board is
 * preferably stacked: each habit's name takes a line of its own above its
 * days, which then share the whole width, as long as that keeps the days at
 * least at their normal size, for touch. Otherwise the names stay beside the
 * days, and both shrink: first the day columns down to their tight minimum,
 * then the name column.
 * @param {number} width
 * @param {number} wanted
 * @param {!Tokens} tokens at the normal sizes
 * @return {!BoardLayout}
 */
export function layoutFor(width, wanted, tokens) {
  const room = roomForColumns(width, tokens);
  // Each column has a 2px gap.
  const fits =
      Math.max(3, Math.floor((room - tokens.labelMin) / (tokens.cell + 2)));
  const count = wanted > 0 ? Math.min(wanted, fits) : fits;
  const least = wanted > 0 ? Math.min(wanted, MIN_DAYS) : MIN_DAYS;
  if (count >= least) return {days: count, mode: 'normal'};

  // Stacked, the name column has no width; each day column keeps its gap.
  const stacked = Math.min(STACKED_CELL_MAX, Math.floor(room / least) - 2);
  if (stacked >= tokens.cell) {
    return {days: least, mode: 'stacked', cell: stacked, label: 0};
  }
  // The widest cell that leaves the name column its minimum width.
  const widest = Math.floor((room - tokens.labelTightMin) / least) - 2;
  const cell = Math.max(tokens.cellTightMin, Math.min(tokens.cell, widest));
  const label = Math.max(0, Math.floor(room - least * (cell + 2)));
  return {days: least, mode: 'tight', cell, label};
}

/**
 * Sets the attributes and size tokens of `layout` on <html>, changing only
 * what differs.
 * @param {!BoardLayout} layout
 */
function applyLayout(layout) {
  const root = document.documentElement;
  root.toggleAttribute('data-stacked', layout.mode === 'stacked');
  root.toggleAttribute('data-tight', layout.mode === 'tight');
  /**
   * Sets a custom property, or removes it for undefined.
   * @param {string} name
   * @param {string|undefined} value
   */
  const set = (name, value) => {
    if (value === undefined) {
      root.style.removeProperty(name);
    } else if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  };
  set('--cell', layout.cell === undefined ? undefined : `${layout.cell}px`);
  set('--label-min',
      layout.label === undefined ? undefined : `${layout.label}px`);
  set('--days', String(layout.days));
}

/**
 * Removes the tightening from <html>, so the tokens are read at their normal
 * sizes.
 */
function loosen() {
  const root = document.documentElement;
  if (!root.hasAttribute('data-tight') && !root.hasAttribute('data-stacked')) {
    return;
  }
  root.removeAttribute('data-tight');
  root.removeAttribute('data-stacked');
  root.style.removeProperty('--cell');
  root.style.removeProperty('--label-min');
}

/**
 * Measures how many day columns of the board `boardEl` fit, and again
 * whenever its container or the window changes size or a setting the columns
 * depend on changes. Sets shownDays (board-state.js). `hasHabits` tells
 * whether there is anything to measure.
 * @param {!Ref<?HTMLElement>} boardEl
 * @param {function(): boolean} hasHabits
 * @return {{measure: function(): void}}
 */
export function useBoardMeasure(boardEl, hasHabits) {
  /**
   * Measures the board. The attributes on <html> it depends on (density,
   * reordering, filter) are set first: reordering is disabled while
   * filtering, as the order would be incomplete, and without the handles the
   * board has more room.
   */
  const measure = () => {
    const root = document.documentElement;
    root.dataset.filtering = onlyOpen.value ? 'on' : 'off';
    root.dataset.edit = arranging.value ? 'on' : 'off';
    const container = boardEl.value?.parentElement;
    if (!container || !hasHabits()) return;
    // At normal sizes, read in one go: one layout for all of them.
    loosen();
    const width = availableWidth(container);
    // A hidden view has no width; the ResizeObserver measures again later.
    if (width <= 0) return;
    const layout =
        layoutFor(width, state.settings?.overviewDays ?? 0, readTokens());
    applyLayout(layout);
    shownDays.value = layout.days;
  };

  // Everything the number of columns depends on, including whether the view
  // is shown, as a hidden board cannot be measured. The attributes on <html>
  // are set by then (app.js), so the board is measured after the update.
  watch(
      [
        () => route.view === 'board',
        hasHabits,
        () => state.settings.density,
        () => state.settings.font,
        () => state.settings.overviewDays,
        () => state.settings.reorderMode,
        arranging,
        onlyOpen,
      ],
      measure,
      {flush: 'post'});

  /** @type {?ResizeObserver} */
  let observer = null;
  onMounted(() => {
    // Observes the container, as the board's own width depends on the day
    // count, and the body, as the other views take their width from the
    // board's (--board-width) while the overview is hidden. A view becoming
    // visible again changes the container's size too.
    observer = new ResizeObserver(measure);
    observer.observe(boardEl.value.parentElement);
    observer.observe(document.body);
    measure();
  });
  onUnmounted(() => observer?.disconnect());

  return {measure};
}
