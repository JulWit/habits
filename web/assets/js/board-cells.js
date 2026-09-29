// Rendering of a habit row: label, day header and day cells.

import {dayOfMonth, formatLong, formatRelative, WEEKDAY_SHORT, weekdayIndex} from './dates.js';
import {el, markup} from './dom.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue, habitIconBadge, icons} from './icons.js';
import {state} from './state.js';

const CHECK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Builds a day in the header. `active` is the highlighted day (is-today), by
 * default today; the actual today keeps is-current. With `selectable`, the
 * cell is a button that makes its day the active one.
 */
export function dayCell(iso, {active = state.today, selectable = false} = {}) {
  return el(
      selectable ? 'button' : 'div',
      {
        class: [
          'grid-head',
          iso === active && 'is-today',
          iso === state.today && 'is-current',
          selectable && 'is-selectable',
        ],
        // The full date as tooltip, since the cell only shows the day of the
        // month.
        title: formatLong(iso),
        ...(selectable && {
          type: 'button',
          data: {role: 'select-day', date: iso},
          'aria-pressed': String(iso === active),
        }),
      },
      el('span', {class: 'dow'}, WEEKDAY_SHORT[weekdayIndex(iso)]),
      el('span', {class: 'dom'}, dayOfMonth(iso)),
  );
}

export function habitLabel(habit) {
  const described = habitHelpers.describeHabit(habit);
  // The streak is always shown, even when it is 0.
  const streak = habit.stats?.currentStreak ?? 0;
  // Tooltip with the full text, including the streak in words.
  const metaText = [
    habitHelpers.describeStreak(habit),
    described,
  ].filter(Boolean).join(' · ');

  return el(
      'button',
      {
        type: 'button',
        class: ['habit-main', habit.archivedAt ? 'is-archived' : ''],
        data: {habit: habit.id, role: 'open'},
        title: `${habit.name}\n${metaText}`,
      },
      habitIconBadge(habit),
      el(
          'span',
          {class: 'habit-text'},
          el('span', {class: 'habit-name'}, habit.name),
          el('span', {class: 'habit-meta'}, streakBadge(streak),
             described && ` · ${described}`),
          ),
  );
}

function streakBadge(count) {
  return el('span', {class: 'habit-streak'}, markup(icons.streak), count);
}

/**
 * Builds a day cell of a row; `active` is the day of the band. The cell shows
 * the server's status of the day (habit-helpers.js); a write still waiting for
 * the server is shown with its value only.
 */
export function dayEntry(habit, iso, active = state.today) {
  const entry = habitHelpers.entryOn(habit, iso);
  const pending = habitHelpers.isPending(habit, iso);
  const done = !pending && habitHelpers.isDone(habit, iso);
  const scheduled = habitHelpers.isScheduled(habit, iso);
  // Length of the run this day belongs to; 0 for future days.
  const streakDays = habitHelpers.streakDaysOn(habit, iso);
  const label =
      cellLabel(habit, iso, entry, {pending, done, scheduled, streakDays});

  return el(
      'button', {
        type: 'button',
        class: ['cell', iso === active && 'is-today'],
        data: {habit: habit.id, date: iso, role: 'cell'},
        style: {'--habit-color': colorValue(habit.color)},
        'aria-label': label,
        // The same text as a tooltip, so the state is not told by the mark's
        // colour and pattern alone (e.g. hatched: planned ahead).
        title: label,
        // Unscheduled days are disabled unless they hold something to clear.
        disabled: !scheduled && habitHelpers.isEmpty(entry),
      },
      dayMark(habit, iso, entry, {pending, done, scheduled, streakDays}));
}

/** Builds the mark inside a day cell: ring, check, value or skip icon. */
function dayMark(habit, iso, entry, {pending, done, scheduled, streakDays}) {
  const {value} = entry;
  const mark = el('span', {
    class: [
      'mark',
      // Unscheduled days without a value are drawn as off.
      !scheduled && value === 0 && 'is-off',
      // Future days are dimmed.
      iso > state.today && 'is-future',
      pending && 'is-pending',
    ],
    style: {
      '--habit-color': colorValue(habit.color),
      '--p': String(habitHelpers.progress(habit, iso, value)),
    },
  });

  if (entry.skipped) {
    mark.classList.add('is-skipped');
    mark.append(markup(icons.skip));
  } else if (done) {
    mark.classList.add('is-complete');
    // Longer runs are drawn with a stronger streak colour. Level 0 changes
    // nothing.
    const level = habitHelpers.streakLevel(streakDays);
    if (level > 0) mark.dataset.streak = String(level);
    // A kept limit without a value is ticked like a check.
    if (habit.kind === 'check' || value === 0) {
      mark.append(markup(CHECK_SVG));
    } else {
      mark.append(numberLabel(habitHelpers.cellValue(habit, value)));
    }
  } else if (pending && habit.kind === 'check' && value > 0) {
    mark.append(markup(CHECK_SVG));
  } else if (value > 0) {
    // A value over the limit is marked as such.
    if (!pending && habitHelpers.isOver(habit, iso)) {
      mark.classList.add('is-over');
    }
    mark.append(numberLabel(habitHelpers.cellValue(habit, value)));
  }
  return mark;
}

// Wraps the number in an element so it can be layered above the ring's
// ::after with z-index.
function numberLabel(text) {
  // Tighter spacing for four characters ("12,5", "1,5k"); cellValue keeps
  // them short enough for the mark.
  return el(
      'span', {class: ['mark-value', text.length >= 4 && 'is-long']}, text);
}

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

/** Describes a write that waits for the server. */
function pendingStatus(habit, {value, skipped}) {
  if (skipped) return t('skipped');
  if (value > 0) {
    return t(
        '{value}, not saved yet',
        {value: habitHelpers.formatValue(habit, value)});
  }
  return t('cleared, not saved yet');
}

/** Describes a day's entry. Future days are announced as planned. */
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

/** Describes a day of a limit: within it, over it, or planned. */
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
