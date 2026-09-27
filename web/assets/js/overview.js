// Overview: one block per category with a row per habit and a column per day.
// All blocks share the same grid, so a single day header aligns with all of
// them.

import {
  addDays, daysBetween, dayOfMonth, monthIndex, yearOf, weekdayIndex, MONTH_LONG, MONTH_SHORT,
  formatLong,
} from "./dates.js";
import { state, subscribe, groupedHabits } from "./state.js";
import * as H from "./habit.js";
import { dayCell, habitLabel, dayEntry } from "./cells.js";
import { icons, categoryIconBadge } from "./icons.js";
import { enableDragReorder } from "./reorder.js";
import { initSummary, dayProgress, daySummary, newlyDone, launchOrbs } from "./summary.js";
import { t } from "./i18n.js";

const LONG_PRESS_MS = 450;

// Number of additional days loaded when paging back beyond the loaded entries.
const PREFETCH_DAYS = 180;

let board;
let emptyState;
let noMatch;
let actions;
/** Floating "back to today" button at the bottom centre of the screen. */
let todayPill;

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

/**
 * The day chosen in the day header, or null for today. Marker, band and day
 * summary refer to it. Not persisted; null follows a change of date.
 */
let selectedDay = null;

/** Returns the active day: the selected one, or today. */
function activeDay() {
  return selectedDay ?? state.today;
}

/** Makes `iso` the active day; today resets the selection. */
function selectDay(iso) {
  const next = iso === state.today ? null : iso;
  if (next === selectedDay) return;
  selectedDay = next;
  render();
}

/** Returns to today: the window and the active day. */
function backToToday() {
  selectedDay = null;
  // showWindow() does not render without a change of the window.
  if (offset === 0) render();
  else showWindow(0);
}

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
  initSummary(board);
  emptyState = document.getElementById("empty-state");
  noMatch = document.getElementById("no-match");
  initFilter();
  initTodayPill();

  board.addEventListener("click", onBoardClick);
  board.addEventListener("contextmenu", onBoardContextMenu);
  attachLongPress(board);

  emptyState.querySelector('[data-action="add-first"]')
    .addEventListener("click", () => actions.createHabit());

  subscribe(render);

  // Drag and drop for both categories and habit rows; the handle determines
  // which list is reordered. Rendering pauses during a drag (see dragging).
  const dragCallbacks = (save) => ({
    onStart: () => { dragging = true; },
    onDrop: (ids) => {
      dragging = false;
      save(ids);
    },
    onCancel: () => {
      dragging = false;
      // Render changes that arrived during the drag.
      render();
    },
  });
  enableDragReorder({
    container: board,
    item: ".block[data-category]",
    handle: '[data-role="drag-category"]',
    key: "category",
    ...dragCallbacks(actions.setCategoryOrder),
  });
  enableDragReorder({
    container: board,
    item: ".habit-row",
    handle: '[data-role="drag-habit"]',
    key: "habit",
    ...dragCallbacks(actions.setHabitOrder),
  });

  // Re-render when the available width changes, including when the view
  // becomes visible again. Observes the container, as the board's own width
  // depends on the day count, and the body, as the other views take their
  // width from the board's (--board-width) while the overview is hidden.
  const observer = new ResizeObserver(() => {
    const width = availableWidth();
    if (width > 0 && visibleDays(width) !== renderedDays) render();
  });
  observer.observe(board.parentElement);
  observer.observe(document.body);
}

/**
 * Returns the available width, measured on the container, as the board's own
 * width depends on the number of columns. While the overview is hidden, the
 * width it would have: the window, up to its maximum width, less its padding.
 * Not measured on the other views, as they are only as wide as the board.
 */
