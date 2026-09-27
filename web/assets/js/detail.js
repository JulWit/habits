// Habit detail view: statistics, activity chart and calendar heatmap.

import {
  addDays, startOfWeek, daysBetween, MONTH_SHORT, MONTH_LONG, monthIndex, dayOfMonth,
  formatFull, formatLong, formatDayMonth, localISO,
} from "./dates.js";
import { t, locale, userTimeZone } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge } from "./icons.js";
import { appBar } from "./appbar.js";
import { statRow, factsPanel, factItem } from "./panels.js";
import { showTooltip, hideTooltip } from "./tooltip.js";

let root;
let actions;

export function initDetail(handlers) {
  actions = handlers;
  root = document.getElementById("view-detail");
  root.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const id = root.dataset.habit;
    switch (el.dataset.action) {
      case "back": actions.closeHabit(); break;
      case "edit": actions.editHabit(id); break;
      case "archive": actions.toggleArchive(id); break;
      case "delete": actions.deleteHabit(id); break;
    }
  });
  initTooltip(root);
}

export function renderDetail(habit) {
  if (!root || !habit) return;
  // The tooltip's target is about to be replaced.
  hideTooltip();
  root.dataset.habit = habit.id;
  root.style.setProperty("--habit-color", habit.color);
  // The cumulative chart is only shown for countable habits.
  const panels = [header(habit), stats(habit), details(habit), activity(habit), heatmap(habit)];
  if (H.isCountable(habit)) panels.push(cumulative(habit));
  root.replaceChildren(...panels);
  showNewest(root);
  showToday(root);
}

/** Scrolls the year grid so that today's column is centred, if it overflows. */
function showToday(panel) {
  const scroller = panel.querySelector(".heatmap-scroll");
  const cell = scroller?.querySelector(".heat.is-today");
  if (!cell) return;
  const box = scroller.getBoundingClientRect();
  const at = cell.getBoundingClientRect();
  scroller.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
}

/**
 * The view's title bar: back, name, edit, and the overflow menu with archive
 * and delete. Frequency and target are in the details panel.
 */
function header(habit) {
  const archived = habit.archivedAt != null;

  // Without an icon, a dot in the habit's colour.
  let badge = habitIconBadge(habit, "habit-icon");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "dot";
  }

  return appBar({
    title: habit.name,
    badge,
    menu: [
      archived
        ? { action: "archive", label: t("Reactivate"), icon: "unarchive" }
        : { action: "archive", label: t("Archive", { context: "verb" }), icon: "archive" },
      { action: "delete", label: t("Delete"), icon: "trash", danger: true },
    ],
  });
}

/** Formats a streak with its unit: "1 day", "6 days", "1 week". */
function streakText(count, unit) {
  if (unit === "weeks") return count === 1 ? t("1 week") : t("{n} weeks", { n: count });
  return count === 1 ? t("1 day") : t("{n} days", { n: count });
}

function stats(habit) {
  const s = habit.stats;
  return statRow([
    [t("Current streak"), streakText(s.currentStreak, s.streakUnit)],
    [t("Best streak"), streakText(s.bestStreak, s.streakUnit)],
    [t("Rate (30 days)"), `${Math.round(s.completionRate * 100)} %`],
    [t("Total"), H.formatTotal(habit, s.total)],
  ]);
}

/**
 * Shows how the habit is set up: frequency, daily target (not for check
 * habits), category and, if archived, its status.
 */
function details(habit) {
  const items = [factItem(t("Frequency"), H.describeFrequency(habit))];
  const target = H.describeTarget(habit);
  if (target) items.push(factItem(t("Daily target"), target));
  const category = state.categories.find((c) => c.id === habit.categoryId);
  items.push(factItem(t("Category"), category?.name ?? t("No category")));
  if (habit.archivedAt) items.push(factItem(t("Status"), t("Archived")));
  return factsPanel(t("Details"), items);
}

/**
 * Shows when the habit was last completed and when it was last changed
 * (the server's updatedAt).
 */
