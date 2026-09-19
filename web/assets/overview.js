// The main screen: habits grouped into one block per category, each block a row
// per habit and a column per day, Loop-style.
//
// The day header is rendered once for the whole board rather than once per
// block. Every block uses the same grid template and the same box padding, so
// the columns stay aligned across blocks without any measuring.

import {
  addDays, dayOfMonth, monthIndex, yearOf, weekdayIndex, MONTH_LONG, MONTH_SHORT,
} from "./dates.js";
import { state, subscribe, groupedHabits } from "./state.js";
import * as H from "./habit.js";
import { dayCell, habitLabel, dayEntry } from "./cells.js";
import { icons } from "./icons.js";
import { enableDragReorder } from "./reorder.js";

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
  const fits = fittingDays(width);
  const wanted = state.settings?.overviewDays ?? 0;
  // Automatic means every day that fits — the shell width is the only cap, and
  // it already keeps the row from running the full width of a large monitor.
  return wanted > 0 ? Math.min(wanted, fits) : fits;
}

/** What the board is currently drawing, for the settings dialog to report. */
export function currentDays() {
  return renderedDays;
}

/**
 * Moves the window to `next` days before today, clamped at the horizon ahead.
 *
 * Entries arrive in a window around today, so paging far enough back leaves it.
 * The missing history is fetched before the move is drawn: rendering first
 * would show days as untouched that only look untouched because their entries
 * have not been loaded yet. Ahead of today there is nothing to fetch — the
 * state carries every entry from its start date onwards, however far out.
 */
async function showWindow(next) {
  const wanted = Math.max(-MAX_AHEAD_DAYS, next);
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
 * What the board is filtered by right now.
 *
 * Deliberately not stored: a filter is something one looks through and then
 * puts down again. Surviving a reload it would eventually be mistaken for the
 * habits one has left.
 */
let query = "";
let onlyOpen = false;

const filtering = () => query !== "" || onlyOpen;

/** Whether a habit survives the current filter. */
function matches(habit, categoryName) {
  if (onlyOpen && H.isComplete(habit, habit.entries[state.today] ?? 0)) return false;
  if (query === "") return true;
  // The category name counts too: typing "Sport" should find the block as
  // readily as the habit.
  return `${habit.name} ${categoryName ?? ""}`.toLowerCase().includes(query);
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
 * The search field and the filter button in the title bar.
 *
 * Wired once; everything they change goes through render(), which is the only
 * place that decides what the board shows. Neither needs a "clear" of its own:
 * the button is a toggle, and a search field empties with the control the
 * browser puts in it.
 */
function initFilter() {
  const search = document.getElementById("habit-search");
  const openOnly = document.getElementById("filter-open");
  openOnly.innerHTML = icons.filter;

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  openOnly.addEventListener("click", () => {
    onlyOpen = !onlyOpen;
    openOnly.setAttribute("aria-pressed", String(onlyOpen));
    render();
  });

  // On a bar too narrow for it the stylesheet hides the field. A search typed
  // before that - by turning a phone upright, say - would go on filtering the
  // board with nothing on screen to say why, so it is dropped when the field
  // goes. Watching the bar rather than the window: what hides the field is the
  // bar's own width, and the bar is only as wide as the board.
  new ResizeObserver(() => {
    if (query && search.getClientRects().length === 0) {
      search.value = "";
      query = "";
      render();
    }
  }).observe(document.querySelector(".topbar-inner"));
}

export function render() {
  if (!board || dragging) return;
  const all = groupedHabits();
  // Every block keeps its full list for the progress bar - a filter changes
  // what one looks at, not what the day asked for - and carries the surviving
  // habits separately for the rows.
  const blocks = all
    .map((b) => ({ ...b, visible: b.habits.filter((h) => matches(h, b.category?.name)) }))
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

  const frag = document.createDocumentFragment();
  frag.append(dayHeader(dates));
  for (const block of blocks) frag.append(renderBlock(block, dates, labelled));

  const focused = focusedControl();
  board.replaceChildren(frag);
  restoreFocus(focused);
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

  const older = toolButton("page-older", icons.chevronLeft, "Earlier days");
  const newer = toolButton("page-newer", icons.chevronRight, "Later days");
  // The forward arrow stops at the horizon rather than disappearing, so the row
  // does not jump about.
  newer.disabled = offset <= -MAX_AHEAD_DAYS;
  nav.append(older, newer);

  if (offset !== 0) {
    nav.append(toolButton("page-today", icons.toToday, "Back to today"));
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
    empty.textContent = "No habit in this category yet.";
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
    const grip = toolButton("drag-habit", icons.grip, "Move habit");
    grip.classList.add("drag-handle");
    grip.dataset.habit = habit.id;
    tools.append(grip);
  } else {
    const at = siblings.indexOf(habit);
    const up = toolButton("move-habit-up", icons.chevronUp, "Move habit up");
    const down = toolButton("move-habit-down", icons.chevronDown, "Move habit down");
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
  wrap.title = `${done} of ${due} done today`;

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
  track.setAttribute("aria-label", "Done today");
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
    link.textContent = category.name;
    title.append(link);
  } else {
    title.textContent = "No category";
  }
  head.append(title);

  const progress = blockProgress(habits);
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
        const grip = toolButton("drag-category", icons.grip, "Move category");
        grip.classList.add("drag-handle");
        tools.append(grip);
      } else {
        const at = state.categories.findIndex((c) => c.id === category.id);
        const up = toolButton("move-category-up", icons.chevronUp, "Move category up");
        const down = toolButton("move-category-down", icons.chevronDown, "Move category down");
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
