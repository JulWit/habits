// Overview: one block per category with a row per habit and a column per day.
// All blocks share the same grid, so a single day header aligns with all of
// them.

import * as actions from './actions.js';
import {BoardDayCell, BoardHabitLabel, BoardHeadDay} from './board-cells.js';
import {addDays, dayOfMonth, daysBetween, formatLong, MONTH_LONG, MONTH_SHORT, monthIndex, weekdayIndex, yearOf} from './dates.js';
import {BoardDaySummary, dayProgress, initSummary, launchOrbs, newlyDone} from './day-summary.js';
import {enableDragReorder} from './drag-reorder.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {extendHistory} from './loader.js';
import {openCategory, openDays, openHabit, route} from './route.js';
import {groupedHabits, state} from './state.js';
import {computed, nextTick, onBeforeUpdate, onMounted, onUpdated, ref, watch} from './vue.js';

const LONG_PRESS_MS = 450;

// Number of additional days loaded when paging back beyond the loaded entries.
const PREFETCH_DAYS = 180;

/** Maximum number of days the board can be paged into the future. */
const MAX_AHEAD_DAYS = 365;

/** Minimum number of day columns. */
const MIN_DAYS = 7;

/** The board element (#board-grid), once mounted. @type {?HTMLElement} */
let board = null;

/** Whether reorder mode is active: the handles are shown. Not persisted. */
export const editing = ref(false);

/**
 * Number of days the board is shifted into the past; negative values show the
 * future. The window is anchored at its right edge.
 */
const offset = ref(0);

/**
 * The day chosen in the day header, or null for today. Marker, band and day
 * summary refer to it. Not persisted; null follows a change of date.
 * @type {!Object}
 */
const selectedDay = ref(null);

/** The number of day columns shown; 0 before the board could be measured. */
const days = ref(0);

/**
 * Whether a drag is in progress. The board keeps the blocks it showed when
 * the drag started, as the dragged element must stay where drag-reorder.js
 * put it.
 */
const dragging = ref(false);

/**
 * Returns the active day: the selected one, or today.
 * @return {string}
 */
function activeDay() {
  return selectedDay.value ?? state.today;
}

/**
 * Makes `iso` the active day; today resets the selection.
 * @param {string} iso
 */
function selectDay(iso) {
  selectedDay.value = iso === state.today ? null : iso;
}

/** Returns to today: the window and the active day. */
function backToToday() {
  selectedDay.value = null;
  showWindow(0);
}

/**
 * Returns the last day of a window `back` days before today, before week
 * alignment.
 * @param {number} back
 * @return {string}
 */
function windowEnd(back) {
  return addDays(state.today, -back);
}

/**
 * Returns the first day of a window of `count` columns `back` days before
 * today. With week alignment, the start moves forward to the next Monday, so
 * the current week is shown in full. Week alignment requires at least seven
 * columns.
 * @param {number} count
 * @param {number} back
 * @return {string}
 */
function windowStart(count, back) {
  const plain = addDays(windowEnd(back), -(count - 1));
  if (!alignsWeeks(count)) return plain;
  const weekday = weekdayIndex(plain);
  return weekday === 0 ? plain : addDays(plain, 7 - weekday);
}

/**
 * Reports whether the columns are aligned to calendar weeks.
 * @param {number} count
 * @return {boolean}
 */
function alignsWeeks(count) {
  return (state.settings?.alignWeeks ?? false) && count >= 7;
}

/**
 * Returns the paging step in days: whole weeks when aligned.
 * @param {number} count
 * @return {number}
 */
function pageStep(count) {
  return alignsWeeks(count) ? Math.floor(count / 7) * 7 : count;
}

/**
 * Reports whether reordering uses drag and drop (otherwise arrow buttons).
 * @return {boolean}
 */
const byDragging = () => (state.settings?.reorderMode ?? 'drag') === 'drag';

/**
 * Returns the largest offset whose window starts no earlier than
 * earliestEntry.
 * @return {number}
 */
function maxBackDays() {
  if (!state.earliestEntry) return Infinity;
  return Math.max(
      0, daysBetween(state.earliestEntry, state.today) - (days.value - 1));
}

/**
 * Moves the window to `next` days before today, clamped to the allowed range.
 * Loads missing entries first. Resolves once the board shows the window.
 * @param {number} next
 * @return {!Promise<void>}
 */
