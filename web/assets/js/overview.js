// The main screen: habits grouped into one block per category, each block a row
// per habit and a column per day, Loop-style.
//
// The day header is rendered once for the whole board rather than once per
// block. Every block uses the same grid template and the same box padding, so
// the columns stay aligned across blocks without any measuring.

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

// How much history to pull in beyond the page being opened. Fetching exactly
// the page asked for would mean one request per click; half a year at a time
// means the button can be clicked repeatedly without waiting again.
const PREFETCH_DAYS = 180;

let board;
let emptyState;
let noMatch;
let actions;

/** Which controls the board offers for changing an order. */
const byDragging = () => (state.settings?.reorderMode ?? "drag") === "drag";

/** The column count the board currently shows, to avoid pointless re-renders. */
let renderedDays = 0;

/**
 * How far ahead of today the board may be paged, matching the horizon the
 * server accepts entries for. Far enough to plan a season, close enough that
 * the board cannot wander off into an empty decade.
 */
const MAX_AHEAD_DAYS = 365;

/**
 * How many days the board is shifted into the past. 0 means it ends today, and
 * a negative offset looks ahead: days that have not happened yet can be filled
 * in beforehand.
 *
 * The window is anchored at its right edge, so resizing the browser adds or
 * removes columns on the left and the day the user was looking at stays put.
 */
let offset = 0;

/** The last day the board shows, before the week alignment has its say. */
function windowEnd() {
  return addDays(state.today, -offset);
}

/**
 * The first day the board shows, for a window of `days` columns.
 *
 * Normally the window simply ends on `windowEnd()`. With the week alignment on,
 * the start moves forward to the next Monday, which turns the board into whole
 * calendar weeks: the current week is shown in full, including the days still
 * ahead. Moving forward rather than back is what keeps today on the board -
 * rounding the other way would end the window on the Sunday just gone.
 *
 * Below seven columns there is no Monday-aligned window that is sure to hold
 * today, so the alignment steps aside rather than paging the board away from
 * the day the user is looking for.
 */
function windowStart(days) {
  const plain = addDays(windowEnd(), -(days - 1));
  if (!alignsWeeks(days)) return plain;
  const weekday = weekdayIndex(plain);
  return weekday === 0 ? plain : addDays(plain, 7 - weekday);
}

/** Whether the board lines its columns up with calendar weeks right now. */
function alignsWeeks(days) {
  return (state.settings?.alignWeeks ?? false) && days >= 7;
}

/**
 * How far one press of the paging arrows moves the board.
 *
 * Whole weeks while the columns are aligned - a step of, say, ten days would
 * land the window on a Thursday and undo the alignment on the next render.
 */
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

  // Two lists on one board: blocks among blocks, rows among the rows of their
  // own block. Both hang off the same container; which one a drag belongs to
  // follows from the handle it started on.
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
      // Whatever the state picked up while the board was frozen gets drawn now.
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

  // The column count follows the available width, so the board is re-rendered
  // whenever that width changes. A ResizeObserver rather than a window resize
  // listener: it also fires when the view becomes visible again after the
  // detail view closes, which is exactly the moment a measurement taken a tick
  // earlier would still have been wrong. It watches the container rather than
  // the board, because the board resizes itself when the day count changes.
  new ResizeObserver(() => {
    const width = availableWidth();
    if (width > 0 && visibleDays(width) !== renderedDays) render();
  }).observe(board.parentElement);
}

/**
 * The width the board has to work with.
 *
 * Measured on the container, not on the board itself: with an explicit day
 * count the board shrinks to its content, so measuring it would feed its own
 * output back in and the column count would collapse step by step.
 */
