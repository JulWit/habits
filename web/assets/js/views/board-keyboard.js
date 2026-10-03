/**
 * @fileoverview Keyboard navigation of the overview. The day cells of all
 * blocks are one tab stop, as are the days in the header (a roving tabindex,
 * as in a grid): Tab enters at the cell focused last, at first the active day
 * of the first habit, and the arrow keys move from there. Otherwise every day
 * of every habit would be a tab stop of its own. Disabled cells cannot take
 * focus and are skipped.
 *
 * The tab stops are state: the cells render their tabindex from it. Moving
 * the focus is DOM work, as is restoring it when an update moved or replaced
 * the focused control.
 */

import {computed, onBeforeUpdate, onUpdated, ref, shallowRef, watch} from '../vue.js';

import {isCellDisabled} from './board-cells.js';

/** @import {Habit} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */

/**
 * A day cell of the board: its habit's ID and its date.
 * @typedef {{habit: string, date: string}}
 */
export let CellKey;

/**
 * Arrow keys and what they do: dx moves along the row, dy between rows,
 * edge jumps to the first (-1) or last (1) day.
 * @const {!Object<string, {dx?: number, dy?: number,
 *     edge?: number}>}
 */
const MOVES = {
  ArrowLeft: {dx: -1},
  ArrowRight: {dx: 1},
  ArrowUp: {dy: -1},
  ArrowDown: {dy: 1},
  Home: {edge: -1},
  End: {edge: 1},
};

/**
 * Returns a selector of the elements whose data attribute `name` is `value`.
 * @param {string} name e.g. "habit" for data-habit
 * @param {string} value
 * @return {string}
 */
function byData(name, value) {
  return `[data-${name}="${CSS.escape(value)}"]`;
}

/**
 * Returns the index `move` leads to from `at` in `list`, within its bounds.
 * @param {!Array<*>} list
 * @param {number} at
 * @param {{dx?: number, edge?: number}} move
 * @return {number}
 */
function clampedStep(list, at, {dx = 0, edge = 0}) {
  if (edge) return edge < 0 ? 0 : list.length - 1;
  return Math.min(list.length - 1, Math.max(0, at + dx));
}

/**
 * The enabled day cells of a row, oldest first.
 * @param {!Element} row
 * @return {!Array<!HTMLButtonElement>}
 */
function rowCells(row) {
  return /** @type {!Array<!HTMLButtonElement>} */ (
      [...row.querySelectorAll('[data-role="cell"]:not(:disabled)')]);
}

/**
 * The keyboard navigation of the board `boardEl`: `rows` are the habits shown,
 * in board order, `dates` the dates of the columns, `activeDay` the day
 * chosen in the header, and `page(direction)` pages the window (1 earlier, -1
 * later). Returns the tab stops of the cells and the header, and the
 * listeners for the board.
 * @param {{
 *   boardEl: !Ref<?HTMLElement>,
 *   rows: !Ref<!Array<!Habit>>,
 *   dates: !Ref<!Array<string>>,
 *   activeDay: !Ref<string>,
 *   page: function(number): !Promise<void>,
 * }} board
 * @return {{
 *   cellStop: !Ref<?CellKey>,
 *   headStop: !Ref<?string>,
 *   onKeydown: function(!KeyboardEvent): void,
 *   onFocusin: function(!FocusEvent): void,
 * }}
 */
