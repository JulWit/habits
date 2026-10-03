/**
 * @fileoverview Long presses on the day cells of the overview: a press held
 * for LONG_PRESS_MS opens the cell's day dialog, as a right-click does, and
 * the click that follows the press is not taken as a tap.
 */

import {onMounted, onUnmounted} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/** How long a cell is pressed to open its value dialog, in milliseconds. */
const LONG_PRESS_MS = 450;

/** How far the pointer may move during a long press, in px. */
const TOLERANCE = 10;

/**
 * How long after a long press its click is suppressed, in ms: it covers the
 * click after the release, but not a deliberate second tap.
 */
const SUPPRESS_MS = 700;

/**
 * Watches the day cells of the board `boardEl` for long presses, which call
 * `onLongPress(habitId, date)`. Returns `takesClick`, which reports whether a
 * click on a cell is a tap rather than the end of a long press, and
 * `onContextMenu`, the handler of a cell's right-click (or long press on
 * touch, where Firefox on Android fires contextmenu after 500 ms).
 * @param {!Ref<?HTMLElement>} boardEl
 * @param {function(string, string): *} onLongPress
 * @return {{
 *   takesClick: function(): boolean,
 *   onContextMenu: function(!MouseEvent, string, string): void,
 * }}
 */
export function useLongPress(boardEl, onLongPress) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  /** @type {?{x: number, y: number}} */
  let origin = null;
  /** Whether the next click on a cell ends a long press. */
  let suppressClick = false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let suppressTimer;

  /** Stops waiting for a long press. */
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    origin = null;
  };

  /**
   * Suppresses the click that follows a long press. The flag is reset by a
   * timer, as a long press may end without a click.
   */
  const suppressNextClick = () => {
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressClick = false;
    }, SUPPRESS_MS);
  };

  /**
   * Starts waiting for a long press on a cell.
   * @param {!PointerEvent} event
   */
  const onPointerDown = (event) => {
    const target = /** @type {?HTMLButtonElement} */ (
        /** @type {!Element} */ (event.target).closest('[data-role="cell"]'));
    if (!target || target.disabled || event.button !== 0) return;
    origin = {x: event.clientX, y: event.clientY};
    timer = setTimeout(() => {
      timer = undefined;
      suppressNextClick();
      onLongPress(target.dataset.habit, target.dataset.date);
    }, LONG_PRESS_MS);
  };

  /**
   * Cancels the long press once the pointer moves beyond the tolerance.
   * @param {!PointerEvent} event
   */
  const onPointerMove = (event) => {
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
        TOLERANCE) {
      cancel();
    }
  };

  /** @const {!Array<string>} */
  const ends = ['pointerup', 'pointercancel', 'pointerleave'];

  onMounted(() => {
    const board = boardEl.value;
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    for (const type of ends) board.addEventListener(type, cancel);
  });
  onUnmounted(() => {
    const board = boardEl.value;
    cancel();
    clearTimeout(suppressTimer);
    if (!board) return;
    board.removeEventListener('pointerdown', onPointerDown);
    board.removeEventListener('pointermove', onPointerMove);
    for (const type of ends) board.removeEventListener(type, cancel);
  });

  return {
    takesClick: () => {
      if (!suppressClick) return true;
      suppressClick = false;
      clearTimeout(suppressTimer);
      return false;
    },
    onContextMenu: (event, habitId, iso) => {
      if (/** @type {!HTMLButtonElement} */ (event.currentTarget).disabled) {
        return;
      }
      event.preventDefault();
      // On touch, a long press also fires contextmenu. Only the first of the
      // two counts, or a check would toggle twice.
      if (suppressClick) return;
      cancel();
      onLongPress(habitId, iso);
    },
  };
}