function availableWidth() {
  const parent = board.parentElement;
  if (!parent) return 0;
  const cs = getComputedStyle(parent);
  const outer = parent.hidden
    ? Math.min(document.documentElement.clientWidth, parseFloat(cs.maxWidth) || Infinity)
    : parent.clientWidth;
  return outer - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/** Minimum number of day columns. */
const MIN_DAYS = 7;

/** Returns a size token of <html> in pixels, or 0 if it is not set. */
function token(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/**
 * Returns the width of `width` left for the name and day columns: without the
 * card's padding and border, and without the reorder column (zero without
 * handles; as --tools-track).
 */
function roomForColumns(width) {
  const padX = token("--block-pad-x");
  const tools = token("--tools-col");
  const track = tools > 0 ? tools + padX + 2 : 0;
  const card = 2 * padX + 2;
  return width - track - card;
}

/** Returns the maximum number of day columns that fit into `width`. */
function fittingDays(width) {
  // Same tokens as the grid template; each column has a 2px gap.
  const cell = token("--cell") || 40;
  const labelMin = token("--label-min") || 148;
  return Math.max(3, Math.floor((roomForColumns(width) - labelMin) / (cell + 2)));
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
  const room = roomForColumns(width);

  // The widest cell that leaves the name column its minimum width.
  const widest = Math.floor((room - token("--label-tight-min")) / days) - 2;
  const cell = Math.max(token("--cell-tight-min"), Math.min(token("--cell"), widest));
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

/** Whether only habits due and still open on the active day are shown. Not
 *  persisted. */
let onlyOpen = false;

/**
 * Reports whether a habit passes the filter: with it, only habits due on the
 * active day (as counted by the day summary) and not yet complete.
 */
function matches(habit) {
  if (!onlyOpen) return true;
  const day = activeDay();
  return !habit.archivedAt && H.isScheduled(habit, day) &&
    !H.isComplete(habit, day, habit.entries[day] ?? 0);
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

/** Creates the floating button that returns to today. */
function initTodayPill() {
  todayPill = document.createElement("button");
  todayPill.type = "button";
  todayPill.className = "button today-pill";
  todayPill.hidden = true;
  todayPill.innerHTML = icons.toToday;
  // The label is set in render(), after a change of language.
  todayPill.append(document.createElement("span"));
  todayPill.addEventListener("click", backToToday);
  board.parentElement.append(todayPill);
}

export function render() {
  if (!board || dragging) return;
  todayPill.hidden = offset === 0 && selectedDay === null;
  todayPill.lastChild.textContent = t("Back to today");
  const all = groupedHabits();
  // Blocks keep all habits for the progress bar, plus the filtered habits for
  // the rows.
  const blocks = all
    .map((b) => ({ ...b, visible: b.habits.filter(matches) }))
    .filter((b) => !onlyOpen || b.visible.length > 0);

  // Reordering is disabled while filtering, as the order would be incomplete.
  document.documentElement.dataset.filtering = onlyOpen ? "on" : "off";
  emptyState.hidden = all.length > 0;
  noMatch.hidden = !(onlyOpen && blocks.length === 0);
  // With habits, the board is shown even when the filter leaves no block, so
  // the day header stays available for choosing another day.
  board.hidden = all.length === 0;
  if (all.length === 0) {
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

  // Column of the active day for the band; -1 if not visible.
  const active = activeDay();
  const todayColumn = dates.indexOf(active);
  board.classList.toggle("has-today", todayColumn >= 0);
  if (todayColumn >= 0) board.style.setProperty("--today-col", String(todayColumn));

  // A single uncategorised block is shown without heading.
  const labelled = all.length > 1 || all[0].category !== null;

  // Determine newly completed habits from the old board, for the orb animation.
  const everyHabit = all.flatMap((b) => b.habits);
  const flights = newlyDone(everyHabit, active);

  const frag = document.createDocumentFragment();
  frag.append(dayHeader(dates, active), daySummary(everyHabit, active));
  for (const block of blocks) frag.append(renderBlock(block, dates, labelled, active));

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
function dayHeader(dates, active) {
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
    const cell = dayCell(iso, { active, selectable: true });
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
  // Back to today is the floating button (todayPill).
  nav.append(older, newer);
  return nav;
}

/** Builds the name cell of a row. */
function nameCell(habit) {
  const cell = document.createElement("div");
  cell.className = "habit-cell";
  cell.append(habitLabel(habit));
  return cell;
}

function renderBlock({ category, habits, visible }, dates, labelled, active) {
  const rows = visible ?? habits;
  const section = document.createElement("section");
  section.className = "block";
  if (category) section.dataset.category = category.id;
  // The heading counts all habits of the category, the rows show the filtered.
  if (labelled) section.append(blockHead(category, habits, active));

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
      nameCell(habit),
      ...dates.map((iso) => dayEntry(habit, iso, active)),
      habitTools(habit, habits),
    );
    list.append(row);
  }
  section.append(list);
  return section;
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

/** Builds a category's progress bar for `day`. */
function blockProgress(habits, day) {
  const { due, done } = dayProgress(habits, day);
  // No bar if nothing is due on the day.
  if (due === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "block-progress";
  wrap.title = `${formatLong(day)}: ${t("{done} of {due} done", { done, due })}`;

  const count = document.createElement("span");
  count.className = "block-progress-count";
  count.textContent = `${done}/${due}`;

  // One segment per habit due on the day, followed by the count.
  const track = document.createElement("span");
  track.className = "block-progress-track";
  track.style.setProperty("--segments", String(due));
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(due));
  track.setAttribute("aria-valuenow", String(done));
  track.setAttribute("aria-label", t("Done on this day"));
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


function blockHead(category, habits = [], day = state.today) {
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
  const progress = category?.showProgress === true ? blockProgress(habits, day) : null;
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
    case "open-days":
      actions.openDays();
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
    case "select-day":
      selectDay(el.dataset.date);
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
