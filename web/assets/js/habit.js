// Presentation helpers shared by the overview and the detail view.

import {
  weekdayIndex, daysBetween, addDays, startOfWeek, dayOfMonth, monthIndex, WEEKDAY_SHORT,
} from "./dates.js";
import { state } from "./state.js";
import { t, locale } from "./i18n.js";

/**
 * Reports whether the habit is due on `iso`. Mirrors domain.Habit.IsScheduled
 * on the server.
 */
export function isScheduled(habit, iso) {
  const f = habit.frequency;
  switch (f.kind) {
    case "daily":
    case "times_per_week":
      return true;
    case "weekdays":
      return (f.weekdays & (1 << weekdayIndex(iso))) !== 0 && inScheduledWeek(f, iso);
    case "custom_interval": {
      if (!f.intervalDays || !f.anchorDate) return false;
      const diff = daysBetween(f.anchorDate, iso);
      return diff >= 0 && diff % f.intervalDays === 0;
    }
    default:
      return false;
  }
}

/**
 * Reports whether `iso` lies in a week selected by the week interval or week
 * of month. Mirrors domain.Habit.inScheduledWeek.
 */
function inScheduledWeek(f, iso) {
  if (f.weekOfMonth === -1) return monthIndex(addDays(iso, 7)) !== monthIndex(iso);
  if (f.weekOfMonth > 0) return Math.floor((dayOfMonth(iso) - 1) / 7) + 1 === f.weekOfMonth;
  if (f.weekInterval > 1) {
    if (!f.anchorDate || iso < f.anchorDate) return false;
    const weeks = daysBetween(startOfWeek(f.anchorDate), startOfWeek(iso)) / 7;
    return weeks % f.weekInterval === 0;
  }
  return true;
}

/**
 * Reports whether a value may be recorded on `iso`. Mirrors
 * domain.Habit.AcceptsEntry.
 */
export function acceptsEntry(habit, iso) {
  const kind = habit.frequency.kind;
  if (kind === "weekdays" || kind === "custom_interval") return isScheduled(habit, iso);
  return true;
}

/**
 * Kind descriptors used until the server's (state.kinds) are loaded. See
 * domain.KindInfo.
 */
const FALLBACK = {
  check: { scale: 1, step: 1, max: 1, unit: "" },
  count: { scale: 10, step: 10, max: 10000, unit: "" },
  time: { scale: 10, step: 50, max: 14400, unit: "min" },
  distance: { scale: 1000, step: 500, max: 200000, unit: "m" },
};

export function kindInfo(kind) {
  return state.kinds?.[kind] ?? FALLBACK[kind] ?? FALLBACK.check;
}

/**
 * Returns the number of stored units per displayed unit: 10 for counts and
 * minutes, 1000 for distances (metres), 1 otherwise.
 */
export function scale(habit) {
  return scaleOf(habit.kind);
}

/** Like scale, for a kind. */
export function scaleOf(kind) {
  return kindInfo(kind).scale;
}

/** Formats a stored value in displayed units, with at most one decimal. */
function written(habit, value) {
  return (value / scale(habit)).toLocaleString(locale, { maximumFractionDigits: 1 });
}

export function target(habit) {
  return habit.kind === "check" ? 1 : Math.max(1, habit.targetValue || 1);
}

export function isComplete(habit, value) {
  return (value || 0) >= target(habit);
}

/** Returns the progress towards the target, 0…1. */
export function progress(habit, value) {
  return Math.max(0, Math.min(1, (value || 0) / target(habit)));
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
 * shown in kilometres.
 */
export function cellValue(habit, value) {
  // Kilometres with one decimal.
  if (habit.kind === "distance") return (Math.round(value / 100) / 10).toLocaleString(locale);
  return written(habit, value);
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

/** Formats a total with its unit, e.g. "3 h 45 min". */
export function formatTotal(habit, total) {
  switch (habit.kind) {
    case "time": {
      const minutes = total / scale(habit);
      const hours = Math.floor(minutes / 60);
      if (hours === 0) return `${formatMinutes(minutes)} min`;
      return `${hours} h ${formatMinutes(minutes % 60)} min`;
    }
    case "distance":
      return formatDistance(total);
    case "count": {
      const n = written(habit, total);
      return habit.unit ? `${n} ${habit.unit}` : `${n}×`;
    }
    default:
      return `${total}×`;
  }
}

const formatMinutes = (minutes) =>
  minutes.toLocaleString(locale, { maximumFractionDigits: 1 });

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

export function describeTarget(habit) {
  switch (habit.kind) {
    case "count":
      return `${written(habit, habit.targetValue)}${habit.unit ? " " + habit.unit : "×"}`;
    case "time":
      return `${written(habit, habit.targetValue)} min`;
    case "distance":
      return formatDistance(habit.targetValue);
    default:
      return "";
  }
}

export function describeFrequency(habit) {
  const f = habit.frequency;
  switch (f.kind) {
    case "daily":
      return t("daily");
    case "times_per_week":
      return t("{n}× per week", { n: f.timesPerWeek });
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
  return s?.streakUnit === "weeks"
    ? t("{n}-week streak", { n })
    : t("{n}-day streak", { n });
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

/** Returns the heat level 0…4 for the calendar heatmap. */
export function heatLevel(habit, value) {
  if (!value) return 0;
  const p = progress(habit, value);
  if (p >= 1) return 4;
  if (p >= 0.66) return 3;
  if (p >= 0.33) return 2;
  return 1;
}

/** Returns the maximum value of a day, as enforced by the server. */
export function maxValue(habit) {
  return kindInfo(habit.kind).max;
}
