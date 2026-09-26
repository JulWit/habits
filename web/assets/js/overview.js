// Overview: one block per category with a row per habit and a column per day.
// All blocks share the same grid, so a single day header aligns with all of
// them.

import {
  addDays, daysBetween, dayOfMonth, monthIndex, yearOf, weekdayIndex, MONTH_LONG, MONTH_SHORT,
  WEEKDAY_LONG,
} from "./dates.js";
import { state, subscribe, groupedHabits } from "./state.js";
import * as H from "./habit.js";
import { dayCell, habitLabel, dayEntry } from "./cells.js";
import { icons, categoryIconBadge } from "./icons.js";
import { enableDragReorder } from "./reorder.js";
import { t, lang } from "./i18n.js";

const LONG_PRESS_MS = 450;

// Number of additional days loaded when paging back beyond the loaded entries.
const PREFETCH_DAYS = 180;

let board;
let emptyState;
let noMatch;
let actions;

/** Reports whether reordering uses drag and drop (otherwise arrow buttons). */
const byDragging = () => (state.settings?.reorderMode ?? "drag") === "drag";

/** The number of day columns rendered last. */
let renderedDays = 0;

/** Maximum number of days the board can be paged into the future. */
const MAX_AHEAD_DAYS = 365;

/**
 * Number of days the board is shifted into the past; negative values show the
 * future. The window is anchored at its right edge.
 */
let offset = 0;

/** Returns the last day of the window, before week alignment. */
function windowEnd() {
  return addDays(state.today, -offset);
}

/**
 * Returns the first day of a window of `days` columns. With week alignment,
 * the start moves forward to the next Monday, so the current week is shown in
 * full. Week alignment requires at least seven columns.
 */
function windowStart(days) {
  const plain = addDays(windowEnd(), -(days - 1));
  if (!alignsWeeks(days)) return plain;
  const weekday = weekdayIndex(plain);
  return weekday === 0 ? plain : addDays(plain, 7 - weekday);
}

/** Reports whether the columns are aligned to calendar weeks. */
function alignsWeeks(days) {
  return (state.settings?.alignWeeks ?? false) && days >= 7;
}

/** Returns the paging step in days: whole weeks when aligned. */
function pageStep(days) {
  return alignsWeeks(days) ? Math.floor(days / 7) * 7 : days;
}

export function initOverview(handlers) {
  actions = handlers;
  board = document.getElementById("overview-grid");
  emptyState = document.getElementById("empty-state");
  noMatch = document.getElementById("no-match");
  initFilter();

  board.addEventListener("click", onBoardClick);
  board.addEventListener("contextmenu", onBoardContextMenu);
  attachLongPress(board);

  emptyState.querySelector('[data-action="add-first"]')
    .addEventListener("click", () => actions.createHabit());

  subscribe(render);

  // Drag and drop for both categories and habit rows; the handle determines
  // which list is reordered.
  enableDragReorder({
    container: board,
    item: ".block[data-category]",
    handle: '[data-role="drag-category"]',
    key: "category",
    onStart: () => { dragging = true; },
    onDrop: (ids) => {
      dragging = false;
      actions.setCategoryOrder(ids);
    },
    onCancel: () => {
      dragging = false;
      // Render changes that arrived during the drag.
      render();
    },
  });

  enableDragReorder({
    container: board,
    item: ".habit-row",
    handle: '[data-role="drag-habit"]',
    key: "habit",
    onStart: () => { dragging = true; },
    onDrop: (ids) => {
      dragging = false;
      actions.setHabitOrder(ids);
    },
    onCancel: () => {
      dragging = false;
      render();
    },
  });

  // Re-render when the available width changes, including when the view
  // becomes visible again. Observes the container, as the board's own width
  // depends on the day count.
  new ResizeObserver(() => {
    const width = availableWidth();
    if (width > 0 && visibleDays(width) !== renderedDays) render();
  }).observe(board.parentElement);
}

/**
 * Returns the available width, measured on the container, as the board's own
 * width depends on the number of columns.
 */