async function showWindow(next) {
  const wanted = Math.min(maxBackDays(), Math.max(-MAX_AHEAD_DAYS, next));
  if (wanted === offset.value) return;

  const start = windowStart(days.value, wanted);
  // ISO dates compare correctly as strings.
  if (state.entriesFrom && start < state.entriesFrom) {
    await extendHistory(addDays(start, -PREFETCH_DAYS));
  }
  offset.value = wanted;
  await nextTick();
}

/**
 * Pages the window by one step into the past (1) or the future (-1).
 * @param {number} direction
 * @return {!Promise<void>}
 */
function page(direction) {
  return showWindow(offset.value + direction * pageStep(days.value));
}

// ---------- measuring ----------

/**
 * Returns the available width, measured on the container, as the board's own
 * width depends on the number of columns. While the overview is hidden, the
 * width it would have: the window, up to its maximum width, less its padding.
 * Not measured on the other views, as they are only as wide as the board.
 * @return {number}
 */
function availableWidth() {
  const parent = board?.parentElement;
  if (!parent) return 0;
  const cs = getComputedStyle(parent);
  const outer = parent.hidden ? Math.min(
                                    document.documentElement.clientWidth,
                                    parseFloat(cs.maxWidth) || Infinity) :
                                parent.clientWidth;
  return outer - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/**
 * Returns a size token of <html> in pixels, or 0 if it is not set.
 * @param {string} name
 * @return {number}
 */
function token(name) {
  return parseFloat(getComputedStyle(document.documentElement)
                        .getPropertyValue(name)) ||
      0;
}

/**
 * Returns the width of `width` left for the name and day columns: without the
 * card's padding and border, and without the reorder column (zero without
 * handles; as --tools-track).
 * @param {number} width
 * @return {number}
 */
function roomForColumns(width) {
  const padX = token('--block-pad-x');
  const tools = token('--tools-col');
  const track = tools > 0 ? tools + padX + 2 : 0;
  const card = 2 * padX + 2;
  return width - track - card;
}

/**
 * Returns the maximum number of day columns that fit into `width`.
 * @param {number} width
 * @return {number}
 */
function fittingDays(width) {
  // Same tokens as the grid template; each column has a 2px gap.
  const cell = token('--cell') || 40;
  const labelMin = token('--label-min') || 148;
  return Math.max(
      3, Math.floor((roomForColumns(width) - labelMin) / (cell + 2)));
}

/**
 * Returns the number of day columns to show: the setting, limited to what
 * fits, or as many as fit in automatic mode. Tightens the board if fewer than
 * a week would fit.
 * @param {number} width
 * @return {number}
 */
function visibleDays(width) {
  // Measure at normal sizes.
  loosen();
  const fits = fittingDays(width);
  const wanted = state.settings?.overviewDays ?? 0;
  // Automatic mode: as many as fit.
  const count = wanted > 0 ? Math.min(wanted, fits) : fits;
  // At least a week is shown, tightening the board if needed. A fixed setting
  // below seven is respected.
  const least = wanted > 0 ? Math.min(wanted, MIN_DAYS) : MIN_DAYS;
  if (count >= least) return count;
  tighten(width, least);
  return least;
}

/** Resets the board to its normal sizes. */
function loosen() {
  const root = document.documentElement;
  if (!root.hasAttribute('data-tight')) return;
  root.removeAttribute('data-tight');
  root.style.removeProperty('--cell');
  root.style.removeProperty('--label-min');
}

/**
 * Shrinks the board so that `count` columns fit into `width`: first the day
 * columns down to --cell-tight-min, then the name column down to
 * --label-tight-min. Sets data-tight and the size tokens on <html>.
 * @param {number} width
 * @param {number} count
 */
function tighten(width, count) {
  const root = document.documentElement;
  root.setAttribute('data-tight', '');
  const room = roomForColumns(width);

  // The widest cell that leaves the name column its minimum width.
  const widest = Math.floor((room - token('--label-tight-min')) / count) - 2;
  const cell =
      Math.max(token('--cell-tight-min'), Math.min(token('--cell'), widest));
  const label = Math.max(0, Math.floor(room - count * (cell + 2)));

  root.style.setProperty('--cell', `${cell}px`);
  root.style.setProperty('--label-min', `${label}px`);
}

/**
 * Measures how many day columns fit and shows as many. The attributes on
 * <html> it depends on (density, reordering, filter) must be set before.
 */
export function measureBoard() {
  const root = document.documentElement;
  // Reordering is disabled while filtering, as the order would be incomplete;
  // without the handles the board has more room.
  root.dataset.filtering = onlyOpen.value ? 'on' : 'off';
  root.dataset.edit = editing.value ? 'on' : 'off';
  if (!board || groupedHabits().length === 0) return;
  // A hidden view has no width; the ResizeObserver measures again later.
  const width = availableWidth();
  if (width === 0) return;
  days.value = visibleDays(width);
  // Set on <html>, as the header also uses it.
  root.style.setProperty('--days', String(days.value));
}

/**
 * Returns the number of day columns currently shown.
 * @return {number}
 */
export function currentDays() {
  return days.value;
}

// ---------- filter ----------

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

/** Switches the filter and stores it, if localStorage is available. */
export function toggleFilter() {
  onlyOpen.value = !onlyOpen.value;
  try {
    localStorage.setItem(FILTER_KEY, onlyOpen.value ? '1' : '0');
  } catch {
    // Not kept.
  }
}

/**
 * Reports whether a habit passes the filter: with it, only habits due on the
 * active day (as counted by the day summary) and not yet complete.
 * @param {!Habit} habit
 * @return {boolean}
 */
function matches(habit) {
  if (!onlyOpen.value) return true;
  const day = activeDay();
  return !habit.archivedAt && habitHelpers.isDue(habit, day) &&
      !habitHelpers.isDone(habit, day);
}

// ---------- keyboard navigation ----------
//
// The day cells of all blocks are one tab stop, as are the days in the header
// (a roving tabindex, as in a grid): Tab enters at the cell focused last, at
// first the active day of the first habit, and the arrow keys move from there.
// Otherwise every day of every habit would be a tab stop of its own. Disabled
// cells cannot take focus and are skipped. The tab stops are set on the DOM
// after each update, as they depend on the cells rendered.

/**
 * The day cell focused last, as {habit, date}; kept across renders.
 * @type {?{habit: string, date: string}}
 */
let lastCell = null;

/** Gives the cells and the header days their single tab stop. */
function setTabStops() {
  const cells = [...board.querySelectorAll('[data-role="cell"]')];
  for (const cell of cells) {
    cell.tabIndex = -1;
  }
  const enabled = cells.filter((cell) => !cell.disabled);
  const entry = enabled.find(
                    (cell) => cell.dataset.habit === lastCell?.habit &&
                        cell.dataset.date === lastCell?.date) ??
      enabled.find((cell) => cell.dataset.date === activeDay()) ?? enabled[0];
  if (entry) entry.tabIndex = 0;

  const heads = [...board.querySelectorAll('[data-role="select-day"]')];
  for (const day of heads) {
    day.tabIndex = -1;
  }
  const current =
      heads.find((day) => day.getAttribute('aria-pressed') === 'true') ??
      heads.at(-1);
  if (current) current.tabIndex = 0;
}

/**
 * Makes a cell or header day the tab stop of its group; other controls keep
 * theirs.
 * @param {!Element} node
 */
function makeTabStop(node) {
  const role = node.dataset?.role;
  if (role !== 'cell' && role !== 'select-day') return;
  for (const other of board.querySelectorAll(
           `[data-role="${role}"][tabindex="0"]`)) {
    if (other !== node) other.tabIndex = -1;
  }
  node.tabIndex = 0;
  if (role === 'cell') {
    lastCell = {habit: node.dataset.habit, date: node.dataset.date};
  }
}

/**
 * Focuses `node`, if any, and makes it the tab stop of its group.
 * @param {?Element|undefined} node
 */
function rove(node) {
  if (!node) return;
  makeTabStop(node);
  node.focus();
}

/**
 * A cell or day focused by a click or Tab becomes the tab stop too.
 * @param {!FocusEvent} event
 */
function onBoardFocus(event) {
  makeTabStop(event.target);
}

/**
 * Arrow keys and what they do: dx moves along the row, dy between rows,
 * edge jumps to the first (-1) or last (1) day.
 * @const {!Object<string, {dx: (number|undefined), dy: (number|undefined),
 * edge: (number|undefined)}>}
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
 * Moves the focus between the cells and header days with the arrow keys.
 * @param {!KeyboardEvent} event
 */
function onBoardKeydown(event) {
  if (event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  const role = target.dataset?.role;
  if (role !== 'cell' && role !== 'select-day') return;
  const move = MOVES[event.key];
  // The header is a single row: up and down scroll the page as usual.
  if (!move || (role === 'select-day' && move.dy)) return;
  event.preventDefault();
  if (role === 'select-day') {
    const heads = [...board.querySelectorAll('[data-role="select-day"]')];
    rove(heads[clampedStep(heads, heads.indexOf(target), move)]);
    return;
  }
  moveFromCell(target, move, event.ctrlKey);
}

/**
 * Returns the index `move` leads to from `at` in `list`, within its bounds.
 * @param {!Array<*>} list
 * @param {number} at
 * @param {{dx: (number|undefined), dy: (number|undefined), edge:
 *     (number|undefined)}} move
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
  return [...row.querySelectorAll('[data-role="cell"]:not(:disabled)')];
}

/**
 * Moves the focus from `cell`. Left and right go along the row and page to
 * earlier or later days at its end; up and down keep the day and skip habits
 * with that day disabled; Home and End go to the row's first and last day,
 * with Ctrl to the first and last habit.
 * @param {!HTMLElement} cell
 * @param {{dx: (number|undefined), dy: (number|undefined), edge:
 *     (number|undefined)}} move
 * @param {boolean} ctrl
 * @return {!Promise<void>}
 */
async function moveFromCell(cell, {dx = 0, dy = 0, edge = 0}, ctrl) {
  const row = cell.closest('.habit-row');
  const rows = [...board.querySelectorAll('.habit-row')];

  if (dy) {
    const date = cell.dataset.date;
    for (let i = rows.indexOf(row) + dy; i >= 0 && i < rows.length; i += dy) {
      const next = rows[i].querySelector(
          `[data-role="cell"][data-date="${date}"]:not(:disabled)`);
      if (next) {
        rove(next);
        return;
      }
    }
    return;
  }

  if (edge) {
    // With Ctrl, the first or last habit with an enabled day.
    const candidates = ctrl ? (edge < 0 ? rows : rows.toReversed()) : [row];
    const cells = candidates.map(rowCells).find((c) => c.length > 0) ?? [];
    rove(edge < 0 ? cells[0] : cells.at(-1));
    return;
  }

  const cells = rowCells(row);
  const next = cells[cells.indexOf(cell) + dx];
  if (next) {
    rove(next);
    return;
  }
  // At the end of the row: page the window and continue there.
  const pager = board.querySelector(
      `[data-role="${dx < 0 ? 'page-older' : 'page-newer'}"]`);
  if (!pager || pager.disabled) return;
  const habit = cell.dataset.habit;
  await page(dx < 0 ? 1 : -1);
  const paged = board.querySelector(`.habit-row[data-habit="${habit}"]`);
  if (!paged) return;
  // The nearest enabled day beyond the one left.
  const beyond = rowCells(paged).filter(
      (c) => dx < 0 ? c.dataset.date < cell.dataset.date :
                      c.dataset.date > cell.dataset.date);
  rove(dx < 0 ? beyond.at(-1) : beyond[0]);
}

/**
 * Describes the focused control of the board, so that focus can be restored
 * when an update moved or replaced it.
 * @return {?{role: string, category: string, habit: string, date: string}}
 */
function focusedControl() {
  const focused = document.activeElement;
  if (!focused || !board.contains(focused) || !focused.dataset.role) {
    return null;
  }
  return {
    role: focused.dataset.role,
    category: focused.closest('.block')?.dataset.category ?? '',
    habit: focused.dataset.habit ?? '',
    date: focused.dataset.date ?? '',
  };
}

/**
 * Focuses the control that `target` describes, if it is still there.
 * @param {?{role: string, category: string, habit: string, date: string}}
 *     target
 */
function restoreFocus(target) {
  if (!target) return;
  const scope = target.category ?
      board.querySelector(`.block[data-category="${target.category}"]`) :
      board;
  if (!scope) return;
  let selector = `[data-role="${target.role}"]`;
  if (target.habit) selector += `[data-habit="${target.habit}"]`;
  if (target.date) selector += `[data-date="${target.date}"]`;
  const next = scope.querySelector(selector);
  // Do not focus a disabled button.
  if (next && !next.disabled) rove(next);
}

// ---------- taps and long presses ----------

/**
 * Whether the next click on a cell is suppressed. A long press opens the
 * value dialog, and the click that follows is suppressed; the flag is reset
 * by a timer, as a long press may end without a click.
 */
let suppressClick = false;
/** @type {number|undefined} */
let suppressTimer;

/** Suppresses the click that follows a long press. */
function suppressNextClick() {
  suppressClick = true;
  clearTimeout(suppressTimer);
  // Covers the click after release, but not a deliberate second tap.
  suppressTimer = setTimeout(() => {
    suppressClick = false;
  }, 700);
}

/**
 * Handles a tap on a day cell, unless it ends a long press.
 * @param {string} habitId
 * @param {string} iso
 */
function tapCell(habitId, iso) {
  if (suppressClick) {
    suppressClick = false;
    clearTimeout(suppressTimer);
    return;
  }
  actions.tapEntry(habitId, iso);
}

/**
 * Opens the value dialog on a right-click, or on a long press on touch.
 * @param {!MouseEvent} event
 * @param {string} habitId
 * @param {string} iso
 */
function onCellContextMenu(event, habitId, iso) {
  if (event.currentTarget.disabled) return;
  event.preventDefault();
  // On touch, a long press also fires contextmenu (Firefox on Android after
  // 500 ms). Only the first of the two counts, or a check would toggle twice.
  if (suppressClick) return;
  cancelLongPress();
  actions.editEntry(habitId, iso);
}

/**
 * Cancels a pending long press; set by attachLongPress.
 * @type {function(): void}
 */
let cancelLongPress = () => {};

/**
 * Opens the value dialog when a cell is pressed for LONG_PRESS_MS.
 * @param {!HTMLElement} root
 */
function attachLongPress(root) {
  let timer = null;
  let origin = null;

  /** Stops waiting for a long press. */
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    origin = null;
  };
  cancelLongPress = cancel;

  root.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-role="cell"]');
    if (!target || target.disabled || event.button !== 0) return;
    origin = {x: event.clientX, y: event.clientY};
    timer = setTimeout(() => {
      timer = null;
      suppressNextClick();
      actions.editEntry(target.dataset.habit, target.dataset.date);
    }, LONG_PRESS_MS);
  });

  // Cancel the long press only when the pointer moves beyond a tolerance.
  root.addEventListener('pointermove', (event) => {
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      cancel();
    }
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    root.addEventListener(type, cancel);
  }
}

