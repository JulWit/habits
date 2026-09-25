// Rendering of the individual pieces of a habit row: the label on the left, the
// day header above, and the day cells themselves.

import { dayOfMonth, WEEKDAY_SHORT, weekdayIndex, formatRelative, formatLong } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit.js";

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function dayCell(iso) {
  const el = document.createElement("div");
  // Monday carries the week marker: with up to a month of columns in one row, a
  // coloured label every seventh column is what lets the eye count weeks.
  const classes = ["grid-head"];
  if (weekdayIndex(iso) === 0) classes.push("is-week-start");
  if (iso === state.today) classes.push("is-today");
  el.className = classes.join(" ");
  // The header shows only the day of the month. Once the board can be paged
  // back, that number no longer implies the current month, so the full date is
  // one hover away.
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
  meta.textContent = H.describeHabit(habit);

  // Whatever is still too long for the column stays readable on hover. Both
  // lines, because a long habit name is clipped the same way.
  el.title = `${habit.name}\n${meta.textContent}`;

  el.append(name, meta);
  return el;
}

export function dayEntry(habit, iso) {
  const value = habit.entries[iso] ?? 0;
  const future = iso > state.today;
  const scheduled = H.isScheduled(habit, iso);
  // How long the run this day belongs to had been going by then. A day ahead of
  // today is in no run, so a plan never borrows the colours of a streak.
  const streakDays = H.streakDaysOn(habit, iso);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = iso === state.today ? "cell is-today" : "cell";
  btn.dataset.habit = habit.id;
  btn.dataset.date = iso;
  btn.dataset.role = "cell";
  btn.style.setProperty("--habit-color", habit.color);
  btn.setAttribute("aria-label", cellLabel(habit, iso, value, scheduled, streakDays));
  // A day outside the chosen weekdays takes nothing. A leftover value from
  // before the days changed stays tappable, so it can still be cleared.
  if (!H.acceptsEntry(habit, iso) && value === 0) btn.disabled = true;

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.style.setProperty("--habit-color", habit.color);
  mark.style.setProperty("--p", String(H.progress(habit, value)));

  if (!scheduled) mark.classList.add("is-off");
  // A day ahead of today is drawn like any other, only dimmed: what is written
  // there is a plan, and a plan should read as one.
  if (future) mark.classList.add("is-future");
  if (H.isComplete(habit, value)) {
    mark.classList.remove("is-off");
    mark.classList.add("is-complete");
    // The longer the run, the less of the habit's own colour is left over the
    // spectrum underneath. Level 0 sets nothing, so a day outside a run — and
    // every day of a run in its first week — is drawn exactly as before.
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

// The number sits in an element rather than as a bare text node: the ring's
// ::after knockout paints over the mark's own text, and only element children
// can be lifted above it with z-index.
function numberLabel(text) {
  const el = document.createElement("span");
  // The hole inside the ring is about 17px wide, which fits two characters at
  // the base size. Longer values step down rather than spilling over the ring:
  // three for a count like 999, four for a distance like 12.5.
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
  // "Done" would be a lie about a day that has not happened yet, so a day
  // ahead reports what is planned instead.
  const ahead = iso > state.today;
  const reached = H.isComplete(habit, value);
  const status = reached && !ahead
    ? "done"
    : reached && habit.kind === "check"
      ? "planned"
      : reached
        ? `${H.formatValue(habit, value)} planned`
        : value > 0
          ? `${H.formatValue(habit, value)} of ${H.formatValue(habit, H.target(habit))}${ahead ? " planned" : ""}`
          : scheduled
            ? "open"
            : "not scheduled";
  // The colours of a streak are colour alone; a screen reader gets the same
  // information as a number. Only on days that actually carry one, so an
  // ordinary row does not gain a suffix on every cell.
  const run = reached && !ahead && streakDays > 0
    ? `, day ${streakDays} of a streak`
    : "";
  return `${habit.name}, ${when}: ${status}${run}`;
}