function availableWidth() {
  const parent = board.parentElement;
  if (!parent) return 0;
  const cs = getComputedStyle(parent);
  return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/** Returns the maximum number of day columns that fit into `width`. */
function fittingDays(width) {
  const styles = getComputedStyle(document.documentElement);
  const cell = parseFloat(styles.getPropertyValue("--cell")) || 40;
  // Same tokens as the grid template.
  const labelMin = parseFloat(styles.getPropertyValue("--label-min")) || 148;
  const padX = parseFloat(styles.getPropertyValue("--block-pad-x")) || 0;
  const tools = parseFloat(styles.getPropertyValue("--tools-col")) || 0;
  // As --tools-track; zero without handles.
  const track = tools > 0 ? tools + padX + 2 : 0;
  // Card padding and border on both sides.
  const card = 2 * padX + 2;
  return Math.max(3, Math.floor((width - labelMin - track - card) / (cell + 2)));
}

/**
 * Returns the number of day columns to render: the setting, limited to what
 * fits, or as many as fit in automatic mode. Tightens the board if fewer than
 * a week would fit.
 */
function visibleDays(width) {
  // Measure at normal sizes.
  loosen();
  const fits = fittingDays(width);
  const wanted = state.settings?.overviewDays ?? 0;
  // Automatic mode: as many as fit.
  const days = wanted > 0 ? Math.min(wanted, fits) : fits;
  // At least a week is shown, tightening the board if needed. A fixed setting
  // below seven is respected.
  const least = wanted > 0 ? Math.min(wanted, MIN_DAYS) : MIN_DAYS;
  if (days >= least) return days;
  tighten(width, least);
  return least;
}

/** Minimum number of day columns. */
const MIN_DAYS = 7;

/** Resets the board to its normal sizes. */
function loosen() {
  const root = document.documentElement;
  if (!root.hasAttribute("data-tight")) return;
  root.removeAttribute("data-tight");
  root.style.removeProperty("--cell");
  root.style.removeProperty("--label-min");
}

/**
 * Shrinks the board so that `days` columns fit into `width`: first the day
 * columns down to --cell-tight-min, then the name column down to
 * --label-tight-min. Sets data-tight and the size tokens on <html>.
 */
function tighten(width, days) {
  const root = document.documentElement;
  root.setAttribute("data-tight", "");
  const styles = getComputedStyle(root);
  const px = (name) => parseFloat(styles.getPropertyValue(name)) || 0;

  const padX = px("--block-pad-x");
  const tools = px("--tools-col");
  const track = tools > 0 ? tools + padX + 2 : 0;
  const card = 2 * padX + 2;
  const room = width - track - card;

  const labelFloor = px("--label-tight-min");
  const cellFloor = px("--cell-tight-min");
  const cellUsual = px("--cell");
  // The widest cell that leaves the name column its minimum width.
  const cell = Math.max(cellFloor, Math.min(cellUsual, Math.floor((room - labelFloor) / days) - 2));
  const label = Math.max(0, Math.floor(room - days * (cell + 2)));

  root.style.setProperty("--cell", `${cell}px`);
  root.style.setProperty("--label-min", `${label}px`);
}

/** Returns the number of day columns currently shown. */
export function currentDays() {
  return renderedDays;
}

/** Returns the largest offset whose window starts no earlier than earliestEntry. */
function maxBackDays() {
  if (!state.earliestEntry) return Infinity;
  return Math.max(0, daysBetween(state.earliestEntry, state.today) - (renderedDays - 1));
}

/**
 * Moves the window to `next` days before today, clamped to the allowed range.
 * Loads missing entries before rendering.
 */
async function showWindow(next) {
  const wanted = Math.min(maxBackDays(), Math.max(-MAX_AHEAD_DAYS, next));
  if (wanted === offset) return;
  offset = wanted;

  const start = windowStart(renderedDays);
  // ISO dates compare correctly as strings.
  if (state.entriesFrom && start < state.entriesFrom) {
    await actions.extendHistory(addDays(start, -PREFETCH_DAYS));
  }
  render();
}

/** Whether only habits still open today are shown. Not persisted. */
let onlyOpen = false;

const filtering = () => onlyOpen;

/** Reports whether a habit passes the filter. */
function matches(habit) {
  return !(onlyOpen && H.isComplete(habit, habit.entries[state.today] ?? 0));
}

/**
 * Whether a drag is in progress. Rendering is deferred until it ends, as it
 * would replace the dragged element.
 */
let dragging = false;

/** Initialises the filter toggle in the title bar. */
function initFilter() {
  const openOnly = document.getElementById("filter-open");
  openOnly.innerHTML = icons.filter;

  openOnly.addEventListener("click", () => {
    onlyOpen = !onlyOpen;
    openOnly.setAttribute("aria-pressed", String(onlyOpen));
    render();
  });
}

export function render() {
  if (!board || dragging) return;
  const all = groupedHabits();
  // Blocks keep all habits for the progress bar, plus the filtered habits for
  // the rows.
  const blocks = all
    .map((b) => ({ ...b, visible: b.habits.filter(matches) }))
    .filter((b) => !filtering() || b.visible.length > 0);

  // Reordering is disabled while filtering, as the order would be incomplete.
  document.documentElement.dataset.filtering = filtering() ? "on" : "off";
  emptyState.hidden = all.length > 0;
  noMatch.hidden = !(filtering() && blocks.length === 0);
  board.hidden = blocks.length === 0;
  if (blocks.length === 0) {
    board.replaceChildren();
    renderedDays = 0;
    return;
  }

  // A hidden view has no width; wait for the ResizeObserver.
  const width = availableWidth();
  if (width === 0) return;

  const days = visibleDays(width);
  renderedDays = days;
  // Set on <html>, as the header also uses it.
  document.documentElement.style.setProperty("--days", String(days));

  // Dates of the columns, oldest first.
  const start = windowStart(days);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));

  // Column of today for the today band; -1 if not visible.
  const todayColumn = dates.indexOf(state.today);
  board.classList.toggle("has-today", todayColumn >= 0);
  if (todayColumn >= 0) board.style.setProperty("--today-col", String(todayColumn));

  // A single uncategorised block is shown without heading.
  const labelled = all.length > 1 || all[0].category !== null;

  // Determine newly completed habits from the old board, for the orb animation.
  const everyHabit = all.flatMap((b) => b.habits);
  const flights = newlyDone(everyHabit);

  const frag = document.createDocumentFragment();
  frag.append(dayHeader(dates), daySummary(everyHabit));
  for (const block of blocks) frag.append(renderBlock(block, dates, labelled));

  const focused = focusedControl();
  board.replaceChildren(frag);
  restoreFocus(focused);
  for (const flight of flights) launchOrbs(flight);
}