function activity(habit) {
  const done = lastDone(habit);
  return factsPanel(t("Activity"), [
    factItem(t("Last done"), done ? formatLong(done) : t("Not yet"), done ? daysAgo(done) : ""),
    factItem(t("Last changed"), formatStamp(habit.updatedAt), timeAgo(habit.updatedAt)),
  ], "activity");
}

/** Returns the latest day up to today whose value reached the target, or null. */
function lastDone(habit) {
  let newest = null;
  for (const [iso, value] of Object.entries(habit.entries)) {
    // Skip future days and incomplete days.
    if (iso > state.today || !H.isComplete(habit, value)) continue;
    if (newest === null || iso > newest) newest = iso;
  }
  return newest;
}

/** Formats the distance to today: "today", "yesterday", "5 days ago". */
function daysAgo(iso) {
  const n = daysBetween(iso, state.today);
  if (n === 0) return t("today");
  if (n === 1) return t("yesterday");
  return t("{n} days ago", { n });
}

/** Formats a timestamp as "Sat, 26 Sep 2026, 15:42" in the user's time zone. */
function formatStamp(stamp) {
  const at = new Date(stamp);
  const time = at.toLocaleTimeString(locale,
    { hour: "2-digit", minute: "2-digit", timeZone: userTimeZone() });
  return `${formatLong(localISO(stamp))}, ${time}`;
}

/** Formats a timestamp as "just now", "12 min ago", "3 h ago" or in days. */
function timeAgo(stamp) {
  const minutes = Math.floor((Date.now() - new Date(stamp).getTime()) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  if (minutes < 24 * 60) return t("{n} h ago", { n: Math.floor(minutes / 60) });
  return daysAgo(localISO(stamp));
}

function heatmap(habit) {
  const panel = document.createElement("section");
  panel.className = "panel";

  const title = document.createElement("h3");
  const year = state.today.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // One column per week, from the week of 1 January to the week of 31 December.
  // Days of the neighbouring years are drawn as blanks.
  const firstWeek = startOfWeek(yearStart);
  const weeks = Math.floor(daysBetween(firstWeek, yearEnd) / 7) + 1;

  title.textContent = t("Year {year}", { year });
  panel.append(title);

  const scroll = document.createElement("div");
  scroll.className = "heatmap-scroll";

  const body = document.createElement("div");
  body.className = "heatmap-body";
  body.style.setProperty("--weeks", String(weeks));

  const map = document.createElement("div");
  map.className = "heatmap";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      map.append(heatCell(habit, addDays(firstWeek, w * 7 + d), yearStart, yearEnd));
    }
  }

  body.append(monthLabels(firstWeek, weeks, yearStart, yearEnd), map);
  scroll.append(body);
  panel.append(scroll, legend(yearStart, year));
  return panel;
}

/**
 * Builds the month labels above the grid, each at the week containing the
 * first of the month.
 */
function monthLabels(firstWeek, weeks, yearStart, yearEnd) {
  const row = document.createElement("div");
  row.className = "heatmap-months";

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWeek, w * 7 + d);
      if (iso < yearStart || iso > yearEnd) continue;
      if (dayOfMonth(iso) !== 1) continue;
      const label = document.createElement("span");
      label.textContent = MONTH_SHORT[monthIndex(iso)];
      label.style.gridColumn = String(w + 1);
      row.append(label);
    }
  }
  return row;
}

function heatCell(habit, iso, yearStart, yearEnd) {
  const el = document.createElement("div");
  el.className = "heat";
  const value = habit.entries[iso] ?? 0;

  if (iso < yearStart || iso > yearEnd) {
    // Day of the previous or next year.
    el.classList.add("is-outside");
    return el;
  }
  // Used by showToday().
  if (iso === state.today) el.classList.add("is-today");
  const ahead = iso > state.today;
  // Unscheduled days are marked in the future too, so the schedule stays
  // visible.
  const off = !H.isScheduled(habit, iso) && value === 0;
  if (ahead) el.classList.add("is-future");
  if (off) el.classList.add("is-off");
  else if (!ahead) el.dataset.level = String(H.heatLevel(habit, value));

  el.dataset.date = iso;
  el.dataset.status = heatStatus(habit, iso, value);
  // Uses the custom tooltip instead of a title attribute; the aria-label holds
  // the same text.
  el.setAttribute("role", "img");
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);
  el.setAttribute("aria-label", `${when} — ${el.dataset.status}`);
  return el;
}

