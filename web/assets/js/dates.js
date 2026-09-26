// Calendar helpers. Dates are ISO strings ("2026-09-13") everywhere in the
// client, exactly as the server sends them. All arithmetic goes through UTC so
// a daylight-saving transition can never shift a day by one.

import { t, lang } from "./i18n.js";

const DAY_MS = 86400000;

export function toUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** Monday = 0 … Sunday = 6, matching the server's weekday bitmask. */
export function weekdayIndex(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

// Written out per language rather than taken from Intl: the short forms are
// chosen to fit a day column, and Intl's German ones carry a full stop ("Mo.")
// that the column has no room for.
const NAMES = {
  en: {
    weekdayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    weekdayLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    monthLong: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
  },
  de: {
    weekdayShort: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    weekdayLong: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    monthShort: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    monthLong: [
      "Januar", "Februar", "März", "April", "Mai", "Juni",
      "Juli", "August", "September", "Oktober", "November", "Dezember",
    ],
  },
}[lang];

export const WEEKDAY_SHORT = NAMES.weekdayShort;
export const WEEKDAY_LONG = NAMES.weekdayLong;
export const MONTH_SHORT = NAMES.monthShort;

export function dayOfMonth(iso) {
  return new Date(toUTC(iso)).getUTCDate();
}

export function yearOf(iso) {
  return new Date(toUTC(iso)).getUTCFullYear();
}

export function monthIndex(iso) {
  return new Date(toUTC(iso)).getUTCMonth();
}

/** "13 Sep" / "13. Sep" — a day of the year without its year. */
export function formatDayMonth(iso) {
  const d = new Date(toUTC(iso));
  const day = lang === "de" ? `${d.getUTCDate()}.` : String(d.getUTCDate());
  return `${day} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "Mon, 13 Sep 2026" — used in headings and dialog titles. */
export function formatLong(iso) {
  return `${WEEKDAY_SHORT[weekdayIndex(iso)]}, ${formatDayMonth(iso)} ${yearOf(iso)}`;
}

/** "today" / "yesterday" / a long date, for anything the user reads in prose. */
export function formatRelative(iso, today) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return t("today");
  if (diff === 1) return t("yesterday");
  if (diff === 2) return t("the day before yesterday");
  if (diff === -1) return t("tomorrow");
  if (diff === -2) return t("the day after tomorrow");
  return formatLong(iso);
}

/** Inclusive list of dates from `from` to `to`. */
export function range(from, to) {
  const out = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export const MONTH_LONG = NAMES.monthLong;

/** "Thursday, 1 January 2026" — the spelled-out form for tooltips. */
export function formatFull(iso) {
  const d = new Date(toUTC(iso));
  const day = lang === "de" ? `${d.getUTCDate()}.` : String(d.getUTCDate());
  return `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${day} ` +
    `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
