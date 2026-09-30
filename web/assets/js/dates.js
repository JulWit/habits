// Date helpers. Dates are ISO strings ("2026-09-13"); arithmetic is done in
// UTC.

import {lang, t, userTimeZone} from './i18n.js';

const DAY_MS = 86400000;

/**
 * Returns the UTC timestamp of the start of a day.
 * @param {string} iso a date as YYYY-MM-DD
 * @return {number}
 */
export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Returns the ISO date of a UTC timestamp.
 * @param {number} ms
 * @return {string}
 */
export function fromUTC(ms) {
  const d = new Date(ms);
  /**
   * Returns `n` with at least two digits.
   * @param {number} n
   * @return {string}
   */
  const pad = (n) => String(n).padStart(2, '0');
  const month = pad(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${month}-${pad(d.getUTCDate())}`;
}

/**
 * Returns the date `n` days after `iso`; `n` may be negative.
 * @param {string} iso
 * @param {number} n
 * @return {string}
 */
export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

/**
 * Returns the number of days from `from` to `to`, negative if `to` is earlier.
 * @param {string} from
 * @param {string} to
 * @return {number}
 */
export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/**
 * Returns the weekday index: Monday = 0 … Sunday = 6.
 * @param {string} iso
 * @return {number}
 */
export function weekdayIndex(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

/**
 * Returns the Monday of the week of `iso`.
 * @param {string} iso
 * @return {string}
 */
export function startOfWeek(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

// Weekday and month names per language, short enough for a day column.
const NAMES = {
  en: {
    weekdayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weekdayLong: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    monthShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    monthLong: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
  de: {
    weekdayShort: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    weekdayLong: [
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
      'Sonntag',
    ],
    monthShort: [
      'Jan',
      'Feb',
      'Mär',
      'Apr',
      'Mai',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Okt',
      'Nov',
      'Dez',
    ],
    monthLong: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
  },
}[lang];

export const WEEKDAY_SHORT = NAMES.weekdayShort;
export const WEEKDAY_LONG = NAMES.weekdayLong;
export const MONTH_SHORT = NAMES.monthShort;
export const MONTH_LONG = NAMES.monthLong;

/**
 * Returns the day of the month, 1 to 31.
 * @param {string} iso
 * @return {number}
 */
export function dayOfMonth(iso) {
  return new Date(toUTC(iso)).getUTCDate();
}

/**
 * Returns the year of a date.
 * @param {string} iso
 * @return {number}
 */
export function yearOf(iso) {
  return new Date(toUTC(iso)).getUTCFullYear();
}

/**
 * Returns the month index: January = 0 … December = 11.
 * @param {string} iso
 * @return {number}
 */
export function monthIndex(iso) {
  return new Date(toUTC(iso)).getUTCMonth();
}

/**
 * Formats the day of the month: "13" / "13.".
 * @param {string} iso
 * @return {string}
 */
function dayNumber(iso) {
  return lang === 'de' ? `${dayOfMonth(iso)}.` : String(dayOfMonth(iso));
}

/**
 * Formats a date without year: "13 Sep" / "13. Sep".
 * @param {string} iso
 * @return {string}
 */
export function formatDayMonth(iso) {
  return `${dayNumber(iso)} ${MONTH_SHORT[monthIndex(iso)]}`;
}

/**
 * Formats a date as "Mon, 13 Sep 2026".
 * @param {string} iso
 * @return {string}
 */
export function formatLong(iso) {
  const weekday = WEEKDAY_SHORT[weekdayIndex(iso)];
  return `${weekday}, ${formatDayMonth(iso)} ${yearOf(iso)}`;
}

/**
 * Formats a date as "Thursday, 1 January 2026", or without the year if
 * `withYear` is false.
 * @param {string} iso
 * @param {boolean=} withYear
 * @return {string}
 */
export function formatFull(iso, withYear = true) {
  const weekday = WEEKDAY_LONG[weekdayIndex(iso)];
  const date = `${weekday}, ${dayNumber(iso)} ${MONTH_LONG[monthIndex(iso)]}`;
  return withYear ? `${date} ${yearOf(iso)}` : date;
}

/**
 * Formats a date as "today", "yesterday" or a long date.
 * @param {string} iso
 * @param {string} today
 * @return {string}
 */
export function formatRelative(iso, today) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return t('today');
  if (diff === 1) return t('yesterday');
  if (diff === 2) return t('the day before yesterday');
  if (diff === -1) return t('tomorrow');
  if (diff === -2) return t('the day after tomorrow');
  return formatLong(iso);
}

/**
 * Returns the ISO date of a timestamp in the user's time zone. en-CA formats
 * dates as YYYY-MM-DD.
 * @param {number|!Date} stamp
 * @return {string}
 */
export function localISO(stamp) {
  return new Date(stamp).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: userTimeZone(),
  });
}
