// The building blocks of a habit row: a day in the header, the label of a
// habit and the cell of a day. The board and the style guide use them.

import {dayOfMonth, formatLong, formatRelative, WEEKDAY_SHORT, weekdayIndex} from './dates.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue} from './icons.js';
import {state} from './state.js';
import {computed} from './vue.js';

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor"' +
    ' stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * A day in the header. `active` is the highlighted day (is-today), by default
 * today; the actual today keeps is-current. With `selectable`, the day is a
 * button that makes its day the active one.
 */
export const HeadDay = {
  name: 'HeadDay',
  props: {
    iso: {type: String, required: true},
    active: String,
    selectable: Boolean,
  },
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
    <button v-if="selectable" type="button"
            class="grid-head is-selectable"
            :class="{'is-today': isActive, 'is-current': iso === state.today}"
            :title="title" data-role="select-day" :data-date="iso"
            :aria-pressed="String(isActive)">
      <span class="dow">{{ weekday }}</span><span class="dom">{{ day }}</span>
    </button>
    <div v-else class="grid-head"
         :class="{'is-today': isActive, 'is-current': iso === state.today}"
         :title="title">
      <span class="dow">{{ weekday }}</span><span class="dom">{{ day }}</span>
    </div>`,
};

/**
 * The label of a row: icon, name, streak and target. A button; its user
 * opens the habit on click.
 */
export const HabitLabel = {
  name: 'HabitLabel',
  props: {habit: {type: Object, required: true}},
  setup(props) {
    const described = computed(() => habitHelpers.describeHabit(props.habit));
    // Tooltip with the full text, including the streak in words.
    const title = computed(() => {
      const meta = [
        habitHelpers.describeStreak(props.habit), described.value
      ].filter(Boolean).join(' · ');
      return `${props.habit.name}\n${meta}`;
    });
    return {described, title};
  },
  // The streak is always shown, even when it is 0.
  template: `
    <button type="button" class="habit-main"
            :class="{'is-archived': habit.archivedAt}"
            data-role="open" :data-habit="habit.id" :title="title">
      <icon-badge class="habit-icon" :icon="habit.icon" :color="habit.color"/>
      <span class="habit-text">
        <span class="habit-name">{{ habit.name }}</span>
        <span class="habit-meta"><span class="habit-streak"><app-icon name="streak"/>{{ habit.stats?.currentStreak ?? 0 }}</span><template v-if="described"> · {{ described }}</template></span>
      </span>
    </button>`,
};

/**
 * The cell of a day in a row; `active` is the day of the band. The cell shows
 * the server's status of the day (habit-helpers.js); a write still waiting
 * for the server is shown with its value only. Its user handles clicks.
 */
export const DayCell = {
  name: 'DayCell',
  props: {
    habit: {type: Object, required: true},
    iso: {type: String, required: true},
    active: String,
  },
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
    <button type="button" class="cell" :class="{'is-today': isActive}"
            data-role="cell" :data-habit="habit.id" :data-date="iso"
            :style="{'--habit-color': color}"
            :aria-label="cell.label" :title="cell.label"
            :disabled="cell.disabled">
      <span class="mark" :class="cell.mark" :data-streak="cell.streak || undefined"
            :style="{'--habit-color': color, '--p': String(cell.progress)}">
        <app-icon v-if="cell.skipped" name="skip"/>
        <app-icon v-else-if="cell.check" :svg="CHECK_SVG"/>
        <span v-else-if="cell.number" class="mark-value"
              :class="{'is-long': cell.number.length >= 4}">{{ cell.number }}</span>
      </span>
    </button>`,
};

/**
 * What a day cell shows.
 * @typedef {{
 *   label: string,
 *   disabled: boolean,
 *   mark: !Array<string>,
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
    // Unscheduled days without a value are drawn as off.
    !scheduled && value === 0 && 'is-off',
    // Future days are dimmed.
    iso > state.today && 'is-future',
    pending && 'is-pending',
  ];
  const view = {
    label: cellLabel(habit, iso, entry, flags),
    // Unscheduled days are disabled unless they hold something to clear.
    disabled: !scheduled && habitHelpers.isEmpty(entry),
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
  if (habitHelpers.isLimit(habit, iso)) {
    return limitStatus(habit, iso, value, done, scheduled);
  }
  const ahead = iso > state.today;
  const vars = {
    value: habitHelpers.formatValue(habit, value),
    target: habitHelpers.formatValue(habit, habitHelpers.target(habit, iso)),
  };

  if (done) {
    if (!ahead) return t('done');
    return habit.kind === 'check' ? t('planned') : t('{value} planned', vars);
  }
  if (value > 0) {
    return ahead ? t('{value} of {target} planned', vars) :
                   t('{value} of {target}', vars);
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
