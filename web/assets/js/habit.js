// Presentation helpers shared by the overview and the detail view. How a day
// stands (due, done, over a limit, skipped) comes from the server as one
// status per day (`days` from `daysFrom`, see domain.DayStatus); nothing here
// judges a day.

import { daysBetween, WEEKDAY_SHORT } from "./dates.js";
import { state } from "./state.js";
import { t, locale } from "./i18n.js";

/** The statuses of domain.DayStatus. */
const STATUS = {
  off: "-",
  offDone: "+",
  open: "o",
  done: "c",
  over: "x",
  skipped: "s",
};

/**
 * Returns the server's status of the habit on `iso`. Days outside the sent
 * range count as not due.
 */
export function statusOn(habit, iso) {
  if (!habit.days || !habit.daysFrom) return STATUS.off;
  const i = daysBetween(habit.daysFrom, iso);
  return i >= 0 && i < habit.days.length ? habit.days[i] : STATUS.off;
}

/**
 * Returns the schedule ({from, targetValue, targetType, frequency}) that
 * applies on `iso`, for describing the day. The first schedule also covers
 * the days before it.
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

/** Reports whether values can be recorded on `iso`: it is due or skipped. */
export function isScheduled(habit, iso) {
  const s = statusOn(habit, iso);
  return s !== STATUS.off && s !== STATUS.offDone;
}

/**
 * Returns what is shown for `iso` ({value, skipped}): a write still waiting
 * for the server (isPending), or what the server sent.
 */
export function entryOn(habit, iso) {
  const pending = habit.pending?.[iso];
  if (pending) return pending;
  return {
    value: habit.entries?.[iso] ?? 0,
    skipped: statusOn(habit, iso) === STATUS.skipped,
  };
}

/**
 * Reports whether a write of `iso` waits for the server. Its status is not
 * known until the server answers.
 */
export function isPending(habit, iso) {
  return habit.pending?.[iso] !== undefined;
}

/** Reports whether nothing is recorded in `entry`. */
export function isEmpty(entry) {
  return entry.value === 0 && !entry.skipped;
}

export function isSkipped(habit, iso) {
  return entryOn(habit, iso).skipped;
}

/**
 * Reports whether the habit is due on `iso` and the day is not skipped. These
 * are the days the day summary, the filter and the progress bars count.
 */
export function isDue(habit, iso) {
  const s = statusOn(habit, iso);
  return s === STATUS.open || s === STATUS.done || s === STATUS.over;
}

/** Reports whether the day is complete: its value meets the target. */
export function isDone(habit, iso) {
  const s = statusOn(habit, iso);
  return s === STATUS.done || s === STATUS.offDone;
}

/** Reports whether the day's value exceeds its limit. */
export function isOver(habit, iso) {
  return statusOn(habit, iso) === STATUS.over;
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
  return scheduleOn(habit, iso).targetValue;
}

/**
 * Returns the progress towards the target of `iso`, 0…1, for drawing the
 * ring. For a limit it is the share of the limit used up.
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
 * Returns the heat level 0…4 for the calendar heatmap: 4 for a complete day,
 * otherwise by the progress towards the target. A limit shows 1 once it is
 * exceeded.
 */
export function heatLevel(habit, iso, value) {
  if (isDone(habit, iso)) return 4;
  if (isLimit(habit, iso)) return value > 0 ? 1 : 0;
  if (!value) return 0;
  const p = progress(habit, iso, value);
  if (p >= 0.66) return 3;
  if (p >= 0.33) return 2;
  return 1;
}

/** Returns the maximum value of a day, as enforced by the server. */
export function maxValue(habit) {
  return kindInfo(habit.kind).max;
}
