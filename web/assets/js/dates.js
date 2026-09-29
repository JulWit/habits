// Date helpers. Dates are ISO strings ("2026-09-13"); arithmetic is done in
// UTC.

import {lang, t, userTimeZone} from './i18n.js';

const DAY_MS = 86400000;

export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${
      pad(d.getUTCDate())}`;
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** Returns the weekday index: Monday = 0 … Sunday = 6. */
export function weekdayIndex(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

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

export function dayOfMonth(iso) {
  return new Date(toUTC(iso)).getUTCDate();
}

export function yearOf(iso) {
  return new Date(toUTC(iso)).getUTCFullYear();
}

export function monthIndex(iso) {
  return new Date(toUTC(iso)).getUTCMonth();
}

/** Formats the day of the month: "13" / "13.". */
function dayNumber(iso) {
  return lang === 'de' ? `${dayOfMonth(iso)}.` : String(dayOfMonth(iso));
}

/** Formats a date without year: "13 Sep" / "13. Sep". */
export function formatDayMonth(iso) {
  return `${dayNumber(iso)} ${MONTH_SHORT[monthIndex(iso)]}`;
}

/** Formats a date as "Mon, 13 Sep 2026". */
export function formatLong(iso) {
  return `${WEEKDAY_SHORT[weekdayIndex(iso)]}, ${formatDayMonth(iso)} ${
      yearOf(iso)}`;
}

/**
 * Formats a date as "Thursday, 1 January 2026", or without the year if
 * `withYear` is false.
 */
export function formatFull(iso, withYear = true) {
  const date = `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${dayNumber(iso)} ${
      MONTH_LONG[monthIndex(iso)]}`;
  return withYear ? `${date} ${yearOf(iso)}` : date;
}

/** Formats a date as "today", "yesterday" or a long date. */
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
 */
export function localISO(stamp) {
  return new Date(stamp).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: userTimeZone(),
  });
}