/**
 * Describes the focused control of the board, so that focus can be restored
 * after re-rendering.
 */
function focusedControl() {
  const el = document.activeElement;
  if (!el || !board.contains(el) || !el.dataset.role) return null;
  return {
    role: el.dataset.role,
    category: el.closest(".block")?.dataset.category ?? "",
    habit: el.dataset.habit ?? "",
    date: el.dataset.date ?? "",
  };
}

function restoreFocus(target) {
  if (!target) return;
  const scope = target.category
    ? board.querySelector(`.block[data-category="${target.category}"]`)
    : board;
  if (!scope) return;
  let selector = `[data-role="${target.role}"]`;
  if (target.habit) selector += `[data-habit="${target.habit}"]`;
  if (target.date) selector += `[data-date="${target.date}"]`;
  const next = scope.querySelector(selector);
  // Do not focus a disabled button.
  if (next && !next.disabled) next.focus();
}

/**
 * Builds the day header: month names in the first row, weekday and day in the
 * second, on a shared grid with explicit placement.
 */
function dayHeader(dates) {
  const el = document.createElement("div");
  el.className = "day-header";

  // Backdrop behind the sticky header. An element, as it needs a clipped
  // layer of its own over a background image.
  const backdrop = document.createElement("div");
  backdrop.className = "day-header-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  el.append(backdrop);

  // The paging controls, in the date row above the habit names.
  const nav = dayNav();
  nav.style.gridColumn = "1";
  nav.style.gridRow = "2";
  el.append(nav);

  for (const label of monthLabels(dates)) el.append(label);

  dates.forEach((iso, i) => {
    const cell = dayCell(iso);
    // Month divider; not on the first column.
    if (i > 0 && dayOfMonth(iso) === 1) cell.classList.add("is-month-start");
    // Column 1 holds the habit names.
    cell.style.gridColumn = String(i + 2);
    cell.style.gridRow = "2";
    el.append(cell);
  });
  return el;
}