function availableWidth() {
  const parent = board.parentElement;
  if (!parent) return 0;
  const cs = getComputedStyle(parent);
  return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/** The most day columns that fit next to the habit names at this width. */
function fittingDays(width) {
  const styles = getComputedStyle(document.documentElement);
  const cell = parseFloat(styles.getPropertyValue("--cell")) || 40;
  // The same tokens the grid template uses, so the two can never drift apart.
  const labelMin = parseFloat(styles.getPropertyValue("--label-min")) || 148;
  const padX = parseFloat(styles.getPropertyValue("--block-pad-x")) || 0;
  const tools = parseFloat(styles.getPropertyValue("--tools-col")) || 0;
  // The same sum as --tools-track, and zero when there are no handles at all.
  const track = tools > 0 ? tools + padX + 2 : 0;
  // What the card itself takes on both sides: its padding and its border.
  const card = 2 * padX + 2;
  return Math.max(3, Math.floor((width - labelMin - track - card) / (cell + 2)));
}

/**
 * How many day columns to draw.
 *
 * The setting is a wish, not a guarantee: 30 columns cannot be drawn on a
 * phone, so the number is capped by what fits and the settings dialog says so
 * rather than the board silently clipping. Automatic mode stops at three weeks
 * — beyond that a very wide window turns the board into a wall of circles
 * nobody asked for.
 */
function visibleDays(width) {
  // Measured at the board's own sizes, before any tightening from last time.
  loosen();
  const fits = fittingDays(width);
  const wanted = state.settings?.overviewDays ?? 0;
  // Automatic means every day that fits — the shell width is the only cap, and
  // it already keeps the row from running the full width of a large monitor.
  const days = wanted > 0 ? Math.min(wanted, fits) : fits;
  // A week is the least: a board that cannot show one at its usual sizes is
  // drawn tighter instead. A fixed count below seven is a choice and stays.
  const least = wanted > 0 ? Math.min(wanted, MIN_DAYS) : MIN_DAYS;
  if (days >= least) return days;
  tighten(width, least);
  return least;
}

/** The fewest day columns the board shows, however narrow the window. */
const MIN_DAYS = 7;

/** Takes a tightened board back to its usual sizes. */
function loosen() {
  const root = document.documentElement;
  if (!root.hasAttribute("data-tight")) return;
  root.removeAttribute("data-tight");
  root.style.removeProperty("--cell");
  root.style.removeProperty("--label-min");
}

/**
 * Narrows the board until `days` columns fit into `width`.
 *
 * The day columns give first, down to --cell-tight-min, so the names keep as
 * much room as there is; the name column takes whatever is left, and never
 * less than --label-tight-min. data-tight takes the icons out of the rows and
 * steps the type down (components.css), which is what lets a name column that
 * narrow still read.
 *
 * Written onto <html> as inline tokens rather than into the grid alone, so
 * every rule that sizes itself from --cell and --label-min - the header, the
 * today band, the board width - moves with it, and fittingDays() stays the one
 * sum that decides.
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
  // The widest cell that still leaves the name column its floor. Past the
  // cell's own floor the name column gives way after all: a week is the point.
  const cell = Math.max(cellFloor, Math.min(cellUsual, Math.floor((room - labelFloor) / days) - 2));
  const label = Math.max(0, Math.floor(room - days * (cell + 2)));

  root.style.setProperty("--cell", `${cell}px`);
  root.style.setProperty("--label-min", `${label}px`);
}

/** What the board is currently drawing, for the settings dialog to report. */
export function currentDays() {
  return renderedDays;
}

/**
 * The largest offset that still starts the board on or after the first day the
 * server takes an entry for (`earliestEntry`). Week alignment only ever moves
 * the start forward, so the plain window is the one to measure.
 */
function maxBackDays() {
  if (!state.earliestEntry) return Infinity;
  return Math.max(0, daysBetween(state.earliestEntry, state.today) - (renderedDays - 1));
}

/**
 * Moves the window to `next` days before today, clamped at the horizon ahead
 * and at the earliest day behind.
 *
 * Entries arrive in a window around today, so paging far enough back leaves it.
 * The missing history is fetched before the move is drawn: rendering first
 * would show days as untouched that only look untouched because their entries
 * have not been loaded yet. Ahead of today there is nothing to fetch — the
 * state carries every entry from its start date onwards, however far out.
 */
async function showWindow(next) {
  const wanted = Math.min(maxBackDays(), Math.max(-MAX_AHEAD_DAYS, next));
  if (wanted === offset) return;
  offset = wanted;

  const start = windowStart(renderedDays);
  // ISO dates compare correctly as strings, so this needs no parsing.
  if (state.entriesFrom && start < state.entriesFrom) {
    await actions.extendHistory(addDays(start, -PREFETCH_DAYS));
  }
  render();
}

/**
 * Whether the board shows only what is still open today.
 *
 * Deliberately not stored: a filter is something one looks through and then
 * puts down again. Surviving a reload it would eventually be mistaken for the
 * habits one has left. Searching is not a filter here: the search dialog jumps
 * to a habit rather than narrowing the board.
 */
let onlyOpen = false;

const filtering = () => onlyOpen;

/** Whether a habit survives the current filter. */
function matches(habit) {
  return !(onlyOpen && H.isComplete(habit, habit.entries[state.today] ?? 0));
}

/**
 * True while a block is being dragged.
 *
 * The board is rebuilt from scratch on every state change, which would throw
 * away the element under the pointer mid-drag. Anything that arrives during a
 * drag is drawn when it ends.
 */
let dragging = false;

/**
 * The filter button in the title bar.
 *
 * Wired once; what it changes goes through render(), which is the only place
 * that decides what the board shows. It needs no "clear" of its own: it is a
 * toggle.
 */
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
  // Every block keeps its full list for the progress bar - a filter changes
  // what one looks at, not what the day asked for - and carries the surviving
  // habits separately for the rows.
  const blocks = all
    .map((b) => ({ ...b, visible: b.habits.filter(matches) }))
    .filter((b) => !filtering() || b.visible.length > 0);

  // Reordering while a filter is on would send the server an order with the
  // hidden habits missing from it, so the handles step aside for as long as the
  // board is showing only part of itself.
  document.documentElement.dataset.filtering = filtering() ? "on" : "off";
  emptyState.hidden = all.length > 0;
  noMatch.hidden = !(filtering() && blocks.length === 0);
  board.hidden = blocks.length === 0;
  if (blocks.length === 0) {
    board.replaceChildren();
    renderedDays = 0;
    return;
  }

  // A hidden view measures as zero wide. Guessing from the body instead would
  // over-count the columns and clip the newest days off the right edge, so
  // rendering waits for the ResizeObserver to report a real width.
  const width = availableWidth();
  if (width === 0) return;

  const days = visibleDays(width);
  renderedDays = days;
  // On the root element, not on the board: the header sizes itself from the
  // same number, and it is not a descendant of the board.
  document.documentElement.style.setProperty("--days", String(days));

  // Left to right in time, from the first column the window starts on.
  const start = windowStart(days);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));

  // Which column today sits in, for the band the stylesheet draws through the
  // cards. Paged far enough away there is no such column, and the band goes.
  const todayColumn = dates.indexOf(state.today);
  board.classList.toggle("has-today", todayColumn >= 0);
  if (todayColumn >= 0) board.style.setProperty("--today-col", String(todayColumn));

  // With a single unnamed group the board is one plain block: no headings, the
  // same look the app had before categories existed.
  const labelled = all.length > 1 || all[0].category !== null;

  // Read off the board that is about to be thrown away: where the habits that
  // were just ticked off sit, and whether the ring is there to fly to.
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
 * Which control inside the board has the keyboard focus, as a description
 * rather than a reference.
 *
 * The board is rebuilt from scratch on every render, so the element itself is
 * about to be thrown away. Without this, moving a category twice in a row means
 * hunting for the arrow again: it has travelled with its block, and the button
 * under the pointer is a different one.
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
  // Not the disabled end-stop: focusing it would trap the keyboard on a button
  // that no longer does anything.
  if (next && !next.disabled) next.focus();
}