/** Describes a day of the heatmap. Future days only show planned values. */
function heatStatus(habit, iso, value) {
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit)) };
  if (iso > state.today) {
    if (value > 0) return t("{value} planned", vars);
    return H.isScheduled(habit, iso) ? t("still ahead") : t("not scheduled");
  }
  if (value > 0) return t("{value} of {target}", vars);
  return H.isScheduled(habit, iso) ? t("nothing recorded") : t("not scheduled");
}

function legend(yearStart, year) {
  const el = document.createElement("div");
  el.className = "heatmap-legend";
  const from = formatDayMonth(yearStart);
  // The grid covers the whole year.
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  el.innerHTML =
    `<span>${from} – ${to}</span><span style="flex:1"></span><span>${t("less")}</span>` +
    [0, 1, 2, 3, 4].map((l) => `<span class="heat" data-level="${l}"></span>`).join("") +
    `<span>${t("more")}</span>`;
  return el;
}

// ---------- heatmap tooltip ----------
//
// Chart tooltips appear at once, in the app's tooltip pane (tooltip.js).

/** Elements with a tooltip: heatmap squares and chart bars. */
const TIP_TARGETS = ".heat[data-date], .cum-col[data-tip]";

function showChartTooltip(cell) {
  const date = document.createElement("div");
  date.className = "tip-date";
  // Bars have their own label; squares show their date.
  date.textContent = cell.dataset.tip ?? formatFull(cell.dataset.date);

  const status = document.createElement("div");
  status.className = "tip-status";
  status.textContent = cell.dataset.status;

  showTooltip(cell, [date, status]);
}

function initTooltip(container) {
  container.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(TIP_TARGETS);
    if (cell) showChartTooltip(cell);
  });
  container.addEventListener("mouseout", (event) => {
    if (event.target.closest(TIP_TARGETS)) hideTooltip();
  });
  // Hide the tooltip when the grid scrolls.
  container.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  container.addEventListener("mouseleave", hideTooltip);
}

/**
 * Chart granularities, each covering the year to date. `barMin` is the minimum
 * bar width before the chart scrolls; `every` is the label interval.
 */
const GRAINS = {
  day: { label: t("Day"), barMin: "9px", every: 7 },
  week: { label: t("Week"), barMin: "14px", every: 4 },
  month: { label: t("Month"), barMin: "24px", every: 1 },
};

/** The selected granularity, kept for the session only. */
let grain = "month";

/**
 * Builds the cumulative chart: each bar is the running total at the end of its
 * day, week or month, with the period's own sum highlighted at the top.
 */
function cumulative(habit) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.append(grainHead(habit), cumulativeBody(habit));
  return panel;
}

/**
 * Scrolls a chart to its end (today). Must be called after the panel has been
 * inserted into the document.
 */