// ---------- components ----------

/**
 * An icon button of the board. `handle` makes it a drag handle, `habit`
 * names the habit it acts on; `icon` names one of `icons`.
 */
const BoardToolButton = {
  name: 'BoardToolButton',
  props: {
    role: String,
    icon: String,
    label: String,
    handle: Boolean,
    habit: String,
    disabled: Boolean,
  },
  // Disabled rather than hidden at a limit.
  template: `
    <button
      type="button"
      class="icon-button"
      :class="{'drag-handle': handle}"
      :data-role="role"
      :data-habit="habit"
      :title="label"
      :aria-label="label"
      :disabled="disabled"
    >
      <app-icon :name="icon"/>
    </button>`,
};

/** A category's progress bar for a day: one segment per habit due. */
const BoardBlockProgress = {
  name: 'BoardBlockProgress',
  props: {
    habits: {type: Array, required: true},
    day: {type: String, required: true},
  },
  setup(props) {
    const progress = computed(() => dayProgress(props.habits, props.day));
    const title = computed(() => {
      const {due, done} = progress.value;
      return `${formatLong(props.day)}: ${
          t('{done} of {due} done', {done, due})}`;
    });
    return {progress, title};
  },
  // No bar if nothing is due on the day.
  template: `
    <div
      v-if="progress.due > 0"
      class="block-progress"
      :class="{'is-complete': progress.done === progress.due}"
      :title="title"
    >
      <span
        class="block-progress-track"
        :style="{'--segments': String(progress.due)}"
        role="progressbar"
        aria-valuemin="0"
        :aria-valuemax="progress.due"
        :aria-valuenow="progress.done"
        :aria-label="t('Done on this day')"
      >
        <span
          v-for="i in progress.due"
          :key="i"
          class="block-progress-seg"
          :class="{'is-done': i <= progress.done}"
        ></span>
      </span>
      <span class="block-progress-count">{{ progress.done }}/{{ progress.due }}
      </span>
    </div>`,
};