/** Builds a label per month, spanning its columns. */
function monthLabels(dates) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= dates.length; i++) {
    const sameMonth = i < dates.length &&
      monthIndex(dates[i]) === monthIndex(dates[start]) &&
      yearOf(dates[i]) === yearOf(dates[start]);
    if (sameMonth) continue;

    const span = i - start;
    const month = monthIndex(dates[start]);
    const year = yearOf(dates[start]);
    // Only show the year if it is not the current one.
    const suffix = year === yearOf(state.today) ? "" : ` ${year}`;

    const el = document.createElement("div");
    el.className = "month-label";
    // Short month name if the span is too narrow.
    el.textContent = (span >= 5 ? MONTH_LONG[month] : MONTH_SHORT[month]) + suffix;
    el.title = `${MONTH_LONG[month]} ${year}`;
    el.style.gridColumn = `${start + 2} / span ${span}`;
    el.style.gridRow = "1";
    // Month divider; not on the first label.
    if (start > 0) el.classList.add("has-divider");
    out.push(el);

    start = i;
  }
  return out;
}

function dayNav() {
  const nav = document.createElement("div");
  nav.className = "day-nav";

  const older = toolButton("page-older", icons.chevronLeft, t("Earlier days"));
  const newer = toolButton("page-newer", icons.chevronRight, t("Later days"));
  // Disabled rather than hidden at the limit.
  newer.disabled = offset <= -MAX_AHEAD_DAYS;
  older.disabled = offset >= maxBackDays();
  nav.append(older, newer);

  if (offset !== 0) {
    nav.append(toolButton("page-today", icons.toToday, t("Back to today")));
  }
  return nav;
}