function showNewest(panel) {
  const scroller = panel.querySelector(".cum-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

/** Builds the chart heading with the day/week/month switch. */
function grainHead(habit) {
  const head = document.createElement("div");
  head.className = "cum-head";

  const title = document.createElement("h3");
  title.textContent = t("Cumulative");
  head.append(title);

  const choices = document.createElement("div");
  choices.className = "segmented cum-grain";
  choices.setAttribute("role", "radiogroup");
  choices.setAttribute("aria-label", t("Period"));
  for (const [key, { label }] of Object.entries(GRAINS)) {
    const wrap = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "cum-grain";
    input.value = key;
    input.checked = key === grain;
    input.addEventListener("change", () => {
      grain = key;
      // Only rebuild the chart, keeping the heatmap's scroll position.
      const panel = head.parentElement;
      panel.replaceChild(cumulativeBody(habit), panel.lastElementChild);
      showNewest(panel);
    });
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    choices.append(wrap);
  }
  head.append(choices);
  return head;
}

function cumulativeBody(habit) {
  const body = document.createElement("div");
  const year = state.today.slice(0, 4);
  const summary = H.periodSummary(habit, `${year}-01-01`, state.today, grain);

  if (summary.total === 0) {
    const empty = document.createElement("p");
    empty.className = "cum-empty";
    empty.textContent = t("No entries in {year} yet.", { year });
    body.append(empty);
    return body;
  }

  body.append(
    cumulativeSummary(habit, summary, t("in {year}", { year })),
    cumulativeChart(habit, summary),
  );
  return body;
}

function cumulativeSummary(habit, { total, best, activeDays }, scopeIn) {
  const line = document.createElement("p");
  line.className = "cum-summary";
  // Average per day with an entry.
  const average = Math.round(total / activeDays);
  line.append(
    strong(H.formatTotal(habit, total)),
    text(t(" {scope} · avg ", { scope: scopeIn })),
    strong(H.formatTotal(habit, average)),
    text(activeDays === 1
      ? t(" on 1 active day · best day ")
      : t(" on {n} active days · best day ", { n: activeDays })),
    strong(H.formatTotal(habit, best)),
  );
  return line;
}

const text = (value) => document.createTextNode(value);

function strong(value) {
  const el = document.createElement("strong");
  el.textContent = value;
  return el;
}

function cumulativeChart(habit, { buckets, total }) {
  const chart = document.createElement("div");
  chart.className = grain === "month" ? "cum-chart" : "cum-chart is-fine";
  chart.style.setProperty("--cols", String(buckets.length));
  chart.style.setProperty("--bar-min", GRAINS[grain].barMin);

  // The scale line marks the year's total, outside the scrolling area.
  const scale = document.createElement("div");
  scale.className = "cum-scale";
  scale.textContent = H.formatTotal(habit, total);

  const bars = document.createElement("div");
  bars.className = "cum-bars";
  for (const { start, sum, cumulative: running } of buckets) {
    const col = document.createElement("div");
    col.className = "cum-col";
    // Shown by the shared tooltip.
    col.dataset.tip = bucketName(start);
    col.dataset.status = sum > 0
      ? t("{total} · of that +{sum}",
        { total: H.formatTotal(habit, running), sum: H.formatTotal(habit, sum) })
      : t("{total} · nothing added", { total: H.formatTotal(habit, running) });
    // Accessible name, as the tooltip requires a pointer.
    col.setAttribute("role", "img");
    col.setAttribute("aria-label", `${col.dataset.tip}: ${col.dataset.status}`);

    const bar = document.createElement("div");
    bar.className = "cum-bar";
    bar.style.height = `${(running / total) * 100}%`;
    // Hide bars before the first entry.
    if (running === 0) bar.classList.add("is-zero");
    // Highlight the period's own sum at the top of the bar.
    if (sum > 0 && running > 0) {
      const gain = document.createElement("div");
      gain.className = "cum-gain";
      gain.style.height = `${(sum / running) * 100}%`;
      bar.append(gain);
    }
    col.append(bar);
    bars.append(col);
  }

  // Bars and labels scroll together.
  const track = document.createElement("div");
  track.className = "cum-track";
  track.append(bars, bucketLabels(buckets));

  const scroller = document.createElement("div");
  scroller.className = "cum-scroll";
  scroller.append(track);

  chart.append(scale, scroller);
  return chart;
}

/** Returns the tooltip label of a bucket. */
function bucketName(start) {
  if (grain === "month") return t("End of {month}", { month: MONTH_LONG[monthIndex(start)] });
  if (grain === "week") return t("Week from {date}", { date: formatDayMonth(start) });
  return formatFull(start);
}

/**
 * Builds the labels below the bars. For fine granularities only every n-th
 * bucket is labelled.
 */
function bucketLabels(buckets) {
  const row = document.createElement("div");
  row.className = "cum-months";
  const { every } = GRAINS[grain];
  buckets.forEach(({ start }, i) => {
    const span = document.createElement("span");
    // Counted from the end, so the latest bucket is always labelled.
    const fromEnd = buckets.length - 1 - i;
    if (fromEnd % every === 0) {
      const tick = document.createElement("i");
      tick.textContent = grain === "month"
        ? MONTH_SHORT[monthIndex(start)]
        : `${dayOfMonth(start)}.${monthIndex(start) + 1}.`;
      span.append(tick);
    }
    row.append(span);
  });
  return row;
}