/**
 * The row of a habit: its label, a cell per day and its reorder controls.
 * `siblings` are the habits of its category, `at` its place among them.
 */
const BoardHabitRow = {
  name: 'BoardHabitRow',
  components: {BoardDayCell, BoardHabitLabel, BoardToolButton},
  props: {
    habit: {type: Object, required: true},
    at: {type: Number, required: true},
    siblings: {type: Number, required: true},
    dates: {type: Array, required: true},
    active: {type: String, required: true},
  },
  setup() {
    return {
      byDragging,
      tapCell,
      onCellContextMenu,
      open: (id) => openHabit(id),
      move: (id, delta) => actions.moveHabit(id, delta),
    };
  },
  // The tools are always rendered, to keep the column width; there are none
  // with a single habit.
  template: `
    <div
      class="habit-row"
      :data-habit="habit.id"
    >
      <div class="habit-cell">
        <board-habit-label
          :habit="habit"
          @click="open(habit.id)"
        />
      </div>
      <board-day-cell
        v-for="iso in dates"
        :key="iso"
        :habit="habit"
        :iso="iso"
        :active="active"
        @click="tapCell(habit.id, iso)"
        @contextmenu="onCellContextMenu($event, habit.id, iso)"
      />
      <div class="habit-tools">
        <template v-if="siblings >= 2">
          <board-tool-button
            v-if="byDragging()"
            role="drag-habit"
            icon="grip"
            :label="t('Move habit')"
            handle
            :habit="habit.id"
          />
          <template v-else>
            <board-tool-button
              role="move-habit-up"
              icon="chevronUp"
              :label="t('Move habit up')"
              :habit="habit.id"
              :disabled="at === 0"
              @click="move(habit.id, -1)"
            />
            <board-tool-button
              role="move-habit-down"
              icon="chevronDown"
              :label="t('Move habit down')"
              :habit="habit.id"
              :disabled="at === siblings - 1"
              @click="move(habit.id, 1)"
            />
          </template>
        </template>
      </div>
    </div>`,
};

