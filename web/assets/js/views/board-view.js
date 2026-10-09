/**
 * @fileoverview Overview: one block per category, or a single one without
 * heading if it is not grouped by category, with a row per habit and a column
 * per day. All blocks share the same grid, so a single day header aligns with
 * all of them. The days shown are in board-window.js, how many fit in
 * board-measure.js, the keyboard navigation in board-keyboard.js and long
 * presses in board-press.js.
 */

import * as actions from '../data/actions.js';
import * as habitHelpers from '../data/habit-helpers.js';
import {openCategory, openDays, openHabit} from '../data/route.js';
import {boardBlocks, state} from '../data/state.js';
import {openDayEditor} from '../dialogs/day-editor.js';
import {openHabitEditor} from '../dialogs/habit-editor.js';
import {arranging, onlyOpen, setArranging, shownDays} from '../ui/board-state.js';
import {enableDragReorder} from '../ui/drag-reorder.js';
import {colorValue} from '../ui/icons.js';
import {dayOfMonth, formatLong} from '../util/dates.js';
import {t} from '../util/i18n.js';
import {computed, inject, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch} from '../vue.js';

import {BoardDayCell, BoardHabitLabel, BoardHeadDay} from './board-cells.js';
import {useBoardKeyboard} from './board-keyboard.js';
import {useBoardMeasure} from './board-measure.js';
import {useLongPress} from './board-press.js';
import {MAX_AHEAD_DAYS, useBoardWindow} from './board-window.js';
import {BoardDaySummary, createOrbs, dayProgress} from './day-summary.js';

/** @import {Block, Category, Habit} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */
/** @import {CellKey} from './board-keyboard.js' */

/**
 * A block of the board: the habits of a category, and those of them shown.
 * @typedef {!Block & {visible: !Array<!Habit>}}
 */
let BoardBlockData;

/**
 * The key under which the board provides the handlers of its day cells to
 * the rows (see CellHandlers).
 * @const {symbol}
 */
const CELL_HANDLERS = Symbol('cell handlers');

/**
 * What a day cell does on a click and on a right-click or long press.
 * @typedef {{
 *   tap: function(string, string): void,
 *   contextMenu: function(!MouseEvent, string, string): void,
 * }}
 */
let CellHandlers;

/**
 * Reports whether reordering uses drag and drop (otherwise arrow buttons).
 * @return {boolean}
 */
const byDragging = () => (state.settings?.reorderMode ?? 'drag') === 'drag';

/**
 * How long a habit just changed on the board stays shown while filtering,
 * after the last change, in ms. Without the delay, a row completed by a tap
 * would vanish at once and the next row move under the finger, which a quick
 * second tap would then change.
 */
const LINGER_MS = 2000;

/**
 * The habits just changed on the board, which the filter keeps showing for
 * LINGER_MS (see LINGER_MS). Returns `linger`, which keeps a habit shown, and
 * `lingers`, which reports whether it is. The timers are cleared when the
 * calling component is unmounted.
 * @return {{linger: function(string): void, lingers: function(string):
 *     boolean}}
 */
