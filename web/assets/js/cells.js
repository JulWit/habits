// Rendering of a habit row: label, day header and day cells.

import { dayOfMonth, WEEKDAY_SHORT, weekdayIndex, formatRelative, formatLong } from "./dates.js";
import { state } from "./state.js";
import { habitIconBadge, icons, colorValue } from "./icons.js";
import * as H from "./habit.js";
import { t } from "./i18n.js";

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Builds a day in the header. `active` is the highlighted day (is-today), by
 * default today; the actual today keeps is-current. With `selectable`, the
 * cell is a button that makes its day the active one.
 */
export function dayCell(iso, { active = state.today, selectable = false } = {}) {
  const el = document.createElement(selectable ? "button" : "div");
  const classes = ["grid-head"];
  if (iso === active) classes.push("is-today");
  if (iso === state.today) classes.push("is-current");
  if (selectable) {
    el.type = "button";
    el.dataset.role = "select-day";
    el.dataset.date = iso;
    el.setAttribute("aria-pressed", String(iso === active));
    classes.push("is-selectable");
  }
  el.className = classes.join(" ");
  // The full date as tooltip, since the cell only shows the day of the month.
  el.title = formatLong(iso);
  el.innerHTML =
    `<span class="dow">${WEEKDAY_SHORT[weekdayIndex(iso)]}</span>` +
    `<span class="dom">${dayOfMonth(iso)}</span>`;
  return el;
}

export function habitLabel(habit) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = habit.archivedAt ? "habit-main is-archived" : "habit-main";
  el.dataset.habit = habit.id;
  el.dataset.role = "open";

  const name = document.createElement("span");
  name.className = "habit-name";
  name.textContent = habit.name;

  const meta = document.createElement("span");
  meta.className = "habit-meta";
  const described = H.describeHabit(habit);
  const streak = habit.stats?.currentStreak ?? 0;
  // The streak is always shown, even when it is 0.
  meta.append(streakBadge(streak), described ? ` · ${described}` : "");

  // Tooltip with the full text, including the streak in words.
  const metaText = [H.describeStreak(habit), described].filter(Boolean).join(" · ");
  el.title = `${habit.name}\n${metaText}`;

  const text = document.createElement("span");
  text.className = "habit-text";
  text.append(name, meta);

  const badge = habitIconBadge(habit);
  if (badge) el.append(badge);
  el.append(text);
  return el;
}

function streakBadge(count) {
  const el = document.createElement("span");
  el.className = "habit-streak";
  el.innerHTML = icons.streak;
  el.append(String(count));
  return el;
}

/**
 * Builds a day cell of a row; `active` is the day of the band. The cell shows
 * the server's status of the day (habit.js); a write still waiting for the
 * server is shown with its value only.
 */
export function dayEntry(habit, iso, active = state.today) {
  const entry = H.entryOn(habit, iso);
  const { value } = entry;
  const pending = H.isPending(habit, iso);
  const done = !pending && H.isDone(habit, iso);
  const future = iso > state.today;
  const scheduled = H.isScheduled(habit, iso);
  // Length of the run this day belongs to; 0 for future days.
  const streakDays = H.streakDaysOn(habit, iso);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = iso === active ? "cell is-today" : "cell";
  btn.dataset.habit = habit.id;
  btn.dataset.date = iso;
  btn.dataset.role = "cell";
  btn.style.setProperty("--habit-color", colorValue(habit.color));
  const label = cellLabel(habit, iso, entry, { pending, done, scheduled, streakDays });
  btn.setAttribute("aria-label", label);
  // The same text as a tooltip, so the state is not told by the mark's colour
  // and pattern alone (e.g. hatched: planned ahead).
  btn.title = label;
  // Unscheduled days are disabled unless they hold something to clear.
  if (!scheduled && H.isEmpty(entry)) btn.disabled = true;

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.style.setProperty("--habit-color", colorValue(habit.color));
  mark.style.setProperty("--p", String(H.progress(habit, iso, value)));

  // Unscheduled days without a value are drawn as off.
  if (!scheduled && value === 0) mark.classList.add("is-off");
  // Future days are dimmed.
  if (future) mark.classList.add("is-future");
  if (pending) mark.classList.add("is-pending");
  if (entry.skipped) {
    mark.classList.add("is-skipped");
    mark.innerHTML = icons.skip;
  } else if (done) {
    mark.classList.add("is-complete");
    // Longer runs are drawn with a stronger streak colour. Level 0 changes
    // nothing.
    const level = H.streakLevel(streakDays);
    if (level > 0) mark.dataset.streak = String(level);
    // A kept limit without a value is ticked like a check.
    if (habit.kind === "check" || value === 0) mark.innerHTML = CHECK_SVG;
    else mark.append(numberLabel(H.cellValue(habit, value)));
  } else if (pending && habit.kind === "check" && value > 0) {
    mark.innerHTML = CHECK_SVG;
  } else if (value > 0) {
    // A value over the limit is marked as such.
    if (!pending && H.isOver(habit, iso)) mark.classList.add("is-over");
    mark.append(numberLabel(H.cellValue(habit, value)));
  }

  btn.append(mark);
  return btn;
}

// Wraps the number in an element so it can be layered above the ring's
// ::after with z-index.
function numberLabel(text) {
  const el = document.createElement("span");
  el.className = "mark-value";
  // Tighter spacing for four characters ("12,5", "1,5k"); cellValue keeps
  // them short enough for the mark.
  if (text.length >= 4) el.classList.add("is-long");
  el.textContent = text;
  return el;
}

function cellLabel(habit, iso, entry, { pending, done, scheduled, streakDays }) {
  const when = formatRelative(iso, state.today);
  const status = pending
    ? pendingStatus(habit, entry)
    : cellStatus(habit, iso, entry, done, scheduled);
  // Announce the streak length on days that are part of a run.
  const run = done && iso <= state.today && streakDays > 0
    ? t(", day {n} of a streak", { n: streakDays })
    : "";
  return `${habit.name}, ${when}: ${status}${run}`;
}

/** Describes a write that waits for the server. */
function pendingStatus(habit, { value, skipped }) {
  if (skipped) return t("skipped");
  if (value > 0) return t("{value}, not saved yet", { value: H.formatValue(habit, value) });
  return t("cleared, not saved yet");
}

/** Describes a day's entry. Future days are announced as planned. */
function cellStatus(habit, iso, { value, skipped }, done, scheduled) {
  if (skipped) return t("skipped");
  if (H.isLimit(habit, iso)) return limitStatus(habit, iso, value, done, scheduled);
  const ahead = iso > state.today;
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit, iso)) };

  if (done) {
    if (!ahead) return t("done");
    return habit.kind === "check" ? t("planned") : t("{value} planned", vars);
  }
  if (value > 0) {
    return ahead ? t("{value} of {target} planned", vars) : t("{value} of {target}", vars);
  }
  return scheduled ? t("open") : t("not scheduled");
}

/** Describes a day of a limit: within it, over it, or planned. */
function limitStatus(habit, iso, value, done, scheduled) {
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit, iso)) };
  if (!scheduled && value === 0) return t("not scheduled");
  if (iso > state.today) return value > 0 ? t("{value} planned", vars) : t("still ahead");
  if (!done) {
    return value > 0 ? t("{value}, over the limit of {target}", vars) : t("open");
  }
  return value > 0 ? t("{value}, within the limit of {target}", vars) : t("nothing, within the limit");
}