/**
 * Two rows on one grid: the month names on top, the weekday and day number
 * below. Sharing a single grid is what keeps a month label sitting exactly over
 * the days it covers; every child is placed explicitly, so nothing depends on
 * how the browser would auto-fill a two-row grid.
 */
function dayHeader(dates) {
  const el = document.createElement("div");
  el.className = "day-header";

  // The page behind the header while it is parked: an element rather than a
  // pseudo-element, because over a picture it has to hold a fixed layer of its
  // own and clip it - which takes two boxes. Absolutely positioned, so it
  // takes no cell in the grid.
  const backdrop = document.createElement("div");
  backdrop.className = "day-header-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  el.append(backdrop);

  // The cell above the habit names carries the paging controls: they belong to
  // the day columns, and this is the one spot in the row with no date in it.
  // On the date row, not spanning both: the arrows belong with the days, and
  // straddling the month row above would leave them sitting higher than the
  // dates they page through.
  const nav = dayNav();
  nav.style.gridColumn = "1";
  nav.style.gridRow = "2";
  el.append(nav);

  for (const label of monthLabels(dates)) el.append(label);

  dates.forEach((iso, i) => {
    const cell = dayCell(iso);
    // The month divider is drawn on both rows of the header — on the label
    // above and on this column — so the one line runs from the month name down
    // past the date. Same rule as the labels: the leftmost column has the
    // board's own edge to its left and needs none.
    if (i > 0 && dayOfMonth(iso) === 1) cell.classList.add("is-month-start");
    // Column 1 is the habit names, so the days start at 2.
    cell.style.gridColumn = String(i + 2);
    cell.style.gridRow = "2";
    el.append(cell);
  });
  return el;
}