/**
 * The block of a category: its heading with progress and reorder controls,
 * and the rows of the habits that pass the filter. `block.habits` are all
 * habits of the category, `block.visible` those shown.
 */
const BoardBlock = {
  name: 'BoardBlock',
  components: {BoardBlockProgress, BoardHabitRow, BoardToolButton},
  props: {
    block: {type: Object, required: true},
    labelled: Boolean,
    dates: {type: Array, required: true},
    active: {type: String, required: true},
  },
  setup(props) {
    const category = computed(() => props.block.category);
    /**
     * Returns what the row of `habit` depends on, for its v-memo.
     * @param {!Habit} habit
     * @return {!Array<*>}
     */
    const rowMemo = (habit) =>
        [habit,
         props.dates[0],
         props.dates.length,
         props.active,
         state.today,
         byDragging(),
         props.block.habits.indexOf(habit),
         props.block.habits.length,
    ];
    return {
      state,
      byDragging,
      category,
      rowMemo,
      // The place of the category among all, for the arrow buttons.
      at: computed(
          () => state.categories.findIndex((c) => c.id === category.value?.id)),
      openCategory: () => openCategory(category.value.id),
      move: (delta) => actions.moveCategory(category.value.id, delta),
    };
  },
  // Uncategorised habits have no category controls and no progress. Renaming
  // and deleting are done in the category view. The rows are only built again
  // when their habit (which the state replaces on every change) or their place
  // changes.
  template: `
    <section
      class="block"
      :data-category="category?.id"
    >
      <header
        v-if="labelled"
        class="block-head"
      >
        <h2 class="block-title">
          <button
            v-if="category"
            type="button"
            class="block-link"
            data-role="open-category"
            @click="openCategory"
          >
            <app-icon-badge
              class="habit-icon"
              :icon="category.icon"
              :color="category.color || null"
            />
            <span class="block-link-name">{{ category.name }}</span>
          </button>
          <template v-else>{{ t('No category') }}</template>
        </h2>
        <board-block-progress
          v-if="category?.showProgress === true"
          :habits="block.habits"
          :day="active"
        />
        <div
          v-if="category && state.categories.length >= 2"
          class="block-tools"
        >
          <board-tool-button
            v-if="byDragging()"
            role="drag-category"
            icon="grip"
            :label="t('Move category')"
            handle
          />
          <template v-else>
            <board-tool-button
              role="move-category-up"
              icon="chevronUp"
              :label="t('Move category up')"
              :disabled="at <= 0"
              @click="move(-1)"
            />
            <board-tool-button
              role="move-category-down"
              icon="chevronDown"
              :label="t('Move category down')"
              :disabled="at === state.categories.length - 1"
              @click="move(1)"
            />
          </template>
        </div>
      </header>
      <p
        v-if="block.visible.length === 0"
        class="block-empty"
      >
        {{ t('No habit in this category yet.') }}
      </p>
      <div
        v-else
        class="block-rows"
      >
        <board-habit-row
          v-for="habit in block.visible"
          :key="habit.id"
          v-memo="rowMemo(habit)"
          :habit="habit"
          :at="block.habits.indexOf(habit)"
          :siblings="block.habits.length"
          :dates="dates"
          :active="active"
        />
      </div>
    </section>`,
};

