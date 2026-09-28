// Presentation helpers shared by the overview and the detail view.

import { daysBetween, addDays, startOfWeek, WEEKDAY_SHORT } from "./dates.js";
import { state } from "./state.js";
import { t, locale } from "./i18n.js";

/**
 * Returns the schedule ({from, targetValue, frequency}) that applies on `iso`.
 * Mirrors domain.Habit.ScheduleOn: the first schedule also covers the days
 * before it.
 */
export function scheduleOn(habit, iso) {
  const all = habit.schedules;
  for (let i = all.length - 1; i > 0; i--) {
    // ISO dates compare correctly as strings.
    if (iso >= all[i].from) return all[i];
  }
  return all[0];
}

/** Returns the current schedule, the last one. */
export function currentSchedule(habit) {
  return habit.schedules.at(-1);
}

/**
 * Reports whether the habit is due on `iso`. Values can only be recorded on
 * due days. The server computes the due days (`due`, one character per day
 * from `dueFrom`), so the frequency rules exist only in
 * domain.Schedule.IsScheduled. Days outside the sent range count as not due.
 */
export function isScheduled(habit, iso) {
  if (!habit.due || !habit.dueFrom) return false;
  const i = daysBetween(habit.dueFrom, iso);
  return i >= 0 && i < habit.due.length && habit.due[i] === "1";
}

/**
 * Returns what is recorded on `iso` (domain.Entry): the value and whether the
 * day is skipped.
 */
export function entryOn(habit, iso) {
  return {
    value: habit.entries?.[iso] ?? 0,
    skipped: habit.skipped?.[iso] === true,
  };
}

/** Reports whether nothing is recorded in `entry`. */
export function isEmpty(entry) {
  return entry.value === 0 && !entry.skipped;
}

export function isSkipped(habit, iso) {
  return habit.skipped?.[iso] === true;
}

/**
 * Reports whether the habit is due on `iso` and the day is not skipped. These
 * are the days the day summary, the filter and the perfect days count, as
 * the server's statistics do.
 */
export function isDue(habit, iso) {
  return isScheduled(habit, iso) && !isSkipped(habit, iso);
}

/**
 * Returns the first day of the habit's history: its creation day, or an
 * earlier recorded day (domain.HistoryStart).
 */
export function historyStart(habit) {
  let first = habit.createdAt?.slice(0, 10) ?? "";
  for (const recorded of [habit.entries, habit.skipped]) {
    for (const iso of Object.keys(recorded ?? {})) {
      if (!first || iso < first) first = iso;
    }
  }
  return first;
}

/** Reports whether the target on `iso` is a limit (at most). */
export function isLimit(habit, iso) {
  return habit.kind !== "check" && scheduleOn(habit, iso).targetType === "at_most";
}

/** Returns the server's description of a kind (domain.KindInfo). */
export function kindInfo(kind) {
  return state.kinds[kind];
}

/**
 * Returns the number of stored units per displayed unit of a kind: 10 for
 * counts and minutes, 1000 for distances (metres), 1 otherwise.
 */
export function scale(kind) {
  return kindInfo(kind).scale;
}

/** Formats a stored value in displayed units, with at most one decimal. */
function written(habit, value) {
  return (value / scale(habit.kind)).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * Returns the target that applies on `iso`, in stored units: the value to
 * reach, or for a limit the largest value that still meets it.
 */
export function target(habit, iso) {
  if (habit.kind === "check") return 1;
  const schedule = scheduleOn(habit, iso);
  if (isLimit(habit, iso)) return schedule.targetValue;
  return Math.max(1, schedule.targetValue);
}

/**
 * Reports whether `value` meets the target that applies on `iso`, as
 * domain.Habit.IsComplete does. A skipped day is never complete. A limit is
 * also met by a day without a value, once the day has come and from the
 * habit's first day on.
 */
export function isComplete(habit, iso, value) {
  if (isSkipped(habit, iso)) return false;
  if (isLimit(habit, iso)) {
    return iso <= state.today && iso >= historyStart(habit) && (value || 0) <= target(habit, iso);
  }
  return (value || 0) >= target(habit, iso);
}

/**
 * Returns the progress towards the target of `iso`, 0…1. For a limit it is
 * the share of the limit used up.
 */
export function progress(habit, iso, value) {
  const goal = target(habit, iso);
  if (goal === 0) return value > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, (value || 0) / goal));
}