/** One label per run of days in the same month, spanning that run's columns. */
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
    // The year is worth the room only when it is not the current one, which
    // happens as soon as the board is paged back across New Year.
    const suffix = year === yearOf(state.today) ? "" : ` ${year}`;

    const el = document.createElement("div");
    el.className = "month-label";
    // A run of two or three columns cannot hold "September". It still has to
    // say which month it is, so it falls back to the abbreviation rather than
    // to an ellipsis.
    el.textContent = (span >= 5 ? MONTH_LONG[month] : MONTH_SHORT[month]) + suffix;
    el.title = `${MONTH_LONG[month]} ${year}`;
    el.style.gridColumn = `${start + 2} / span ${span}`;
    el.style.gridRow = "1";
    // The divider marks where one month ends and the next begins; the leftmost
    // label has the board's own edge to its left and needs none.
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
  // The forward arrow stops at the horizon rather than disappearing, so the row
  // does not jump about.
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
  // The heading counts the whole category, the rows show what is left of it.
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
 * The name column of one row: the label, plus the two arrows that move the
 * habit inside its block.
 *
 * The arrows lie over the right end of the label rather than beside it. The
 * column is barely wide enough for the second line as it is, and a pair of
 * buttons in the flow would cost it another fifty pixels on every row — while
 * these are only visible when the row is touched.
 */
function habitCell(habit) {
  const cell = document.createElement("div");
  cell.className = "habit-cell";
  cell.append(habitLabel(habit));
  return cell;
}

/**
 * The controls in the row's last column: a handle to drag by, or a pair of
 * arrows, depending on the setting.
 *
 * Always rendered, even where there is nothing to reorder, so that the column
 * holds its width and the day cells of every row stay in line.
 */
function habitTools(habit, siblings) {
  const tools = document.createElement("div");
  tools.className = "habit-tools";
  // A block with one habit has no order to change.
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

/**
 * How much of a block is done today: complete of scheduled.
 *
 * Only what is due today counts. A habit that is not scheduled cannot be
 * missing, and counting it would make Monday's three-of-five look like a worse
 * day than Sunday's nothing-of-nothing.
 */
function todayProgress(habits) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, state.today));
  const done = due.filter((h) => H.isComplete(h, h.entries[state.today] ?? 0));
  return { due: due.length, done: done.length };
}

