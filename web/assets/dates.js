// Calendar helpers. Dates are ISO strings ("2026-09-13") everywhere in the
// client, exactly as the server sends them. All arithmetic goes through UTC so
// a daylight-saving transition can never shift a day by one.

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

export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAY_LONG = [
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
];
export const MONTH_SHORT = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

export function dayOfMonth(iso) {
  return new Date(toUTC(iso)).getUTCDate();
}

export function yearOf(iso) {
  return new Date(toUTC(iso)).getUTCFullYear();
}

export function monthIndex(iso) {
  return new Date(toUTC(iso)).getUTCMonth();
}

/** "Mo, 13. Sep 2026" — used in headings and dialog titles. */
export function formatLong(iso) {
  const d = new Date(toUTC(iso));
  return `${WEEKDAY_SHORT[weekdayIndex(iso)]}, ${d.getUTCDate()}. ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "heute" / "gestern" / a long date, for anything the user reads in prose. */
export function formatRelative(iso, today) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return "heute";
  if (diff === 1) return "gestern";
  if (diff === 2) return "vorgestern";
  if (diff === -1) return "morgen";
  if (diff === -2) return "übermorgen";
  return formatLong(iso);
}

/** Inclusive list of dates from `from` to `to`. */
export function range(from, to) {
  const out = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export const MONTH_LONG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "Donnerstag, 1. Januar 2026" — the spelled-out form for tooltips. */
export function formatFull(iso) {
  const d = new Date(toUTC(iso));
  return `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${d.getUTCDate()}. ` +
    `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