/**
 * The overview: the day header, the day summary and a block per category,
 * followed by the empty states and the button back to today. Rendered inside
 * <main id="board-view">, whose width it measures.
 */
export const TheBoardView = {
  name: 'TheBoardView',
  components: {BoardBlock, BoardDaySummary, BoardHeadDay, BoardToolButton},
  setup() {
    const boardEl = ref(null);
    const all = computed(() => groupedHabits());
    const everyHabit = computed(() => all.value.flatMap((b) => b.habits));
    const active = computed(activeDay);

    // Blocks keep all habits for the progress bar, plus the filtered habits
    // for the rows.
    let frozen = [];
    const blocks = computed(() => {
      if (dragging.value) return frozen;
      return all.value.map((b) => ({...b, visible: b.habits.filter(matches)}))
          .filter((b) => !onlyOpen.value || b.visible.length > 0);
    });

    // Dates of the columns, oldest first.
    const dates = computed(() => {
      if (days.value === 0) return [];
      const start = windowStart(days.value, offset.value);
      return Array.from({length: days.value}, (_, i) => addDays(start, i));
    });
    // Column of the active day for the band; -1 if not visible.
    const activeColumn = computed(() => dates.value.indexOf(active.value));

    // Habits newly completed on the active day send orbs into the ring. They
    // are found before the board is updated, while it shows their cells.
    watch([everyHabit, active], ([habits, day]) => {
      const flights = newlyDone(habits, day);
      if (flights.length > 0) nextTick(() => flights.forEach(launchOrbs));
    }, {immediate: true, flush: 'pre'});

    // Everything the number of columns depends on, including whether the view
    // is shown, as a hidden board cannot be measured. The attributes on <html>
    // are set by then (app.js), so the board is measured after the update.
    watch(
        [
          () => route.view === 'board',
          () => all.value.length > 0,
          () => state.settings.density,
          () => state.settings.font,
          () => state.settings.overviewDays,
          () => state.settings.reorderMode,
          editing,
          onlyOpen,
        ],
        measureBoard,
        {flush: 'post'});

    // An update may move or replace the focused control, e.g. a row moved by
    // its arrow button: focus it again.
    let focused = null;
    onBeforeUpdate(() => {
      focused = focusedControl();
    });
    onUpdated(() => {
      setTabStops();
      if (!board.contains(document.activeElement)) restoreFocus(focused);
    });

    onMounted(() => {
      board = boardEl.value;
      initSummary(board);
      attachLongPress(board);
      initDragging(board, () => {
        frozen = blocks.value;
      });
      // Measure again when the available width changes, including when the
      // view becomes visible again. Observes the container, as the board's
      // own width depends on the day count, and the body, as the other views
      // take their width from the board's (--board-width) while the overview
      // is hidden.
      const observer = new ResizeObserver(measureBoard);
      observer.observe(board.parentElement);
      observer.observe(document.body);
      measureBoard();
    });

    return {
      boardEl,
      all,
      everyHabit,
      blocks,
      dates,
      active,
      activeColumn,
      // A single uncategorised block is shown without heading.
      labelled: computed(
          () => all.value.length > 1 || all.value[0]?.category !== null),
      monthLabels: computed(() => monthLabels(dates.value)),
      offset,
      selectedDay,
      onlyOpen,
      MAX_AHEAD_DAYS,
      maxBackDays,
      page,
      selectDay,
      backToToday,
      dayOfMonth,
      onBoardKeydown,
      onBoardFocus,
      createHabit: () => actions.createHabit(),
      openDays: () => openDays(),
    };
  },
  // No aria-live, as changes are announced via #board-status. With habits,
  // the board is shown even when the filter leaves no block, so the day header
  // stays available for choosing another day.
  template: `
    <div
      id="board-grid"
      ref="boardEl"
      class="board"
      :class="{'has-today': activeColumn >= 0}"
      :style="activeColumn >= 0 ? {'--today-col': String(activeColumn)} : null"
      :hidden="all.length === 0"
      @keydown="onBoardKeydown"
      @focusin="onBoardFocus"
    >
      <template v-if="dates.length > 0">
        <div class="day-header">
          <!-- Backdrop behind the sticky header. An element, as it needs a
               clipped layer of its own over a background image. -->
          <div
            class="day-header-backdrop"
            aria-hidden="true"
          ></div>
          <!-- Paging, in the date row above the habit names. Back to today is
               the floating button. -->
          <div
            class="day-nav"
            style="grid-column: 1; grid-row: 2"
          >
            <board-tool-button
              role="page-older"
              icon="chevronLeft"
              :label="t('Earlier days')"
              :disabled="offset >= maxBackDays()"
              @click="page(1)"
            />
            <board-tool-button
              role="page-newer"
              icon="chevronRight"
              :label="t('Later days')"
              :disabled="offset <= -MAX_AHEAD_DAYS"
              @click="page(-1)"
            />
          </div>
          <div
            v-for="month in monthLabels"
            :key="month.start"
            class="month-label"
            :class="{'has-divider': month.start > 0}"
            :title="month.title"
            :style="{'grid-column': month.column, 'grid-row': '1'}"
          >
            {{ month.name }}
          </div>
          <!-- Column 1 holds the habit names; a month starts with a divider,
               but not on the first column. -->
          <board-head-day
            v-for="(iso, i) in dates"
            :key="iso"
            :iso="iso"
            :active="active"
            selectable
            :class="{'is-month-start': i > 0 && dayOfMonth(iso) === 1}"
            :style="{'grid-column': String(i + 2), 'grid-row': '2'}"
            @click="selectDay(iso)"
          />
        </div>
        <board-day-summary
          :habits="everyHabit"
          :day="active"
          @open="openDays"
        />
        <board-block
          v-for="block in blocks"
          :key="block.category?.id ?? ''"
          :block="block"
          :labelled="labelled"
          :dates="dates"
          :active="active"
        />
      </template>
    </div>
    <p
      id="board-no-match"
      class="empty"
      :hidden="!(onlyOpen && all.length > 0 && blocks.length === 0)"
    >
      {{ t('Nothing left open on this day.') }}
    </p>
    <div
      id="board-empty"
      class="empty"
      :hidden="all.length > 0"
    >
      <h2>{{ t('No habits yet') }}</h2>
      <p>
        {{ t('Create your first habit — daily, on certain weekdays or every few days.') }}
      </p>
      <button
        class="button primary"
        type="button"
        @click="createHabit"
      >
        {{ t('Create first habit') }}
      </button>
    </div>
    <button
      type="button"
      class="button today-pill"
      :hidden="offset === 0 && selectedDay === null"
      @click="backToToday"
    >
      <app-icon name="toToday"/><span>{{ t('Back to today') }}</span>
    </button>`,
};

