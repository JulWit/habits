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

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];
export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

/** "Mon, 13 Sep 2026" — used in headings and dialog titles. */
export function formatLong(iso) {
  const d = new Date(toUTC(iso));
  return `${WEEKDAY_SHORT[weekdayIndex(iso)]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "today" / "yesterday" / a long date, for anything the user reads in prose. */
export function formatRelative(iso, today) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff === 2) return "the day before yesterday";
  if (diff === -1) return "tomorrow";
  if (diff === -2) return "the day after tomorrow";
  return formatLong(iso);
}

/** Inclusive list of dates from `from` to `to`. */
export function range(from, to) {
  const out = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Thursday, 1 January 2026" — the spelled-out form for tooltips. */
export function formatFull(iso) {
  const d = new Date(toUTC(iso));
  return `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${d.getUTCDate()} ` +
    `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