export function useBoardKeyboard({boardEl, rows, dates, activeDay, page}) {
  /** The day cell focused last; kept across renders. */
  const lastCell = shallowRef(/** @type {?CellKey} */ (null));
  /** The header day focused last, until another day becomes active. */
  const lastHead = ref(/** @type {?string} */ (null));
  watch(activeDay, () => {
    lastHead.value = null;
  });

  // The cell focused last if it is still shown and enabled, else the active
  // day of the first habit that has it enabled, else the first enabled cell.
  const cellStop = computed(() => {
    const shown = dates.value;
    const habits = rows.value;
    const last = lastCell.value;
    if (last && shown.includes(last.date)) {
      const habit = habits.find((h) => h.id === last.habit);
      if (habit && !isCellDisabled(habit, last.date)) return last;
    }
    const day = activeDay.value;
    if (shown.includes(day)) {
      const habit = habits.find((h) => !isCellDisabled(h, day));
      if (habit) return {habit: habit.id, date: day};
    }
    for (const habit of habits) {
      const date = shown.find((d) => !isCellDisabled(habit, d));
      if (date) return {habit: habit.id, date};
    }
    return null;
  });

  // The header day focused last, else the active day, else the last one.
  const headStop = computed(() => {
    const shown = dates.value;
    if (lastHead.value && shown.includes(lastHead.value)) return lastHead.value;
    return shown.includes(activeDay.value) ? activeDay.value :
                                             shown.at(-1) ?? null;
  });

  /**
   * Makes a cell or header day the tab stop of its group.
   * @param {!Element} node
   */
  const makeTabStop = (node) => {
    if (!(node instanceof HTMLElement)) return;
    const {role, habit, date} = node.dataset;
    if (!date) return;
    if (role === 'cell' && habit) lastCell.value = {habit, date};
    if (role === 'select-day') lastHead.value = date;
  };

  /**
   * Focuses `node`, if any, and makes it the tab stop of its group.
   * @param {?Element|undefined} node
   */
  const rove = (node) => {
    if (!(node instanceof HTMLElement)) return;
    makeTabStop(node);
    node.focus();
  };

  /**
   * Moves the focus from `cell`. Left and right go along the row and page to
   * earlier or later days at its end; up and down keep the day and skip
   * habits with that day disabled; Home and End go to the row's first and
   * last day, with Ctrl to the first and last habit.
   * @param {!HTMLElement} cell
   * @param {{dx?: number, dy?: number, edge:
   *     (number|undefined)}} move
   * @param {boolean} ctrl
   * @return {!Promise<void>}
   */
  const moveFromCell = async (cell, {dx = 0, dy = 0, edge = 0}, ctrl) => {
    const board = boardEl.value;
    const row = cell.closest('.board-habit-row');
    const date = cell.dataset.date ?? '';
    if (!board || !row) return;
    const allRows = [...board.querySelectorAll('.board-habit-row')];

    if (dy) {
      for (let i = allRows.indexOf(row) + dy; i >= 0 && i < allRows.length;
           i += dy) {
        const next = allRows[i].querySelector(
            `[data-role="cell"]${byData('date', date)}:not(:disabled)`);
        if (next) {
          rove(next);
          return;
        }
      }
      return;
    }

    if (edge) {
      // With Ctrl, the first or last habit with an enabled day.
      const candidates =
          ctrl ? (edge < 0 ? allRows : allRows.toReversed()) : [row];
      const cells = candidates.map(rowCells).find((c) => c.length > 0) ?? [];
      rove(edge < 0 ? cells[0] : cells.at(-1));
      return;
    }

    const cells = rowCells(row);
    const next = cells[cells.indexOf(/** @type {*} */ (cell)) + dx];
    if (next) {
      rove(next);
      return;
    }
    // At the end of the row: page the window and continue there.
    const pager = board.querySelector(
        `[data-role="${dx < 0 ? 'page-older' : 'page-newer'}"]`);
    if (!(pager instanceof HTMLButtonElement) || pager.disabled) return;
    const habit = cell.dataset.habit ?? '';
    await page(dx < 0 ? 1 : -1);
    const paged =
        board.querySelector(`.board-habit-row${byData('habit', habit)}`);
    if (!paged) return;
    // The nearest enabled day beyond the one left.
    const beyond = rowCells(paged).filter(
        (c) => dx < 0 ? (c.dataset.date ?? '') < date :
                        (c.dataset.date ?? '') > date);
    rove(dx < 0 ? beyond.at(-1) : beyond[0]);
  };

  /**
   * Moves the focus between the cells and header days with the arrow keys.
   * @param {!KeyboardEvent} event
   */
  const onKeydown = (event) => {
    if (event.altKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.dataset.role;
    if (role !== 'cell' && role !== 'select-day') return;
    const move = MOVES[event.key];
    // The header is a single row: up and down scroll the page as usual.
    if (!move || (role === 'select-day' && move.dy)) return;
    event.preventDefault();
    if (role === 'select-day') {
      const heads = [
        ...boardEl.value?.querySelectorAll('[data-role="select-day"]') ?? [],
      ];
      rove(heads[clampedStep(heads, heads.indexOf(target), move)]);
      return;
    }
    moveFromCell(target, move, event.ctrlKey);
  };

  /**
   * A cell or day focused by a click or Tab becomes the tab stop too.
   * @param {!FocusEvent} event
   */
  const onFocusin = (event) => {
    makeTabStop(/** @type {!Element} */ (event.target));
  };

  useFocusRestore(boardEl, rove);
  return {cellStop, headStop, onKeydown, onFocusin};
}

/**
 * A control of the board, described so that it can be found again after an
 * update: its role, and its category, habit and date where it has them.
 * @typedef {{role: string, category: string, habit: string, date: string}}
 */
let ControlKey;

/**
 * Focuses the board's control again when an update moved or replaced the
 * focused one, e.g. a row moved by its arrow button. `rove` focuses a control
 * and makes it the tab stop of its group.
 * @param {!Ref<?HTMLElement>} boardEl
 * @param {function(?Element): void} rove
 */
function useFocusRestore(boardEl, rove) {
  /** @type {?ControlKey} */
  let focused = null;

  onBeforeUpdate(() => {
    const board = boardEl.value;
    const active = document.activeElement;
    focused = board && active instanceof HTMLElement &&
            board.contains(active) && active.dataset.role ?
        {
          role: active.dataset.role,
          category:
              active.closest('.board-block')?.getAttribute('data-category') ??
              '',
          habit: active.dataset.habit ?? '',
          date: active.dataset.date ?? '',
        } :
        null;
  });

  onUpdated(() => {
    const board = boardEl.value;
    if (!focused || !board || board.contains(document.activeElement)) return;
    const scope = focused.category ?
        board.querySelector(
            `.board-block${byData('category', focused.category)}`) :
        board;
    if (!scope) return;
    let selector = byData('role', focused.role);
    if (focused.habit) selector += byData('habit', focused.habit);
    if (focused.date) selector += byData('date', focused.date);
    const next = scope.querySelector(selector);
    // Do not focus a disabled button.
    if (next && !(next instanceof HTMLButtonElement && next.disabled)) {
      rove(next);
    }
  });
}