/** Returns the increment per tap, in stored units. */
export function step(habit) {
  if (habit.stepValue > 0) return habit.stepValue;
  return kindInfo(habit.kind).step;
}

/**
 * Returns the value after a tap: toggles KindCheck, otherwise adds one step up
 * to the kind's maximum. Values may exceed the target.
 */
export function nextValue(habit, current) {
  if (habit.kind === "check") return current > 0 ? 0 : 1;
  return Math.min((current || 0) + step(habit), maxValue(habit));
}

export function unitLabel(habit) {
  return kindInfo(habit.kind).unit || habit.unit || "";
}

/** Formats metres: "800 m", "5 km", "12.5 km". */
export function formatDistance(metres) {
  if (metres < 1000) return `${metres} m`;
  return `${(Math.round(metres / 100) / 10).toLocaleString(locale)} km`;
}

/**
 * Returns the short value shown inside a day cell, without unit. Distances are
 * shown in kilometres. At most three digits, so the value fits the mark at the
 * minimum text size: longer values lose their decimal ("123,4" → "123"), and
 * from 1000 on minutes are shown in hours ("24h") and other values in
 * thousands ("1,5k"). The cell's label keeps the exact value.
 */
export function cellValue(habit, value) {
  const n = habit.kind === "distance" ? value / 1000 : value / scale(habit.kind);
  // Without grouping, so "1.000" is not counted as a short value.
  const short = (x) => x.toLocaleString(locale, { maximumFractionDigits: 1, useGrouping: false });
  const text = short(Math.round(n * 10) / 10);
  if (text.replace(/\D/g, "").length <= 3) return text;
  if (Math.round(n) < 1000) return String(Math.round(n));
  if (habit.kind === "time") return `${Math.round(n / 60)}h`;
  const thousands = n / 1000;
  return `${thousands < 10 ? short(Math.round(thousands * 10) / 10) : Math.round(thousands)}k`;
}

/** Formats a day's value with its unit. */
export function formatValue(habit, value) {
  switch (habit.kind) {
    case "distance": return formatDistance(value);
    case "time": return `${written(habit, value)} min`;
    case "count": {
      const n = written(habit, value);
      return habit.unit ? `${n} ${habit.unit}` : `${n}×`;
    }
    default: return `${value}×`;
  }
}