function blockProgress(habits) {
  const { due, done } = todayProgress(habits);
  // Nothing due today: no bar rather than an empty one, which would read as
  // "nothing done" instead of "nothing to do".
  if (due === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "block-progress";
  wrap.title = t("{done} of {due} done today", { done, due });

  const count = document.createElement("span");
  count.className = "block-progress-count";
  count.textContent = `${done}/${due}`;

  // One segment per habit due today: the bar is then countable at a glance,
  // which a single filled stripe is not. The count still follows it, because
  // past a handful of segments counting stops being quicker than reading.
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
 * The card under the day header: today spelled out, how much of it is done,
 * and the same as a ring.
 *
 * Always today, wherever the board has been paged to - it answers "how is my
 * day going", not "what am I looking at". And always every habit, filter or
 * not, for the same reason the block headings ignore the filter.
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
    // Everything due today is done: said as an occasion rather than as a
    // count, in the colour that means done.
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

  // No ring on a day with nothing due: an empty one would read as "nothing
  // done", a full one as an achievement nobody made.
  if (due > 0) el.append(progressRing(percent));
  return el;
}

/**
 * What the day card says once everything due is done. One line a day, picked
 * by the date rather than at random, so a redraw after an unrelated change does
 * not swap it for another.
 */
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

// The ring's geometry, in viewBox units (0 0 40 40). The wave swings this far
// either side of the radius, this many times around - a whole number, so the
// line meets itself at twelve o'clock without a kink.
const RING_R = 15.5;
const RING_WAVE = 0.9;
const RING_WAVES = 16;

/**
 * The wavy line the progress is drawn along: a circle whose radius swings
 * around RING_R, starting at twelve o'clock and running clockwise.
 *
 * Computed once. A couple of hundred points are plenty at this size, and the
 * stroke's round joins smooth over what is left of the corners.
 */
const WAVY_RING_PATH = (() => {
  const steps = 240;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const r = RING_R + RING_WAVE * Math.sin(RING_WAVES * t);
    // -π/2 puts the start at the top; x and y grow clockwise from there.
    const x = 20 + r * Math.cos(t - Math.PI / 2);
    const y = 20 + r * Math.sin(t - Math.PI / 2);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
})();

/**
 * What the ring showed at the last render.
 *
 * The board is rebuilt from scratch on every change, so the ring is a new
 * element each time. Starting it at the previous value and letting it move to
 * the new one is what makes a tick visibly push the wave on, instead of the
 * ring simply appearing at its new length - or replaying from zero on every tap.
 */
let lastRingPercent = null;

/**
 * A wavy line winding around a plain ring, as far as `percent`, with the number
 * in its middle.
 *
 * pathLength="100" lets the dash pattern be written in percent directly: the
 * wave is a good deal longer than the circle it follows, and this way nobody
 * has to know by how much.
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

  // Orbs on their way: the ring holds at what it showed and is moved on by
  // each one as it lands, instead of winding to the new value on its own.
  if (ringHold) {
    ringHold.target = percent;
    fill.classList.add("is-filling");
    showRing(ring, ringHold.shown);
    return ring;
  }

  // A keyframe animation rather than a transition: it runs from the moment the
  // new element reaches the page, with no frame to wait for in between.
  const from = lastRingPercent ?? 0;
  lastRingPercent = percent;
  fill.style.setProperty("--from", String(from));
  fill.style.setProperty("--to", String(percent));
  // A round cap on a zero-length dash still draws a dot at twelve o'clock, so
  // an empty ring fades the line out rather than leaving that dot behind.
  fill.style.setProperty("--from-opacity", from === 0 ? "0" : "1");
  fill.classList.toggle("is-empty", percent === 0);
  label.textContent = `${percent}%`;
  return ring;
}

/** Sets a ring to `percent` in place, without building it anew. */
function showRing(ring, percent) {
  const fill = ring.querySelector(".day-summary-ring-fill");
  fill.style.setProperty("--to", String(percent));
  fill.classList.toggle("is-empty", percent === 0);
  ring.querySelector(".day-summary-percent").textContent = `${Math.round(percent)}%`;
}

// ---------- ticking off: orbs into the ring ----------

/**
 * The ring while orbs are flying into it, or null.
 *
 * `shown` is what the ring displays, `planned` where the last orb launched will
 * leave it, `target` the real value of the day, and `pending` the orbs still in
 * the air. Kept outside the ring, because the ring is rebuilt on every render
 * and the second render of a tap - the server's answer - lands mid-flight.
 */
let ringHold = null;

/** Which habits were complete for today at the last render, and on which day. */
let lastDone = null;
let lastDoneDay = null;

const ORBS_PER_HABIT = 6;

/**
 * The habits that became complete for today since the last render, each with
 * the spot on the old board it was ticked at.
 *
 * Found by comparing rather than told by the tap, so a value typed into the
 * dialog or a count that reaches its target fly just the same. The first
 * render and a new day compare against nothing, and send nothing flying.
 */
function newlyDone(habits) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, state.today));
  const done = new Set(due.filter((h) => H.isComplete(h, h.entries[state.today] ?? 0)).map((h) => h.id));
  const before = lastDoneDay === state.today ? lastDone : null;
  lastDone = done;
  lastDoneDay = state.today;
  // A hidden page draws no frames, and orbs launched there would hold the ring
  // back until it is shown again.
  if (!before || prefersReducedMotion() || document.hidden) return [];

  const fresh = due.filter((h) => done.has(h.id) && !before.has(h.id));
  // Scrolled away the ring still fills up; the orbs then go out at the top of
  // the visible board (flyOrb).
  if (fresh.length === 0 || !board.querySelector(".day-summary-ring")) return [];

  const flights = [];
  for (const habit of fresh) {
    const cell = board.querySelector(
      `.cell[data-habit="${habit.id}"][data-date="${state.today}"] .mark`);
    const rect = cell?.getBoundingClientRect();
    // Not on the board (paged away, hidden view): nothing to fly from.
    if (!rect || rect.width === 0) continue;
    flights.push({ color: habit.color, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }
  if (flights.length === 0) return [];

  // Hold the ring where it stands; the render about to happen draws it there.
  const shown = ringHold?.shown ?? lastRingPercent ?? 0;
  ringHold ??= { shown, planned: shown, target: shown, pending: 0 };
  return flights;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Where on the screen the ring's wave stands at `percent`, or null. */
function ringPoint(percent) {
  const ring = board.querySelector(".day-summary-ring");
  const r = ring?.getBoundingClientRect();
  if (!r || r.width === 0) return null;
  // The same radius the wave winds around, scaled from the 40-unit viewBox.
  const radius = (r.width / 40) * RING_R;
  const angle = (percent / 100) * 2 * Math.PI - Math.PI / 2;
  return {
    x: r.left + r.width / 2 + radius * Math.cos(angle),
    y: r.top + r.height / 2 + radius * Math.sin(angle),
  };
}

/**
 * Where the visible part of the board begins: below the title bar and the day
 * header, which stay parked at the top while the page scrolls underneath.
 */
function visibleTop() {
  let top = 0;
  for (const el of [document.querySelector(".topbar"), board.querySelector(".day-header")]) {
    if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
  }
  return top;
}

/** A short glow where an orb leaves the screen on its way to a hidden ring. */
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

/** The layer the orbs fly in, above the board and below any dialog. */
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
 * Sends a handful of orbs in the habit's colour from its cell to the ring.
 *
 * Each orb is aimed at the tip of the wave as it will stand when that orb
 * arrives, and moves it there on landing - so the ring fills up orb by orb,
 * the last one bringing it to the day's real value.
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
      // Which way the path bows, and how far: every orb takes its own curve.
      bend: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3),
    });
  }
}