function useLingering() {
  /** @type {!Map<string, ReturnType<typeof setTimeout>>} */
  const timers = reactive(new Map());
  onUnmounted(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
  return {
    linger: (habitId) => {
      if (!onlyOpen.value) return;
      clearTimeout(timers.get(habitId));
      timers.set(habitId, setTimeout(() => timers.delete(habitId), LINGER_MS));
    },
    lingers: (habitId) => timers.has(habitId),
  };
}

// ---------- components ----------

/**
 * An icon button of the board. `tool` names what it does (data-role, which
 * the keyboard navigation, drag and drop and the Firefox test find it by),
 * `handle` makes it a drag handle, `habit` names the habit it acts on; `icon`
 * names one of `ICONS`.
 */
const BoardToolButton = {
  name: 'BoardToolButton',
  props: {
    tool: {type: String, required: true},
    icon: {type: String, required: true},
    label: {type: String, required: true},
    handle: Boolean,
    habit: {type: String, default: undefined},
    disabled: Boolean,
  },
  // Disabled rather than hidden at a limit.
  template: `
    <button
      v-tooltip="label"
      type="button"
      class="icon-button"
      :class="{'drag-reorder-handle': handle}"
      :data-role="tool"
      :data-habit="habit"
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
  /**
   * @param {{habits: !Array<!Habit>, day: string}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const progress = computed(() => dayProgress(props.habits, props.day));
    const title = computed(() => {
      const {due, done, bonus} = progress.value;
      const text =
          `${formatLong(props.day)}: ${t('{done} of {due} done', {done, due})}`;
      return bonus > 0 ? `${text} · ${t('+{n} bonus', {n: bonus})}` : text;
    });
    // "1/2", and "1/2 +1" with a bonus.
    const count = computed(() => {
      const {due, done, bonus} = progress.value;
      return bonus > 0 ? `${done}/${due} +${bonus}` : `${done}/${due}`;
    });
    return {progress, title, count};
  },
  // No bar if nothing is due on the day.
  template: `
    <div
      v-if="progress.due > 0"
      v-tooltip="title"
      class="board-block-progress"
      :class="{'is-complete': progress.done === progress.due}"
    >
      <span
        class="board-block-progress-track"
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
          class="board-block-progress-seg"
          :class="{'is-done': i <= progress.done}"
        ></span>
      </span>
      <span class="board-block-progress-count">{{ count }}</span>
    </div>`,
};

/**
 * The row of a habit: its label, a cell per day and its reorder controls.
 * `siblings` are the habits of its category, `at` its place among them;
 * `tabDate` is the date of the board's tab stop if it lies in this row. The
 * row renders again only when one of its props changes: a habit changed in
 * the state is a new object.
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
    tabDate: {type: String, default: null},
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!CellHandlers} */
    const cells = inject(CELL_HANDLERS);
    return {
      byDragging,
      tap: cells.tap,
      contextMenu: cells.contextMenu,
      open: (id) => openHabit(id),
      move: (id, delta) => actions.moveHabit(id, delta),
    };
  },
  // The tools are always rendered, to keep the column width; there are none
  // with a single habit.
  template: `
    <div
      class="board-habit-row"
      :data-habit="habit.id"
    >
      <div class="board-habit-row-label">
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
        :tab-index="iso === tabDate ? 0 : -1"
        @click="tap(habit.id, iso)"
        @contextmenu="contextMenu($event, habit.id, iso)"
      />
      <div class="board-habit-row-tools">
        <template v-if="siblings >= 2">
          <board-tool-button
            v-if="byDragging()"
            tool="drag-habit"
            icon="grip"
            :label="t('Move habit')"
            handle
            :habit="habit.id"
          />
          <template v-else>
            <board-tool-button
              tool="move-habit-up"
              icon="chevronUp"
              :label="t('Move habit up')"
              :habit="habit.id"
              :disabled="at === 0"
              @click="move(habit.id, -1)"
            />
            <board-tool-button
              tool="move-habit-down"
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
 * habits of the category, `block.visible` those shown; `tabStop` is the day
 * cell that is the board's tab stop. `labelled` shows the heading; `striped`
 * marks the block by a line in the category's colour instead.
 */
const BoardBlock = {
  name: 'BoardBlock',
  components: {BoardBlockProgress, BoardHabitRow, BoardToolButton},
  props: {
    block: {type: Object, required: true},
    labelled: Boolean,
    striped: Boolean,
    dates: {type: Array, required: true},
    active: {type: String, required: true},
    tabStop: {type: Object, default: null},
  },
  /**
   * @param {{
   *   block: {category: ?Category, habits: !Array<!Habit>, visible:
   *       !Array<!Habit>},
   *   labelled: boolean,
   *   striped: boolean,
   *   dates: !Array<string>,
   *   active: string,
   *   tabStop: ?CellKey,
   * }} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const category = computed(() => props.block.category);
    return {
      state,
      byDragging,
      category,
      // The colour of the line; neutral without one (see board.css).
      stripeStyle: computed(
          () => props.striped && category.value?.color ?
              {'--category-color': colorValue(category.value.color)} :
              null),
      // The place of the category among all, for the arrow buttons.
      at: computed(
          () => state.categories.findIndex((c) => c.id === category.value?.id)),
      /**
       * Returns the date of the tab stop if it lies in the row of `habit`,
       * else null.
       * @param {!Habit} habit
       * @return {?string}
       */
      tabDate: (habit) =>
          props.tabStop?.habit === habit.id ? props.tabStop.date : null,
      openCategory: () => category.value && openCategory(category.value.id),
      /**
       * Moves the category up (-1) or down (+1).
       * @param {number} delta
       */
      move: (delta) =>
          category.value && actions.moveCategory(category.value.id, delta),
    };
  },
  // Uncategorised habits have no category controls and no progress. Renaming
  // and deleting are done in the category view.
  template: `
    <section
      class="board-block"
      :class="{'is-striped': striped}"
      :data-category="category?.id"
      :style="stripeStyle"
    >
      <header
        v-if="labelled"
        class="board-block-head"
      >
        <h2 class="board-block-title">
          <button
            v-if="category"
            type="button"
            class="board-block-link"
            data-role="open-category"
            @click="openCategory"
          >
            <app-icon-badge
              class="habit-icon"
              :icon="category.icon"
              :color="category.color || null"
            />
            <span class="board-block-link-name">{{ category.name }}</span>
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
          class="board-block-tools"
        >
          <board-tool-button
            v-if="byDragging()"
            tool="drag-category"
            icon="grip"
            :label="t('Move category')"
            handle
          />
          <template v-else>
            <board-tool-button
              tool="move-category-up"
              icon="chevronUp"
              :label="t('Move category up')"
              :disabled="at <= 0"
              @click="move(-1)"
            />
            <board-tool-button
              tool="move-category-down"
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
        class="board-block-empty"
      >
        {{ t('No habit in this category yet.') }}
      </p>
      <div
        v-else
        class="board-block-rows"
      >
        <board-habit-row
          v-for="habit in block.visible"
          :key="habit.id"
          :habit="habit"
          :at="block.habits.indexOf(habit)"
          :siblings="block.habits.length"
          :dates="dates"
          :active="active"
          :tab-date="tabDate(habit)"
        />
      </div>
    </section>`,
};

