// Rendering of a habit row: label, day header and day cells.

import { dayOfMonth, WEEKDAY_SHORT, weekdayIndex, formatRelative, formatLong } from "./dates.js";
import { state } from "./state.js";
import { habitIconBadge, icons } from "./icons.js";
import * as H from "./habit.js";
import { t } from "./i18n.js";

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function dayCell(iso) {
  const el = document.createElement("div");
  const classes = ["grid-head"];
  if (iso === state.today) classes.push("is-today");
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

export function dayEntry(habit, iso) {
  const value = habit.entries[iso] ?? 0;
  const future = iso > state.today;
  const scheduled = H.isScheduled(habit, iso);
  // Length of the run this day belongs to; 0 for future days.
  const streakDays = H.streakDaysOn(habit, iso);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = iso === state.today ? "cell is-today" : "cell";
  btn.dataset.habit = habit.id;
  btn.dataset.date = iso;
  btn.dataset.role = "cell";
  btn.style.setProperty("--habit-color", habit.color);
  const label = cellLabel(habit, iso, value, scheduled, streakDays);
  btn.setAttribute("aria-label", label);
  // The same text as a tooltip, so the state is not told by the mark's colour
  // and pattern alone (e.g. hatched: planned ahead).
  btn.title = label;
  // Unscheduled days are disabled unless they have a value to clear.
  if (!H.acceptsEntry(habit, iso) && value === 0) btn.disabled = true;

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.style.setProperty("--habit-color", habit.color);
  mark.style.setProperty("--p", String(H.progress(habit, value)));

  if (!scheduled) mark.classList.add("is-off");
  // Future days are dimmed.
  if (future) mark.classList.add("is-future");
  if (H.isComplete(habit, value)) {
    mark.classList.remove("is-off");
    mark.classList.add("is-complete");
    // Longer runs are drawn with a stronger streak colour. Level 0 changes
    // nothing.
    const level = H.streakLevel(streakDays);
    if (level > 0) mark.dataset.streak = String(level);
    if (habit.kind === "check") mark.innerHTML = CHECK_SVG;
    else mark.append(numberLabel(H.cellValue(habit, value)));
  } else if (value > 0) {
    mark.classList.remove("is-off");
    mark.append(numberLabel(H.cellValue(habit, value)));
  }

  btn.append(mark);
  return btn;
}

// Wraps the number in an element so it can be layered above the ring's
// ::after with z-index.
function numberLabel(text) {
  const el = document.createElement("span");
  // Smaller font sizes for values with three or four characters.
  el.className = text.length >= 4
    ? "mark-value is-tiny"
    : text.length === 3
      ? "mark-value is-small"
      : "mark-value";
  el.textContent = text;
  return el;
}

function cellLabel(habit, iso, value, scheduled, streakDays = 0) {
  const when = formatRelative(iso, state.today);
  // Future days are announced as planned rather than done.
  const ahead = iso > state.today;
  const reached = H.isComplete(habit, value);
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit)) };
  const status = reached && !ahead
    ? t("done")
    : reached && habit.kind === "check"
      ? t("planned")
      : reached
        ? t("{value} planned", vars)
        : value > 0
          ? ahead ? t("{value} of {target} planned", vars) : t("{value} of {target}", vars)
          : scheduled
            ? t("open")
            : t("not scheduled");
  // Announce the streak length on days that are part of a run.
  const run = reached && !ahead && streakDays > 0
    ? t(", day {n} of a streak", { n: streakDays })
    : "";
  return `${habit.name}, ${when}: ${status}${run}`;
}