function renderBlock({ category, habits, visible }, dates, labelled) {
  const rows = visible ?? habits;
  const section = document.createElement("section");
  section.className = "block";
  if (category) section.dataset.category = category.id;
  // The heading counts all habits of the category, the rows show the filtered.
  if (labelled) section.append(blockHead(category, habits));

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "block-empty";
    empty.textContent = t("No habit in this category yet.");
    section.append(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "block-rows";
  for (const habit of rows) {
    const row = document.createElement("div");
    row.className = "habit-row";
    row.dataset.habit = habit.id;
    row.append(
      habitCell(habit),
      ...dates.map((iso) => dayEntry(habit, iso)),
      habitTools(habit, habits),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

/**
 * Builds the name cell of a row: the label, with the move arrows overlaid on
 * its right end.
 */
function habitCell(habit) {
  const cell = document.createElement("div");
  cell.className = "habit-cell";
  cell.append(habitLabel(habit));
  return cell;
}

/**
 * Builds the reorder controls of a row: a drag handle or arrow buttons,
 * depending on the setting. Always rendered, to keep the column width.
 */
function habitTools(habit, siblings) {
  const tools = document.createElement("div");
  tools.className = "habit-tools";
  // Nothing to reorder with a single habit.
  if (siblings.length < 2) return tools;

  if (byDragging()) {
    const grip = toolButton("drag-habit", icons.grip, t("Move habit"));
    grip.classList.add("drag-handle");
    grip.dataset.habit = habit.id;
    tools.append(grip);
  } else {
    const at = siblings.indexOf(habit);
    const up = toolButton("move-habit-up", icons.chevronUp, t("Move habit up"));
    const down = toolButton("move-habit-down", icons.chevronDown, t("Move habit down"));
    up.disabled = at === 0;
    down.disabled = at === siblings.length - 1;
    up.dataset.habit = habit.id;
    down.dataset.habit = habit.id;
    tools.append(up, down);
  }
  return tools;
}

/** Counts the habits due today and how many of them are complete. */
function todayProgress(habits) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, state.today));
  const done = due.filter((h) => H.isComplete(h, h.entries[state.today] ?? 0));
  return { due: due.length, done: done.length };
}

function blockProgress(habits) {
  const { due, done } = todayProgress(habits);
  // No bar if nothing is due today.
  if (due === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "block-progress";
  wrap.title = t("{done} of {due} done today", { done, due });

  const count = document.createElement("span");
  count.className = "block-progress-count";
  count.textContent = `${done}/${due}`;

  // One segment per habit due today, followed by the count.
  const track = document.createElement("span");
  track.className = "block-progress-track";
  track.style.setProperty("--segments", String(due));
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(due));
  track.setAttribute("aria-valuenow", String(done));
  track.setAttribute("aria-label", t("Done today"));
  for (let i = 0; i < due; i++) {
    const seg = document.createElement("span");
    seg.className = "block-progress-seg";
    if (i < done) seg.classList.add("is-done");
    track.append(seg);
  }

  if (done === due) wrap.classList.add("is-complete");
  wrap.append(track, count);
  return wrap;
}

/**
 * Builds the day summary below the header: today's date, progress and ring.
 * Always refers to today and to all habits, regardless of paging and filter.
 */
function daySummary(habits) {
  const { due, done } = todayProgress(habits);
  const percent = due === 0 ? 0 : Math.round((done / due) * 100);

  const el = document.createElement("section");
  el.className = "day-summary";
  el.setAttribute("aria-label", t("Today"));

  const text = document.createElement("div");
  text.className = "day-summary-text";

  const date = document.createElement("h2");
  date.className = "day-summary-date";
  date.textContent = `${WEEKDAY_LONG[weekdayIndex(state.today)]}, ` +
    `${dayOfMonth(state.today)}${lang === "de" ? "." : ""} ${MONTH_LONG[monthIndex(state.today)]}`;

  const count = document.createElement("p");
  count.className = "day-summary-count";
  if (due > 0 && done === due) {
    // Everything due today is done.
    el.classList.add("is-complete");
    count.innerHTML = icons.check; // constant markup from icons.js
    const words = document.createElement("span");
    words.textContent = completeText(due);
    count.append(words);
  } else {
    count.textContent = due === 0 ? t("Nothing due today") : t("{done} of {due} done", { done, due });
  }
  text.append(date, count);
  el.append(text);

  // No ring if nothing is due today.
  if (due > 0) el.append(progressRing(percent));
  return el;
}

/** Messages for a completed day; the date selects one, so it stays stable. */
const COMPLETE_TEXTS = [
  () => t("All habits done!"),
  () => t("Everything ticked off. Well done!"),
  () => t("Done for today – enjoy the rest of it."),
  (n) => t("{n} of {n}. Nothing left to do today.", { n }),
  () => t("A clean sweep today!"),
];

function completeText(due) {
  const pick = daysBetween("2000-01-01", state.today) % COMPLETE_TEXTS.length;
  return COMPLETE_TEXTS[pick](due);
}

// Ring geometry in viewBox units (0 0 40 40): radius, wave amplitude and number
// of waves. RING_WAVES must be a whole number so the wave closes smoothly.
const RING_R = 15.5;
const RING_WAVE = 0.9;
const RING_WAVES = 16;

/**
 * SVG path of the wavy ring around RING_R, starting at twelve o'clock and
 * running clockwise.
 */
const WAVY_RING_PATH = (() => {
  const steps = 240;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const r = RING_R + RING_WAVE * Math.sin(RING_WAVES * t);
    // Start at the top.
    const x = 20 + r * Math.cos(t - Math.PI / 2);
    const y = 20 + r * Math.sin(t - Math.PI / 2);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
})();

/**
 * The ring's value at the last render. A new ring animates from there to its
 * new value.
 */
let lastRingPercent = null;

/**
 * Builds the progress ring filled to `percent`, with the number in its centre.
 * pathLength="100" allows dash lengths in percent.
 */
function progressRing(percent) {
  const ring = document.createElement("div");
  ring.className = "day-summary-ring";
  ring.setAttribute("role", "progressbar");
  ring.setAttribute("aria-valuemin", "0");
  ring.setAttribute("aria-valuemax", "100");
  ring.setAttribute("aria-valuenow", String(percent));
  ring.setAttribute("aria-label", t("Done today"));

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(ns, "circle");
  track.setAttribute("class", "day-summary-ring-track");
  track.setAttribute("cx", "20");
  track.setAttribute("cy", "20");
  track.setAttribute("r", String(RING_R));

  const fill = document.createElementNS(ns, "path");
  fill.setAttribute("class", "day-summary-ring-fill");
  fill.setAttribute("d", WAVY_RING_PATH);
  fill.setAttribute("pathLength", "100");
  svg.append(track, fill);

  const label = document.createElement("span");
  label.className = "day-summary-percent";
  ring.append(svg, label);

  // While orbs are in flight, they advance the ring as they land.
  if (ringHold) {
    ringHold.target = percent;
    fill.classList.add("is-filling");
    showRing(ring, ringHold.shown);
    return ring;
  }

  // A keyframe animation starts as soon as the element is inserted.
  const from = lastRingPercent ?? 0;
  lastRingPercent = percent;
  fill.style.setProperty("--from", String(from));
  fill.style.setProperty("--to", String(percent));
  // Fade in from 0, as a round cap would show a dot at zero length.
  fill.style.setProperty("--from-opacity", from === 0 ? "0" : "1");
  fill.classList.toggle("is-empty", percent === 0);
  label.textContent = `${percent}%`;
  return ring;
}

/** Sets an existing ring to `percent`. */
function showRing(ring, percent) {
  const fill = ring.querySelector(".day-summary-ring-fill");
  fill.style.setProperty("--to", String(percent));
  fill.classList.toggle("is-empty", percent === 0);
  ring.querySelector(".day-summary-percent").textContent = `${Math.round(percent)}%`;
}

// ---------- ticking off: orbs into the ring ----------

/**
 * State of the ring while orbs are in flight, or null. `shown` is the
 * displayed value, `planned` the value after all launched orbs, `target` the
 * actual value and `pending` the number of orbs in flight.
 */
let ringHold = null;

/** The habits complete today at the last render, and the date. */
let lastDone = null;
let lastDoneDay = null;

const ORBS_PER_HABIT = 6;

/**
 * Returns the habits completed since the last render, each with the position
 * of its cell on the old board. Returns nothing on the first render and after
 * a date change.
 */
function newlyDone(habits) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, state.today));
  const done = new Set(due.filter((h) => H.isComplete(h, h.entries[state.today] ?? 0)).map((h) => h.id));
  const before = lastDoneDay === state.today ? lastDone : null;
  lastDone = done;
  lastDoneDay = state.today;
  // No animation in a hidden page.
  if (!before || prefersReducedMotion() || document.hidden) return [];

  const fresh = due.filter((h) => done.has(h.id) && !before.has(h.id));
  // No ring, no orbs.
  if (fresh.length === 0 || !board.querySelector(".day-summary-ring")) return [];

  const flights = [];
  for (const habit of fresh) {
    const cell = board.querySelector(
      `.cell[data-habit="${habit.id}"][data-date="${state.today}"] .mark`);
    const rect = cell?.getBoundingClientRect();
    // Cell not visible.
    if (!rect || rect.width === 0) continue;
    flights.push({ color: habit.color, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }
  if (flights.length === 0) return [];

  // Keep the ring at its current value.
  const shown = ringHold?.shown ?? lastRingPercent ?? 0;
  ringHold ??= { shown, planned: shown, target: shown, pending: 0 };
  return flights;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Returns the screen position of the wave at `percent`, or null. */
function ringPoint(percent) {
  const ring = board.querySelector(".day-summary-ring");
  const r = ring?.getBoundingClientRect();
  if (!r || r.width === 0) return null;
  // RING_R scaled from the viewBox.
  const radius = (r.width / 40) * RING_R;
  const angle = (percent / 100) * 2 * Math.PI - Math.PI / 2;
  return {
    x: r.left + r.width / 2 + radius * Math.cos(angle),
    y: r.top + r.height / 2 + radius * Math.sin(angle),
  };
}

/** Returns the top of the visible board area, below the sticky header. */
function visibleTop() {
  let top = 0;
  for (const el of [document.querySelector(".topbar"), board.querySelector(".day-header")]) {
    if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
  }
  return top;
}

/** Shows a short flash where an orb leaves the visible area. */
function flash(x, y, size, color) {
  const el = document.createElement("span");
  el.className = "orb orb-flash";
  el.style.setProperty("--habit-color", color);
  el.style.width = el.style.height = `${size}px`;
  el.style.left = `${x - size / 2}px`;
  el.style.top = `${y - size / 2}px`;
  orbLayer().append(el);
  el.animate(
    [{ transform: "scale(.6)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }],
    { duration: 380, easing: "ease-out" },
  ).onfinish = () => el.remove();
}

/** Returns the layer for the orbs, above the board and below dialogs. */
function orbLayer() {
  let layer = document.getElementById("orb-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "orb-layer";
    layer.className = "orb-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
  }
  return layer;
}

/**
 * Sends orbs in the habit's colour from its cell to the ring. Each orb
 * advances the ring when it lands.
 */
function launchOrbs({ color, x, y }) {
  const hold = ringHold;
  if (!hold) return;
  const from = hold.planned;
  const to = hold.target;
  hold.planned = to;
  hold.pending += ORBS_PER_HABIT;

  const layer = orbLayer();
  for (let i = 0; i < ORBS_PER_HABIT; i++) {
    const orb = document.createElement("span");
    orb.className = "orb";
    orb.style.setProperty("--habit-color", color);
    const size = 7 + Math.random() * 5;
    orb.style.width = orb.style.height = `${size}px`;
    orb.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) scale(0)`;
    layer.append(orb);

    flyOrb(orb, {
      x, y, size,
      landing: from + ((to - from) * (i + 1)) / ORBS_PER_HABIT,
      delay: i * 70,
      duration: 650 + Math.random() * 250,
      // Direction and amount of the curve, random per orb.
      bend: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3),
    });
  }
}

function flyOrb(orb, { x, y, size, landing, delay, duration, bend }) {
  let start = null;

  const frame = (now) => {
    start ??= now + delay;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    // Look up the ring every frame, as it may be re-rendered or scrolled.
    const end = ringPoint(landing);
    if (!end) {
      orb.remove();
      landOrb(landing, false);
      return;
    }
    // If the ring is not visible, aim at the top of the visible area and flash
    // there.
    const edge = visibleTop();
    const hidden = end.y < edge;
    if (hidden) end.y = edge;

    // Quadratic curve, bent sideways and slightly upwards.
    const dx = end.x - x;
    const dy = end.y - y;
    const cx = x + dx / 2 - dy * bend;
    const cy = y + dy / 2 + dx * bend - Math.hypot(dx, dy) * 0.15;
    // Ease in-out (cubic).
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * x + 2 * u * e * cx + e * e * end.x;
    let py = u * u * y + 2 * u * e * cy + e * e * end.y;
    // Stay below the header.
    if (hidden) py = Math.max(py, edge);
    // Grow at the start, then shrink.
    const scale = t < 0.15 ? t / 0.15 : 1 - 0.45 * ((t - 0.15) / 0.85);
    orb.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      orb.remove();
      if (hidden) flash(end.x, end.y, size, orb.style.getPropertyValue("--habit-color"));
      landOrb(landing, !hidden);
    }
  };
  requestAnimationFrame(frame);
}

/** Advances the ring when an orb lands. */
function landOrb(landing, visible) {
  const hold = ringHold;
  if (!hold) return;
  hold.pending--;
  hold.shown = hold.pending === 0 ? hold.target : landing;

  const ring = board.querySelector(".day-summary-ring");
  if (ring) {
    showRing(ring, hold.shown);
    if (visible) {
      ring.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
        { duration: 220, easing: "ease-out" },
      );
    }
  }

  // Keep is-filling, so the keyframe animation does not replay.
  if (hold.pending === 0) {
    ringHold = null;
    lastRingPercent = hold.target;
  }
}

function blockHead(category, habits = []) {
  const head = document.createElement("header");
  head.className = "block-head";

  const title = document.createElement("h2");
  title.className = "block-title";
  if (category) {
    // A button, so the category view is keyboard-accessible.
    const link = document.createElement("button");
    link.type = "button";
    link.className = "block-link";
    link.dataset.role = "open-category";
    const badge = categoryIconBadge(category);
    if (badge) link.append(badge);
    // Separate span, so a long name is truncated without the icon.
    const name = document.createElement("span");
    name.className = "block-link-name";
    name.textContent = category.name;
    link.append(name);
    title.append(link);
  } else {
    title.textContent = t("No category");
  }
  head.append(title);

  // Progress only if enabled for the category; never for uncategorised habits.
  const progress = category?.showProgress === true ? blockProgress(habits) : null;
  if (progress) head.append(progress);

  // Uncategorised habits have no category controls.
  if (category) {
    const tools = document.createElement("div");
    tools.className = "block-tools";
    // Reorder controls only with more than one category.
    if (state.categories.length > 1) {
      if (byDragging()) {
        const grip = toolButton("drag-category", icons.grip, t("Move category"));
        grip.classList.add("drag-handle");
        tools.append(grip);
      } else {
        const at = state.categories.findIndex((c) => c.id === category.id);
        const up = toolButton("move-category-up", icons.chevronUp, t("Move category up"));
        const down = toolButton("move-category-down", icons.chevronDown, t("Move category down"));
        up.disabled = at <= 0;
        down.disabled = at === state.categories.length - 1;
        tools.append(up, down);
      }
    }
    // Renaming and deleting are done in the category view.
    if (tools.childElementCount > 0) head.append(tools);
  }
  return head;
}

function toolButton(role, icon, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-button";
  b.dataset.role = role;
  // Constant markup from icons.js.
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

// ---------- interaction ----------

function onBoardClick(event) {
  if (suppressClick) {
    suppressClick = false;
    clearTimeout(suppressTimer);
    return;
  }
  const el = event.target.closest("[data-role]");
  if (!el) return;
  const section = el.closest(".block");
  const categoryId = section?.dataset.category;

  switch (el.dataset.role) {
    case "open":
      actions.openHabit(el.dataset.habit);
      break;
    case "cell":
      actions.tapEntry(el.dataset.habit, el.dataset.date);
      break;
    case "open-category":
      actions.openCategory(categoryId);
      break;
    case "move-habit-up":
      actions.moveHabit(el.dataset.habit, -1);
      break;
    case "move-habit-down":
      actions.moveHabit(el.dataset.habit, 1);
      break;
    case "move-category-up":
      actions.moveCategory(categoryId, -1);
      break;
    case "move-category-down":
      actions.moveCategory(categoryId, 1);
      break;
    case "page-older":
      showWindow(offset + pageStep(renderedDays));
      break;
    case "page-newer":
      showWindow(offset - pageStep(renderedDays));
      break;
    case "page-today":
      showWindow(0);
      break;
  }
}

function onBoardContextMenu(event) {
  const el = event.target.closest('[data-role="cell"]');
  if (!el || el.disabled) return;
  event.preventDefault();
  actions.editEntry(el.dataset.habit, el.dataset.date);
}

// A long press opens the value dialog. The click that follows is suppressed;
// the flag is reset by a timer, as a long press may end without a click.
let suppressClick = false;
let suppressTimer = null;

function suppressNextClick() {
  suppressClick = true;
  clearTimeout(suppressTimer);
  // Covers the click after release, but not a deliberate second tap.
  suppressTimer = setTimeout(() => { suppressClick = false; }, 700);
}

function attachLongPress(root) {
  let timer = null;
  let origin = null;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    origin = null;
  };

  root.addEventListener("pointerdown", (event) => {
    const el = event.target.closest('[data-role="cell"]');
    if (!el || el.disabled || event.button !== 0) return;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      timer = null;
      suppressNextClick();
      actions.editEntry(el.dataset.habit, el.dataset.date);
    }, LONG_PRESS_MS);
  });

  // Cancel the long press only when the pointer moves beyond a tolerance.
  root.addEventListener("pointermove", (event) => {
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  });

  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    root.addEventListener(type, cancel);
  }
}
