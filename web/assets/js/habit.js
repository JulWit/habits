// Presentation helpers shared by the overview and the detail view.

import { weekdayIndex, daysBetween, addDays, startOfWeek, WEEKDAY_SHORT } from "./dates.js";
import { state } from "./state.js";

/**
 * Whether the habit is due on a given day.
 *
 * This mirrors domain.Habit.IsScheduled on the server. The duplication is
 * deliberate: the grid has to shade non-due days for a whole screen of dates,
 * and asking the server for that would turn every scroll into a round trip. The
 * server stays the authority — it is what validates writes.
 */
export function isScheduled(habit, iso) {
  const f = habit.frequency;
  switch (f.kind) {
    case "daily":
    case "times_per_week":
      return true;
    case "weekdays":
      return (f.weekdays & (1 << weekdayIndex(iso))) !== 0;
    case "every_n_days": {
      if (!f.intervalDays || !f.anchorDate) return false;
      const diff = daysBetween(f.anchorDate, iso);
      return diff >= 0 && diff % f.intervalDays === 0;
    }
    default:
      return false;
  }
}

/**
 * Whether a value may be recorded on a day. Mirrors domain.Habit.AcceptsEntry:
 * a habit with fixed days (chosen weekdays, every n days) closes the others.
 */
export function acceptsEntry(habit, iso) {
  const kind = habit.frequency.kind;
  if (kind === "weekdays" || kind === "every_n_days") return isScheduled(habit, iso);
  return true;
}

/**
 * What the server says about a kind: how fine its stored unit is, how much one
 * tap adds, and the largest a day may be.
 *
 * These numbers decide what a stored integer means — 5000 is five kilometres or
 * five hundred repetitions depending on them — so they come down with the state
 * rather than being written out a second time here. The fallbacks below only
 * cover the moment before the first response has landed; nothing draws then.
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
 * How many stored units make one unit the reader writes.
 *
 * Every value the app stores is a whole number, so the kinds that take a
 * decimal place are kept finer than they are written: tenths of a count,
 * tenths of a minute, and metres for a distance spelled in kilometres.
 */
export function scale(habit) {
  return scaleOf(habit.kind);
}

/** The same, for a kind that has no habit yet — the editor's target fields. */
export function scaleOf(kind) {
  return kindInfo(kind).scale;
}

/** A stored number written out, with at most one decimal place. */
function written(habit, value) {
  return (value / scale(habit)).toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export function target(habit) {
  return habit.kind === "check" ? 1 : Math.max(1, habit.targetValue || 1);
}

export function isComplete(habit, value) {
  return (value || 0) >= target(habit);
}

/** 0…1, for the progress ring. */
export function progress(habit, value) {
  return Math.max(0, Math.min(1, (value || 0) / target(habit)));
}

/**
 * How much a single tap adds.
 *
 * A count carries its own step, because "one" is right for glasses of water
 * and wrong for push-ups. The other kinds follow the unit they are stored in:
 * minutes move in fives and metres in half-kilometres — tapping a 5 km run up
 * in single metres would be absurd. The long-press dialog is there for an
 * exact value.
 */
export function step(habit) {
  if (habit.stepValue > 0) return habit.stepValue;
  return kindInfo(habit.kind).step;
}

/**
 * The value a tap writes.
 *
 * Counting kinds keep going past their target: after 5 km, one more tap means
 * 5.5 km, not "start over". Overshooting the target is ordinary — the day the
 * run was longer — while wanting to wipe a day is rare, and the long press and
 * the right click set any value including zero.
 *
 * The only ceiling is the per-kind maximum, the same one the value dialog uses,
 * so a held-down tap cannot write a number the habit could never have as its
 * target.
 */
export function nextValue(habit, current) {
  if (habit.kind === "check") return current > 0 ? 0 : 1;
  return Math.min((current || 0) + step(habit), maxValue(habit));
}

export function unitLabel(habit) {
  return kindInfo(habit.kind).unit || habit.unit || "";
}

/** Metres as the reader would say them: 800 m, 5 km, 12.5 km. */
export function formatDistance(metres) {
  if (metres < 1000) return `${metres} m`;
  return `${(Math.round(metres / 100) / 10).toLocaleString("en-GB")} km`;
}

/**
 * The short form that fits inside a day circle — no unit, since the circle is
 * about 25px across. Distances are shown in kilometres, because five digits of
 * metres would never fit.
 */
export function cellValue(habit, value) {
  // A kilometre with one decimal, whatever the metres say: 5.2 fits, 5200 and
  // 5.24 do not.
  if (habit.kind === "distance") return (Math.round(value / 100) / 10).toLocaleString("en-GB");
  return written(habit, value);
}

/** A single day's value spelled out with its unit, for tooltips and labels. */
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

/**
 * A sum spelled out, which is not always the same as a single day's value:
 * 225 minutes read over a year reads better as "3 h 45 min".
 */
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
  minutes.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** Habits whose values are a quantity worth adding up. */
export function isCountable(habit) {
  return habit.kind === "count" || habit.kind === "time" || habit.kind === "distance";
}

/**
 * A stretch of history summed into buckets of one day, one week or one month.
 *
 * Computed from the entries the client already holds rather than asked of the
 * server — the detail view has pulled the habit's full history anyway, and a
 * sum over a few hundred numbers is not worth a round trip.
 *
 * Every bucket carries both numbers the chart draws: `sum` is what that day or
 * week or month brought in, `cumulative` the running total since the start of
 * the range.
 */
export function periodSummary(habit, from, to, size) {
  // Weeks are counted from the Monday of the week the range starts in, so a
  // bucket is never half a week wide.
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

/** The first day of the i-th bucket after `origin`. */
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
      return "daily";
    case "times_per_week":
      return `${f.timesPerWeek}× per week`;
    case "weekdays": {
      // Abbreviated: five spelled-out names run past the name column, and the
      // short forms are unambiguous in a line that is about a weekly rhythm.
      const days = WEEKDAY_SHORT.filter((_, i) => f.weekdays & (1 << i));
      if (days.length === 7) return "daily";
      if (days.length === 5 && !(f.weekdays & (1 << 5)) && !(f.weekdays & (1 << 6))) {
        return "Mon–Fri";
      }
      return days.join(", ");
    }
    case "every_n_days":
      return f.intervalDays === 1 ? "daily" : `every ${f.intervalDays} days`;
    default:
      return "";
  }
}