/**
 * Enables drag and drop for both categories and habit rows of `root`; the
 * handle determines which list is reordered. `onStart` is called when a drag
 * starts and `onEnd` when it ends.
 * @param {!HTMLElement} root
 * @param {function(): void} onStart
 * @param {function(): void} onEnd
 * @return {function(): void} disables drag and drop again
 */
function enableDragging(root, onStart, onEnd) {
  /**
   * Returns the drag callbacks of a list that is saved with `save`.
   * @param {function(!Array<string>): *} save
   * @return {{onStart: function(): void, onDrop: function(!Array<string>):
   *     void, onCancel: function(): void}}
   */
  const callbacks = (save) => ({
    onStart,
    onDrop: (ids) => {
      onEnd();
      save(ids);
    },
    onCancel: onEnd,
  });
  const disableCategories = enableDragReorder({
    container: root,
    item: '.board-block[data-category]',
    handle: '[data-role="drag-category"]',
    key: 'category',
    ...callbacks(actions.setCategoryOrder),
  });
  const disableHabits = enableDragReorder({
    container: root,
    item: '.board-habit-row',
    handle: '[data-role="drag-habit"]',
    key: 'habit',
    ...callbacks(actions.setHabitOrder),
  });
  return () => {
    disableCategories();
    disableHabits();
  };
}

