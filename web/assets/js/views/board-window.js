/**
 * @fileoverview The days the overview shows: a window of day columns that ends
 * on today or is paged into the past or the future, the active day chosen in
 * the day header, and the month labels above the days.
 */

import {extendHistory} from '../data/loader.js';
import {state} from '../data/state.js';
import {addDays, daysBetween, MONTH_LONG, MONTH_SHORT, monthIndex, weekdayIndex, yearOf} from '../util/dates.js';
import {computed, nextTick, ref} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/**
 * Number of additional days loaded when paging back beyond the loaded entries.
 */
const PREFETCH_DAYS = 180;

/** Maximum number of days the board can be paged into the future. */
export const MAX_AHEAD_DAYS = 365;

/**
 * Returns the first day of a window of `count` columns ending `back` days
 * before `today`. With week alignment (`alignWeeks` and at least seven
 * columns), the start moves forward to the next Monday, so the current week
 * is shown in full.
 * @param {string} today
 * @param {number} count
 * @param {number} back
 * @param {boolean} alignWeeks
 * @return {string}
 */
export function windowStart(today, count, back, alignWeeks) {
  const plain = addDays(today, -back - (count - 1));
  if (!alignWeeks || count < 7) return plain;
  const weekday = weekdayIndex(plain);
  return weekday === 0 ? plain : addDays(plain, 7 - weekday);
}

/**
 * Returns the paging step in days: whole weeks when aligned.
 * @param {number} count
 * @param {boolean} alignWeeks
 * @return {number}
 */
export function pageStep(count, alignWeeks) {
  return alignWeeks && count >= 7 ? Math.floor(count / 7) * 7 : count;
}

/**
 * A month label of the day header, spanning its columns. `column` is its
 * CSS grid-column; column 1 holds the habit names. `narrow` marks a month of
 * one or two columns, whose label needs all of their width.
 * @typedef {{start: number, column: string, name: string, title: string,
 *     narrow: boolean}}
 */
export let MonthLabel;

/**
 * Returns a label per month of `dates`, spanning its columns. The year is
 * named for months outside the year of `today`.
 * @param {!Array<string>} dates
 * @param {string} today
 * @return {!Array<!MonthLabel>}
 */
export function monthLabels(dates, today) {
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
    const suffix = year === yearOf(today) ? '' : ` ${year}`;
    // Short month name if the span is too narrow.
    const name = (span >= 5 ? MONTH_LONG[month] : MONTH_SHORT[month]) + suffix;
    out.push({
      start,
      column: `${start + 2} / span ${span}`,
      name,
      title: `${MONTH_LONG[month]} ${year}`,
      narrow: span <= 2,
    });
    start = i;
  }
  return out;
}

/**
 * The window of the overview (see useBoardWindow).
 * @typedef {{
 *   offset: !Ref<number>,
 *   selectedDay: !Ref<?string>,
 *   activeDay: !Ref<string>,
 *   dates: !Ref<!Array<string>>,
 *   months: !Ref<!Array<!MonthLabel>>,
 *   maxBack: !Ref<number>,
 *   page: function(number): !Promise<void>,
 *   selectDay: function(string): void,
 *   backToToday: function(): !Promise<void>,
 * }}
 */
export let BoardWindow;

/**
 * Returns the window of `days` columns the overview shows: `offset` days
 * before today (negative for the future), anchored at its right edge, and the
 * active day, the selected one or today. Marker, band and day summary refer
 * to the active day; with nothing selected it follows a change of date.
 * @param {!Ref<number>} days
 * @return {!BoardWindow}
 */
export function useBoardWindow(days) {
  const offset = ref(0);
  /** @type {!Ref<?string>} */
  const selectedDay = ref(null);
  /**
   * The offset asked for last, which may still be loading; paging again
   * continues from there.
   */
  let requested = 0;

  /**
   * Reports whether the columns are aligned to calendar weeks.
   * @return {boolean}
   */
  const alignWeeks = () => state.settings?.alignWeeks ?? false;

  // The largest offset whose window starts no earlier than earliestEntry.
  const maxBack = computed(() => {
    if (!state.earliestEntry) return Infinity;
    return Math.max(
        0, daysBetween(state.earliestEntry, state.today) - (days.value - 1));
  });

  // Dates of the columns, oldest first.
  const dates = computed(() => {
    if (days.value === 0) return [];
    const start =
        windowStart(state.today, days.value, offset.value, alignWeeks());
    return Array.from({length: days.value}, (_, i) => addDays(start, i));
  });

  /**
   * Moves the window to `next` days before today, clamped to the allowed
   * range. Loads missing entries first. Resolves once the board shows the
   * window, or once a newer request has taken its place.
   * @param {number} next
   * @return {!Promise<void>}
   */
  const showWindow = async (next) => {
    const wanted = Math.min(maxBack.value, Math.max(-MAX_AHEAD_DAYS, next));
    requested = wanted;
    if (wanted === offset.value) return;

    const start = windowStart(state.today, days.value, wanted, alignWeeks());
    // ISO dates compare correctly as strings.
    if (state.entriesFrom && start < state.entriesFrom) {
      await extendHistory(addDays(start, -PREFETCH_DAYS));
    }
    if (requested !== wanted) return;
    offset.value = wanted;
    await nextTick();
  };

  return {
    offset,
    selectedDay,
    activeDay: computed(() => selectedDay.value ?? state.today),
    dates,
    months: computed(() => monthLabels(dates.value, state.today)),
    maxBack,
    /**
     * Pages the window by one step into the past (1) or the future (-1).
     * @param {number} direction
     * @return {!Promise<void>}
     */
    page: (direction) =>
        showWindow(requested + direction * pageStep(days.value, alignWeeks())),
    /**
     * Makes `iso` the active day; today resets the selection.
     * @param {string} iso
     */
    selectDay: (iso) => {
      selectedDay.value = iso === state.today ? null : iso;
    },
    /**
     * Returns to today: the window and the active day.
     * @return {!Promise<void>}
     */
    backToToday: () => {
      selectedDay.value = null;
      return showWindow(0);
    },
  };
}
