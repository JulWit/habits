/**
 * @fileoverview The building blocks of a habit row: a day in the header, the
 * label of a habit and the cell of a day. The board and the style guide use
 * them.
 */

import * as habitHelpers from '../data/habit-helpers.js';
import {state} from '../data/state.js';
import {colorValue} from '../ui/icons.js';
import {dayOfMonth, formatLong, formatRelative, WEEKDAY_SHORT, weekdayIndex} from '../util/dates.js';
import {t} from '../util/i18n.js';
import {computed} from '../vue.js';

/** @import {Entry, Habit} from '../data/state.js' */

/** The check mark of a completed check habit's cell, as SVG markup. */
const CHECK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path
    d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentcolor" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * A day in the header. `active` is the highlighted day (is-today), by default
 * today; the actual today keeps is-current. With `selectable`, the day is a
 * button that makes its day the active one; `tabIndex` makes it the tab stop
 * of the header (0) or not (-1).
 */
export const BoardHeadDay = {
  name: 'BoardHeadDay',
  props: {
    iso: {type: String, required: true},
    active: {type: String, default: undefined},
    selectable: Boolean,
    tabIndex: {type: Number, default: undefined},
  },
  /**
   * @param {{iso: string, active?: string, selectable: boolean,
   *     tabIndex?: number}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const isActive =
        computed(() => props.iso === (props.active ?? state.today));
    return {
      isActive,
      state,
      // The full date as tooltip, since the cell only shows the day of the
      // month.
      title: computed(() => formatLong(props.iso)),
      weekday: computed(() => WEEKDAY_SHORT[weekdayIndex(props.iso)]),
      day: computed(() => dayOfMonth(props.iso)),
    };
  },
  template: `
    <button
      v-if="selectable"
      v-tooltip="title"
      type="button"
      class="board-head-day is-selectable"
      :class="{'is-today': isActive, 'is-current': iso === state.today}"
      data-role="select-day"
      :data-date="iso"
      :tabindex="tabIndex"
      :aria-pressed="String(isActive)"
    >
      <span class="board-head-day-weekday">{{ weekday }}</span>
      <span class="board-head-day-date">{{ day }}</span>
    </button>
    <div
      v-else
      v-tooltip="title"
      class="board-head-day"
      :class="{'is-today': isActive, 'is-current': iso === state.today}"
    >
      <span class="board-head-day-weekday">{{ weekday }}</span>
      <span class="board-head-day-date">{{ day }}</span>
    </div>`,
};

/**
 * The label of a row: icon, name, streak and target. A button; its user
 * opens the habit on click.
 */
export const BoardHabitLabel = {
  name: 'BoardHabitLabel',
  props: {habit: {type: Object, required: true}},
  /**
   * @param {{habit: !Habit}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const described = computed(() => habitHelpers.describeHabit(props.habit));
    // Tooltip with the full text, including the streak in words.
    const title = computed(() => {
      const meta = [
        habitHelpers.describeStreak(props.habit),
        described.value,
      ].filter(Boolean).join(' · ');
      return `${props.habit.name}\n${meta}`;
    });
    return {
      described,
      title,
      // For the name, if it is shown in the habit's colour.
      style: computed(() => ({'--habit-color': colorValue(props.habit.color)})),
    };
  },
  // The streak is always shown, even when it is 0.
  template: `
    <button
      v-tooltip="title"
      type="button"
      class="board-habit-label"
      :class="{'is-archived': habit.archivedAt}"
      data-role="open"
      :data-habit="habit.id"
      :style="style"
    >
      <app-icon-badge
        class="habit-icon"
        :icon="habit.icon"
        :color="habit.color"
      />
      <span class="board-habit-label-text">
        <span class="habit-name">{{ habit.name }}</span>
        <span class="habit-meta">
          <span class="board-habit-label-streak">
            <app-icon name="streak"/>{{ habit.stats?.currentStreak ?? 0 }}
          </span>
          <template v-if="described"> · {{ described }}</template>
        </span>
      </span>
    </button>`,
};

/**
 * The cell of a day in a row; `active` is the day of the band. The cell shows
 * the server's status of the day (habit-helpers.js); a write still waiting
 * for the server is shown with its value only. `tabIndex` makes it the tab
 * stop of the board (0) or not (-1). Its user handles clicks.
 */
export const BoardDayCell = {
  name: 'BoardDayCell',
  props: {
    habit: {type: Object, required: true},
    iso: {type: String, required: true},
    active: {type: String, default: undefined},
    tabIndex: {type: Number, default: undefined},
  },
  /**
   * @param {{habit: !Habit, iso: string, active?: string,
   *     tabIndex?: number}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    return {
      cell: computed(() => describeCell(props.habit, props.iso)),
      isActive: computed(() => props.iso === (props.active ?? state.today)),
      color: computed(() => colorValue(props.habit.color)),
      CHECK_SVG,
    };
  },
  // The label is also the tooltip, so the state is not told by the mark's
  // colour and pattern alone (e.g. hatched: planned ahead).
  template: `
    <button
      v-tooltip="cell.label"
      type="button"
      class="board-day-cell"
      :class="{'is-today': isActive}"
      data-role="cell"
      :data-habit="habit.id"
      :data-date="iso"
      :tabindex="tabIndex"
      :style="{'--habit-color': color}"
      :aria-label="cell.label"
      :disabled="cell.disabled"
    >
      <span
        class="board-day-cell-mark"
        :class="cell.mark"
        :data-streak="cell.streak || undefined"
        :style="{'--habit-color': color, '--p': String(cell.progress)}"
      >
        <app-icon
          v-if="cell.skipped"
          name="skip"
        />
        <app-icon
          v-else-if="cell.check"
          :svg="CHECK_SVG"
        />
        <span
          v-else-if="cell.number"
          class="board-day-cell-value"
          :class="{'is-long': cell.number.length >= 4}"
        >
          {{ cell.number }}
        </span>
      </span>
    </button>`,
};

/**
 * What a day cell shows.
 * @typedef {{
 *   label: string,
 *   disabled: boolean,
 *   mark: !Array<(string|boolean)>,
 *   progress: number,
 *   streak: number,
 *   skipped: boolean,
 *   check: boolean,
 *   number: string,
 * }}
 */
let CellView;

/**
 * Describes the cell of `habit` on `iso`: its label and the mark inside it
 * (ring, check, value or skip icon).
 * @param {!Habit} habit
 * @param {string} iso
 * @return {!CellView}
 */
function describeCell(habit, iso) {
  const entry = habitHelpers.entryOn(habit, iso);
  const {value, skipped} = entry;
  const pending = habitHelpers.isPending(habit, iso);
  const done = !pending && habitHelpers.isDone(habit, iso);
  const scheduled = habitHelpers.isScheduled(habit, iso);
  // Length of the run this day belongs to; 0 for future days.
  const streakDays = habitHelpers.streakDaysOn(habit, iso);
  const flags = {pending, done, scheduled, streakDays};

  const mark = [
    // Unscheduled days without a value are drawn as off, and so are the days
    // before the habit began, which are not counted either; a tap can still
    // record a value on them.
    (!scheduled && value === 0 || habitHelpers.isBeforeStart(habit, iso)) &&
        'is-off',
    // Future days are dimmed.
    iso > state.today && 'is-future',
    // Days no longer needed in their week or month are dimmed too.
    habitHelpers.isFree(habit, iso) && 'is-free',
    pending && 'is-pending',
  ];
  const view = {
    label: cellLabel(habit, iso, entry, flags),
    disabled: isCellDisabled(habit, iso),
    mark,
    progress: habitHelpers.progress(habit, iso, value),
    streak: 0,
    skipped,
    check: false,
    number: '',
  };

  if (skipped) {
    mark.push('is-skipped');
  } else if (done) {
    mark.push('is-complete');
    // Longer runs are drawn with a stronger streak colour. Level 0 changes
    // nothing.
    view.streak = habitHelpers.streakLevel(streakDays);
    // A kept limit without a value is ticked like a check.
    if (habit.kind === 'check' || value === 0) {
      view.check = true;
    } else {
      view.number = habitHelpers.cellValue(habit, value);
    }
  } else if (pending && habit.kind === 'check' && value > 0) {
    view.check = true;
  } else if (value > 0) {
    // A value over the limit is marked as such.
    if (!pending && habitHelpers.isOver(habit, iso)) mark.push('is-over');
    view.number = habitHelpers.cellValue(habit, value);
  }
  return view;
}

/**
 * Reports whether the cell of `habit` on `iso` is disabled: an unscheduled day
 * is, unless it holds something to clear.
 * @param {!Habit} habit
 * @param {string} iso
 * @return {boolean}
 */
export function isCellDisabled(habit, iso) {
  return !habitHelpers.isScheduled(habit, iso) &&
      habitHelpers.isEmpty(habitHelpers.entryOn(habit, iso));
}

/**
 * Returns the label of a day cell for screen readers and the tooltip.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {!Entry} entry
 * @param {{pending: boolean, done: boolean, scheduled: boolean, streakDays:
 *     number}} flags
 * @return {string}
 */
function cellLabel(habit, iso, entry, {pending, done, scheduled, streakDays}) {
  const when = formatRelative(iso, state.today);
  const status = pending ? pendingStatus(habit, entry) :
                           cellStatus(habit, iso, entry, done, scheduled);
  // Announce the streak length on days that are part of a run.
  const run = done && iso <= state.today && streakDays > 0 ?
      t(', day {n} of a streak', {n: streakDays}) :
      '';
  return `${habit.name}, ${when}: ${status}${run}`;
}

/**
 * Describes a write that waits for the server.
 * @param {!Habit} habit
 * @param {!Entry} entry
 * @return {string}
 */
function pendingStatus(habit, {value, skipped}) {
  if (skipped) return t('skipped');
  if (value > 0) {
    return t(
        '{value}, not saved yet',
        {value: habitHelpers.formatValue(habit, value)});
  }
  return t('cleared, not saved yet');
}

/**
 * Describes a day's entry. Future days are announced as planned.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {!Entry} entry
 * @param {boolean} done
 * @param {boolean} scheduled
 * @return {string}
 */
function cellStatus(habit, iso, {value, skipped}, done, scheduled) {
  if (skipped) return t('skipped');
  if (habitHelpers.isBeforeStart(habit, iso)) {
    return t('before the habit began');
  }
  if (habitHelpers.isLimit(habit, iso)) {
    return limitStatus(habit, iso, value, done, scheduled);
  }
  const ahead = iso > state.today;
  const vars = {
    value: habitHelpers.formatValue(habit, value),
    target: habitHelpers.formatValue(habit, habitHelpers.target(habit, iso)),
  };

  if (done) {
    if (habitHelpers.isBonus(habit, iso)) {
      return ahead ? t('planned as a bonus') : t('done as a bonus');
    }
    if (!ahead) return t('done');
    return habit.kind === 'check' ? t('planned') : t('{value} planned', vars);
  }
  if (value > 0) {
    return ahead ? t('{value} of {target} planned', vars) :
                   t('{value} of {target}', vars);
  }
  if (habitHelpers.isFree(habit, iso)) {
    return t('done often enough, a bonus is possible');
  }
  return scheduled ? t('open') : t('not scheduled');
}

/**
 * Describes a day of a limit: within it, over it, or planned.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {number} value
 * @param {boolean} done
 * @param {boolean} scheduled
 * @return {string}
 */
function limitStatus(habit, iso, value, done, scheduled) {
  const vars = {
    value: habitHelpers.formatValue(habit, value),
    target: habitHelpers.formatValue(habit, habitHelpers.target(habit, iso)),
  };
  if (!scheduled && value === 0) return t('not scheduled');
  if (iso > state.today) {
    return value > 0 ? t('{value} planned', vars) : t('still ahead');
  }
  if (!done) {
    return value > 0 ? t('{value}, over the limit of {target}', vars) :
                       t('open');
  }
  return value > 0 ? t('{value}, within the limit of {target}', vars) :
                     t('nothing, within the limit');
}