/**
 * The overview: the day header, the day summary and a block per category,
 * followed by the empty states and the button back to today. Rendered inside
 * <main id="board-view">, whose width it measures.
 */
export const TheBoardView = {
  name: 'TheBoardView',
  components: {BoardBlock, BoardDaySummary, BoardHeadDay, BoardToolButton},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!Ref<?HTMLElement>} */
    const boardEl = ref(null);
    const all = computed(() => boardBlocks());
    const everyHabit = computed(() => all.value.flatMap((b) => b.habits));
    const board = useBoardWindow(shownDays);
    const {activeDay, dates} = board;
    useBoardMeasure(boardEl, () => all.value.length > 0);
    const {linger, lingers} = useLingering();

    /**
     * Reports whether a habit passes the filter: with it, only habits due on
     * the active day (as counted by the day summary) and not yet complete,
     * and those just changed on the board (see useLingering).
     * @param {!Habit} habit
     * @return {boolean}
     */
    const matches = (habit) => {
      if (!onlyOpen.value || lingers(habit.id)) return true;
      const day = activeDay.value;
      return !habit.archivedAt && habitHelpers.isDue(habit, day) &&
          !habitHelpers.isDone(habit, day);
    };

    // Whether a drag is in progress. The board keeps the blocks it showed
    // when the drag started, as the dragged element must stay where
    // drag-reorder.js put it.
    const dragging = ref(false);
    /** @type {!Array<!BoardBlockData>} */
    let frozen = [];
    // A single uncategorised block, as the board shows when it is not
    // grouped, has no heading.
    const grouped =
        computed(() => all.value.length > 1 || all.value[0]?.category !== null);
    // Compact categories have a line in their colour instead of a heading,
    // except while arranging, where the heading tells which card is moved
    // and carries its handles.
    const striped = computed(
        () => grouped.value && state.settings.compactCategories === true &&
            !arranging.value);
    // Blocks keep all habits for the progress bar, plus the filtered habits
    // for the rows. Without a heading, an empty block would not tell which
    // category it is, so it is left out.
    const blocks = computed(() => {
      if (dragging.value) return frozen;
      const keepEmpty = !onlyOpen.value && !striped.value;
      return all.value.map((b) => ({...b, visible: b.habits.filter(matches)}))
          .filter((b) => keepEmpty || b.visible.length > 0);
    });

    const keyboard = useBoardKeyboard({
      boardEl,
      rows: computed(() => blocks.value.flatMap((b) => b.visible)),
      dates,
      activeDay,
      page: board.page,
    });
    const press = useLongPress(boardEl, openDayEditor);
    provide(CELL_HANDLERS, /** @type {!CellHandlers} */ ({
              /**
               * Handles a tap on a day cell, unless it ends a long press.
               * @param {string} habitId
               * @param {string} iso
               */
              tap: (habitId, iso) => {
                if (!press.takesClick()) return;
                linger(habitId);
                actions.tapEntry(habitId, iso);
              },
              contextMenu: press.onContextMenu,
            }));

    // Habits newly completed on the active day send orbs into the ring. They
    // are found before the board is updated, while it shows their cells.
    const orbs = createOrbs();
    watch([everyHabit, activeDay], ([habits, day]) => {
      const flights = orbs.newlyDone(habits, day, boardEl.value);
      if (flights.length > 0) nextTick(() => flights.forEach(orbs.launch));
    }, {immediate: true, flush: 'pre'});

    /** @type {function(): void} */
    let disableDragging = () => {};
    onMounted(() => {
      if (!boardEl.value) return;
      disableDragging = enableDragging(
          boardEl.value,
          () => {
            frozen = blocks.value;
            dragging.value = true;
          },
          () => {
            dragging.value = false;
          });
    });
    onUnmounted(() => {
      disableDragging();
      orbs.dispose();
    });

    // Column of the active day for the band; -1 if not visible.
    const activeColumn = computed(() => dates.value.indexOf(activeDay.value));

    return {
      boardEl,
      all,
      everyHabit,
      blocks,
      dates,
      active: activeDay,
      activeColumn,
      orbs,
      cellStop: keyboard.cellStop,
      headStop: keyboard.headStop,
      // The band's column, if the active day is shown.
      bandStyle: computed(
          () => activeColumn.value >= 0 ?
              {'--today-col': String(activeColumn.value)} :
              null),
      // The filter leaves no block although there are habits.
      noMatch: computed(
          () => onlyOpen.value && all.value.length > 0 &&
              blocks.value.length === 0),
      labelled: computed(() => grouped.value && !striped.value),
      striped,
      monthLabels: board.months,
      offset: board.offset,
      selectedDay: board.selectedDay,
      maxBack: board.maxBack,
      MAX_AHEAD_DAYS,
      page: board.page,
      selectDay: board.selectDay,
      backToToday: board.backToToday,
      arranging,
      // Arranging is switched on in the settings; the overview offers to end
      // it right there.
      endArranging: () => setArranging(false),
      dayOfMonth,
      onBoardKeydown: keyboard.onKeydown,
      onBoardFocusin: keyboard.onFocusin,
      createHabit: () => openHabitEditor(null),
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
      class="board-view-grid"
      :class="{'has-today': activeColumn >= 0}"
      :style="bandStyle"
      :hidden="all.length === 0"
      @keydown="onBoardKeydown"
      @focusin="onBoardFocusin"
    >
      <template v-if="dates.length > 0">
        <div class="board-view-day-header">
          <!-- Backdrop behind the sticky header. An element, as it needs a
               clipped layer of its own over a background image. -->
          <div
            class="board-view-day-header-backdrop"
            aria-hidden="true"
          ></div>
          <!-- Paging, in the date row above the habit names. Back to today is
               the floating button. -->
          <div class="board-view-day-nav">
            <board-tool-button
              tool="page-older"
              icon="chevronLeft"
              :label="t('Earlier days')"
              :disabled="offset >= maxBack"
              @click="page(1)"
            />
            <board-tool-button
              tool="page-newer"
              icon="chevronRight"
              :label="t('Later days')"
              :disabled="offset <= -MAX_AHEAD_DAYS"
              @click="page(-1)"
            />
          </div>
          <div
            v-for="month in monthLabels"
            :key="month.start"
            v-tooltip="month.title"
            class="board-view-month-label"
            :class="{
              'has-divider': month.start > 0,
              'is-narrow': month.narrow,
            }"
            :style="{'grid-column': month.column}"
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
            :tab-index="iso === headStop ? 0 : -1"
            :class="{'is-month-start': i > 0 && dayOfMonth(iso) === 1}"
            :style="{'grid-column': String(i + 2)}"
            @click="selectDay(iso)"
          />
        </div>
        <board-day-summary
          :habits="everyHabit"
          :day="active"
          :orbs="orbs"
          @open="openDays"
        />
        <board-block
          v-for="block in blocks"
          :key="block.category?.id ?? ''"
          :block="block"
          :labelled="labelled"
          :striped="striped"
          :dates="dates"
          :active="active"
          :tab-stop="cellStop"
        />
      </template>
    </div>
    <p
      class="empty"
      :hidden="!noMatch"
    >
      {{ t('Nothing left open on this day.') }}
    </p>
    <div
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
    <div class="board-view-pills">
      <button
        type="button"
        class="button board-view-pill"
        :hidden="!arranging"
        @click="endArranging"
      >
        <app-icon name="check"/><span>{{ t('Finish arranging') }}</span>
      </button>
      <button
        type="button"
        class="button board-view-pill"
        :hidden="offset === 0 && selectedDay === null"
        @click="backToToday"
      >
        <app-icon name="toToday"/><span>{{ t('Back to today') }}</span>
      </button>
    </div>`,
};