function flyOrb(orb, { x, y, size, landing, delay, duration, bend }) {
  let start = null;

  const frame = (now) => {
    start ??= now + delay;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    // The ring is looked up every frame: a render mid-flight replaces it, and
    // the page may have scrolled since the orb set off.
    const end = ringPoint(landing);
    if (!end) {
      orb.remove();
      landOrb(landing, false);
      return;
    }
    // Scrolled away, the ring sits behind the parked day header or above the
    // screen. The orbs then head for the top of what can be seen, straight
    // below the ring, and go out there with a flash instead.
    const edge = visibleTop();
    const hidden = end.y < edge;
    if (hidden) end.y = edge;

    // A quadratic curve bowed sideways from the straight line, and a little
    // upwards, so the orbs fan out rather than queueing on one track.
    const dx = end.x - x;
    const dy = end.y - y;
    const cx = x + dx / 2 - dy * bend;
    const cy = y + dy / 2 + dx * bend - Math.hypot(dx, dy) * 0.15;
    // Slow off the mark, then drawn in faster and faster.
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * x + 2 * u * e * cx + e * e * end.x;
    let py = u * u * y + 2 * u * e * cy + e * e * end.y;
    // The upward bow would otherwise carry an orb across the header on its way.
    if (hidden) py = Math.max(py, edge);
    // Pops up at the cell, shrinks into the line it joins.
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

/** One orb has arrived: the ring moves on to where it was aimed. */
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

  // The ring keeps its is-filling class: taking it off would hand the fill back
  // to the keyframe animation, which would play once more from a stale start.
  // The next render builds a plain ring at this value anyway.
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
    // A button, not a heading with a click handler: the category screen is a
    // place one navigates to, and the keyboard has to be able to get there.
    const link = document.createElement("button");
    link.type = "button";
    link.className = "block-link";
    link.dataset.role = "open-category";
    const badge = categoryIconBadge(category);
    if (badge) link.append(badge);
    // In a span of its own, so a long name truncates without the icon.
    const name = document.createElement("span");
    name.className = "block-link-name";
    name.textContent = category.name;
    link.append(name);
    title.append(link);
  } else {
    title.textContent = t("No category");
  }
  head.append(title);

  // Bar and count only where a category has switched them on. The leftover
  // block has no settings, so it keeps to the default and shows none.
  const progress = category?.showProgress === true ? blockProgress(habits) : null;
  if (progress) head.append(progress);

  // The leftover block is not a real category, so it has nothing to rename,
  // move or delete.
  if (category) {
    const tools = document.createElement("div");
    tools.className = "block-tools";
    // A single category has nowhere to go, so the arrows stay away entirely
    // rather than sitting there greyed out.
    // Which control appears is a setting: a handle to drag by, or a pair of
    // arrows that step one place at a time.
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
    // Renaming and deleting live on the category screen, one click away through
    // the title: a card heading is not the place for the destructive pair.
    if (tools.childElementCount > 0) head.append(tools);
  }
  return head;
}

function toolButton(role, icon, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-button";
  b.dataset.role = role;
  // Constant markup from icons.js, never user input.
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

// A long press opens the exact-value dialog. Tapping is the fast path for
// "+1 glass"; holding is how you correct a value without tapping seven times.
//
// The flag is cleared on a timer rather than only by the click it is waiting
// for. A long press that ends outside the cell — the dialog takes the pointer,
// the finger slides off — produces no click at all, and a flag left standing
// would swallow the next tap anywhere on the board instead.
let suppressClick = false;
let suppressTimer = null;

function suppressNextClick() {
  suppressClick = true;
  clearTimeout(suppressTimer);
  // Long enough to cover the click that follows the release, short enough that
  // no deliberate second tap can land inside it.
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

  // Only a real drag cancels the press; a touch always jitters by a pixel or
  // two, and cancelling on that would make long-press unusable on a phone.
  root.addEventListener("pointermove", (event) => {
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  });

  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    root.addEventListener(type, cancel);
  }
}