/** The subtitle under a habit name: streak first, then what is expected. */
export function describeHabit(habit) {
  const parts = [];
  // Said first, because a dimmed row alone is easy to misread as merely faded.
  if (habit.archivedAt) parts.push("Archived");
  // No streak here for now: with the target and the frequency it made the line
  // longer than the name column, and it is still readable on the detail view
  // under "Current streak". The stat itself is untouched and waiting for a
  // better place on the board.
  // Frequency first, target second: how often is the habit's shape, the target
  // the detail of a single day — and the frequency is the shorter of the two,
  // so the part that survives a narrow column is the one that says more.
  const t = describeTarget(habit);
  parts.push(t ? `${describeFrequency(habit)} · ${t}` : describeFrequency(habit));
  return parts.join(" · ");
}

/**
 * The streak levels the board paints, as the number of calendar days a run has
 * to have been going before a day earns that level.
 *
 * Stated in days rather than in the habit's own rhythm, because the steps are
 * milestones a person recognises — a week, a fortnight, a month, a quarter,
 * half a year, a year — and those pass at the same rate whether a habit is due
 * daily or three times a week.
 *
 * Here rather than on the server for the same reason as heatLevel above: the
 * server decides what a run *is*, this decides only how it is drawn.
 */
export const STREAK_LEVELS = [7, 14, 30, 90, 180, 365];

/** Level 0…6 for a run that has been going for `days` calendar days. */
export function streakLevel(days) {
  let level = 0;
  for (const needed of STREAK_LEVELS) {
    if (days >= needed) level++;
  }
  return level;
}

/**
 * How many calendar days the run covering `iso` had been going by that day, or
 * 0 for a day outside every run.
 *
 * Counted from the run's own first day, which the server sends even when it is
 * older than the history the board holds: a year-long streak is painted as one
 * the moment it is a year old, not once its start scrolls into view.
 */
export function streakDaysOn(habit, iso) {
  for (const run of habit.streakRuns ?? []) {
    // ISO dates sort as text, which is what makes this a comparison and not a
    // date calculation per cell.
    if (iso < run.from || iso > run.to) continue;
    return daysBetween(run.from, iso) + 1;
  }
  return 0;
}

/** Heat level 0…4 for the calendar heatmap. */
export function heatLevel(habit, value) {
  if (!value) return 0;
  const p = progress(habit, value);
  if (p >= 1) return 4;
  if (p >= 0.66) return 3;
  if (p >= 0.33) return 2;
  return 1;
}

/** The largest value a single day may hold. The server enforces the same cap. */
export function maxValue(habit) {
  return kindInfo(habit.kind).max;
}