/** Formats a total with its unit. Times of an hour or more include hours: "3 h 45 min". */
export function formatTotal(habit, total) {
  const minutes = total / scale(habit.kind);
  if (habit.kind !== "time" || minutes < 60) return formatValue(habit, total);
  const rest = (minutes % 60).toLocaleString(locale, { maximumFractionDigits: 1 });
  return `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** Reports whether the habit's values can be summed. */
export function isCountable(habit) {
  return habit.kind === "count" || habit.kind === "time" || habit.kind === "distance";
}

/**
 * Sums the values between `from` and `to` per day, week or month (`size`).
 * Each bucket has the period's `sum` and the running `cumulative` total.
 */
export function periodSummary(habit, from, to, size) {
  // Weeks start on Monday.
  const origin = size === "week" ? startOfWeek(from) : from;
  const indexOf = (iso) => {
    if (size === "day") return daysBetween(origin, iso);
    if (size === "week") return Math.floor(daysBetween(origin, iso) / 7);
    return monthsBetween(origin, iso);
  };

  const buckets = [];
  for (let i = 0; i <= indexOf(to); i++) {
    buckets.push({ start: startOfBucket(origin, i, size), sum: 0, cumulative: 0 });
  }

  let total = 0;
  let best = 0;
  let activeDays = 0;
  for (const [iso, value] of Object.entries(habit.entries)) {
    if (iso < from || iso > to || value <= 0) continue;
    buckets[indexOf(iso)].sum += value;
    total += value;
    activeDays++;
    if (value > best) best = value;
  }

  let running = 0;
  for (const bucket of buckets) {
    running += bucket.sum;
    bucket.cumulative = running;
  }
  return { buckets, total, best, activeDays };
}

/** Returns the first day of the i-th bucket after `origin`. */
function startOfBucket(origin, i, size) {
  if (size === "day") return addDays(origin, i);
  if (size === "week") return addDays(origin, i * 7);
  const month = Number(origin.slice(5, 7)) - 1 + i;
  const year = Number(origin.slice(0, 4)) + Math.floor(month / 12);
  return `${year}-${String((month % 12) + 1).padStart(2, "0")}-01`;
}

function monthsBetween(from, to) {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

/**
 * Formats the daily target of a schedule with its unit, by default of the
 * current one: "8 glasses", or for a limit "at most 2 cups" and "none";
 * "" for check habits.
 */
export function describeTarget(habit, schedule = currentSchedule(habit)) {
  if (habit.kind === "check") return "";
  if (schedule.targetType !== "at_most") return formatValue(habit, schedule.targetValue);
  if (schedule.targetValue === 0) return t("none at all");
  return t("at most {value}", { value: formatValue(habit, schedule.targetValue) });
}

/** Describes a frequency, e.g. "daily" or "Mon, Wed". */
export function describeFrequency(f) {
  switch (f.kind) {
    case "daily":
      return t("daily");
    case "times_per_week":
      return t("{n}× per week", { n: f.timesPerWeek });
    case "times_per_month":
      return t("{n}× per month", { n: f.timesPerMonth });
    case "weekdays": {
      // Short weekday names.
      const days = WEEKDAY_SHORT.filter((_, i) => f.weekdays & (1 << i));
      if (f.weekOfMonth) {
        const which = f.weekOfMonth === -1
          ? t("last")
          : [t("1st"), t("2nd"), t("3rd"), t("4th")][f.weekOfMonth - 1];
        return t("{which} {days} of the month", { which, days: days.join(", ") });
      }
      if (f.weekInterval > 1) {
        return t("{days} every {n} weeks", { days: days.join(", "), n: f.weekInterval });
      }
      if (days.length === 7) return t("daily");
      if (days.length === 5 && !(f.weekdays & (1 << 5)) && !(f.weekdays & (1 << 6))) {
        return t("Mon–Fri");
      }
      return days.join(", ");
    }
    case "custom_interval":
      return f.intervalDays === 1 ? t("daily") : t("every {n} days", { n: f.intervalDays });
    default:
      return "";
  }
}

/** Returns the subtitle below a habit's name. */
export function describeHabit(habit) {
  const parts = [];
  // Mark archived habits explicitly.
  if (habit.archivedAt) parts.push(t("Archived"));
  // Only the daily target; empty for KindCheck. The streak is rendered
  // separately (see habitLabel in cells.js).
  const goal = describeTarget(habit);
  if (goal) parts.push(goal);
  return parts.join(" · ");
}

/** Describes the current streak, e.g. "12-day streak" or "3-week streak". */
export function describeStreak(habit) {
  const s = habit.stats;
  const n = s?.currentStreak ?? 0;
  if (s?.streakUnit === "months") return t("{n}-month streak", { n });
  if (s?.streakUnit === "weeks") return t("{n}-week streak", { n });
  return t("{n}-day streak", { n });
}

/**
 * Minimum run lengths in calendar days for streak levels 1 to 6: a week, two
 * weeks, a month, a quarter, half a year, a year.
 */
export const STREAK_LEVELS = [7, 14, 30, 90, 180, 365];

/** Returns the streak level 0…6 for a run of `days` calendar days. */
export function streakLevel(days) {
  let level = 0;
  for (const needed of STREAK_LEVELS) {
    if (days >= needed) level++;
  }
  return level;
}

/**
 * Returns the number of days the run containing `iso` had lasted on that day,
 * or 0 if `iso` is not part of a run.
 */
export function streakDaysOn(habit, iso) {
  for (const run of habit.streakRuns ?? []) {
    // ISO dates compare correctly as strings.
    if (iso < run.from || iso > run.to) continue;
    return daysBetween(run.from, iso) + 1;
  }
  return 0;
}

/**
 * Returns the heat level 0…4 for the calendar heatmap. A limit shows 4 while
 * it is kept and 1 once it is exceeded.
 */
export function heatLevel(habit, iso, value) {
  if (isLimit(habit, iso)) {
    if (isComplete(habit, iso, value)) return 4;
    return value > 0 ? 1 : 0;
  }
  if (!value) return 0;
  const p = progress(habit, iso, value);
  if (p >= 1) return 4;
  if (p >= 0.66) return 3;
  if (p >= 0.33) return 2;
  return 1;
}

/** Returns the maximum value of a day, as enforced by the server. */
export function maxValue(habit) {
  return kindInfo(habit.kind).max;
}