/**
 * A month label of the day header, spanning its columns. `column` is its
 * CSS grid-column; column 1 holds the habit names.
 * @typedef {{start: number, column: string, name: string, title: string}}
 */
let MonthLabel;

/**
 * Returns a label per month of `dates`, spanning its columns.
 * @param {!Array<string>} dates
 * @return {!Array<!MonthLabel>}
 */
function monthLabels(dates) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= dates.length; i++) {
    const sameMonth = i < dates.length &&
        monthIndex(dates[i]) === monthIndex(dates[start]) &&
        yearOf(dates[i]) === yearOf(dates[start]);
    if (sameMonth) continue;

    const span = i - start;
    const month = monthIndex(dates[start]);
    const year = yearOf(dates[start]);
    // Only show the year if it is not the current one.
    const suffix = year === yearOf(state.today) ? '' : ` ${year}`;
    // Short month name if the span is too narrow.
    const name = (span >= 5 ? MONTH_LONG[month] : MONTH_SHORT[month]) + suffix;
    out.push({
      start,
      column: `${start + 2} / span ${span}`,
      name,
      title: `${MONTH_LONG[month]} ${year}`,
    });
    start = i;
  }
  return out;
}

/**
 * Enables drag and drop for both categories and habit rows; the handle
 * determines which list is reordered. `freeze` is called when a drag starts,
 * so the board keeps its blocks until it ends.
 * @param {!HTMLElement} root
 * @param {function(): void} freeze
 */
function initDragging(root, freeze) {
  /**
   * Returns the drag callbacks of a list that is saved with `save`.
   * @param {function(!Array<string>): *} save
   * @return {{onStart: function(): void, onDrop: function(!Array<string>):
   *     void, onCancel: function(): void}}
   */
  const callbacks = (save) => ({
    onStart: () => {
      freeze();
      dragging.value = true;
    },
    onDrop: (ids) => {
      dragging.value = false;
      save(ids);
    },
    onCancel: () => {
      dragging.value = false;
    },
  });
  enableDragReorder({
    container: root,
    item: '.block[data-category]',
    handle: '[data-role="drag-category"]',
    key: 'category',
    ...callbacks(actions.setCategoryOrder),
  });
  enableDragReorder({
    container: root,
    item: '.habit-row',
    handle: '[data-role="drag-habit"]',
    key: 'habit',
    ...callbacks(actions.setHabitOrder),
  });
}
