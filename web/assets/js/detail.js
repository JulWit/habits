// Habit detail view: statistics, activity chart and calendar heatmap.

import {
  addDays, MONTH_SHORT, MONTH_LONG, monthIndex, dayOfMonth, formatFull, formatLong, formatDayMonth,
} from "./dates.js";
import { t } from "./i18n.js";
import { state, habitById } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge, colorValue, icons } from "./icons.js";
import { appBar } from "./appbar.js";
import {
  statRow, factsPanel, factItem, rateLabel, createdItem, changedItem, daysAgo,
} from "./panels.js";
import { hideTooltip } from "./tooltip.js";
import { api } from "./api.js";
import { remote } from "./remote.js";
import { currentYear, yearGrid, centreToday, initChartTooltips } from "./year.js";

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
      case "skip": actions.skipDays(id); break;
      case "delete": actions.deleteHabit(id); break;
      case "year-earlier": showYear(-1); break;
      case "year-later": showYear(1); break;
    }
  });
  initChartTooltips(root, ".heat[data-date], .cum-col[data-tip]");
}

/**
 * The year the heatmap and the cumulative chart show, e.g. "2025", and the
 * habit it was chosen for. Another habit opens with the current year; the
 * choice is not kept beyond the session.
 */
let shownYear = null;
let shownFor = null;

/** Returns the first and the last year of the habit's history, as numbers. */
function yearRange(habit) {
  const last = Number(currentYear());
  const first = Number(habit.historyStart?.slice(0, 4)) || last;
  return [Math.min(first, last), last];
}

/** Shows the year before (-1) or after (+1) the one shown. */
function showYear(delta) {
  const habit = habitById(root.dataset.habit);
  if (!habit) return;
  const [first, last] = yearRange(habit);
  shownYear = String(Math.min(last, Math.max(first, Number(shownYear) + delta)));
  renderDetail(habit);
  // Keep the focus on the arrows, which the render replaced.
  const again = root.querySelector(`[data-action="${delta < 0 ? "year-earlier" : "year-later"}"]`);
  (again?.disabled ? root.querySelector(".year-nav button:not(:disabled)") : again)?.focus();
}

export function renderDetail(habit) {
  if (!root || !habit) return;
  // The tooltip's target is about to be replaced.
  hideTooltip();
  if (shownFor !== habit.id) {
    shownFor = habit.id;
    shownYear = currentYear();
  }
  root.dataset.habit = habit.id;
  root.style.setProperty("--habit-color", colorValue(habit.color));
  // How the habit is set up comes first, then its statistics and the year,
  // then its activity. The cumulative chart is only shown for countable
  // habits.
  const panels = [
    header(habit),
    details(habit),
    stats(habit),
    H.isCountable(habit) ? cumulative(habit) : null,
    heatmap(habit),
    activity(habit),
  ];
  root.replaceChildren(...panels.filter(Boolean));
  showNewest(root);
  centreToday(root);
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
      { action: "skip", label: t("Skip days…"), icon: "skip" },
      archived
        ? { action: "archive", label: t("Reactivate"), icon: "unarchive" }
        : { action: "archive", label: t("Archive", { context: "verb" }), icon: "archive" },
      { action: "delete", label: t("Delete"), icon: "trash", danger: true },
    ],
  });
}

/** Formats a streak with its unit: "1 day", "6 days", "1 week", "2 months". */
function streakText(count, unit) {
  if (unit === "months") return count === 1 ? t("1 month") : t("{n} months", { n: count });
  if (unit === "weeks") return count === 1 ? t("1 week") : t("{n} weeks", { n: count });
  return count === 1 ? t("1 day") : t("{n} days", { n: count });
}

function stats(habit) {
  const s = habit.stats;
  return statRow([
    [t("Current streak"), streakText(s.currentStreak, s.streakUnit), "streak"],
    [t("Best streak"), streakText(s.bestStreak, s.streakUnit), "trophy"],
    [rateLabel(), `${Math.round(s.completionRate * 100)} %`, "percent"],
    [t("Total"), H.formatTotal(habit, s.total), "total"],
  ]);
}

/**
 * Shows how the habit is set up: frequency, daily target (not for check
 * habits), category and, if archived, its status.
 */
function details(habit) {
  const all = habit.schedules;
  // With earlier schedules, the current one is dated.
  const since = all.length > 1 ? t("since {date}", { date: formatLong(all.at(-1).from) }) : "";
  const items = [factItem(t("Frequency"), H.describeFrequency(H.currentSchedule(habit).frequency), since)];
  const target = H.describeTarget(habit);
  if (target) items.push(factItem(t("Daily target"), target, since));
  // Earlier schedules, newest first.
  for (let i = all.length - 2; i >= 0; i--) {
    const until = formatLong(addDays(all[i + 1].from, -1));
    items.push(factItem(t("Until {date}", { date: until }), describeSchedule(habit, all[i])));
  }
  const category = state.categories.find((c) => c.id === habit.categoryId);
  items.push(factItem(t("Category"), category?.name ?? t("No category")));
  if (habit.archivedAt) items.push(factItem(t("Status"), t("Archived")));
  return factsPanel(t("Details"), items);
}

/** Describes a schedule of the habit: its frequency and, if any, its target. */
function describeSchedule(habit, schedule) {
  return [H.describeFrequency(schedule.frequency), H.describeTarget(habit, schedule)].filter(Boolean).join(" · ");
}

/**
 * Shows when the habit was created, last completed and last changed (the
 * server's updatedAt).
 */
function activity(habit) {
  // The server leaves it empty if the habit was never done.
  const done = habit.stats?.lastDone || null;
  return factsPanel(t("Activity"), [
    createdItem(habit.createdAt),
    factItem(t("Last done"), done ? formatLong(done) : t("Not yet"), done ? daysAgo(done) : ""),
    changedItem(habit.updatedAt),
  ], "activity");
}

function heatmap(habit) {
  const panel = document.createElement("section");
  panel.className = "panel";

  const year = shownYear;
  const title = document.createElement("h3");
  title.textContent = t("Year {year}", { year });
  const head = document.createElement("div");
  head.className = "year-head";
  head.append(title, yearNav(habit));

  panel.append(head, yearGrid(year, (iso) => heatCell(habit, iso)), legend(year));
  return panel;
}

/**
 * Builds the arrows to the year before and after the one shown, from the
 * first year of the habit's history to the current one.
 */
function yearNav(habit) {
  const [first, last] = yearRange(habit);
  const year = Number(shownYear);
  const nav = document.createElement("div");
  nav.className = "year-nav";
  const arrow = (action, icon, label, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-button";
    b.dataset.action = action;
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.disabled = disabled;
    return b;
  };
  nav.append(
    arrow("year-earlier", icons.chevronLeft, t("Previous year"), year <= first),
    arrow("year-later", icons.chevronRight, t("Next year"), year >= last),
  );
  return nav;
}

function heatCell(habit, iso) {
  const el = document.createElement("div");
  el.className = "heat";
  const { value } = H.entryOn(habit, iso);

  // Used by centreToday().
  if (iso === state.today) el.classList.add("is-today");
  const ahead = iso > state.today;
  // Unscheduled days are marked in the future too, so the schedule stays
  // visible.
  const off = !H.isScheduled(habit, iso) && value === 0;
  if (ahead) el.classList.add("is-future");
  if (off) el.classList.add("is-off");
  else if (H.isSkipped(habit, iso)) el.classList.add("is-skipped");
  else if (!ahead) el.dataset.level = String(H.heatLevel(habit, iso, value));

  el.dataset.date = iso;
  el.dataset.status = heatStatus(habit, iso, value);
  // Uses the chart tooltip instead of a title attribute; the aria-label holds
  // the same text.
  el.setAttribute("role", "img");
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);
  el.setAttribute("aria-label", `${when} — ${el.dataset.status}`);
  return el;
}

/** Describes a day of the heatmap. Future days only show planned values. */
function heatStatus(habit, iso, value) {
  if (H.isSkipped(habit, iso)) return t("skipped");
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit, iso)) };
  if (iso > state.today) {
    if (value > 0) return t("{value} planned", vars);
    return H.isScheduled(habit, iso) ? t("still ahead") : t("not scheduled");
  }
  if (H.isLimit(habit, iso) && H.isScheduled(habit, iso)) {
    if (value > 0) return t("{value} of at most {target}", vars);
    return H.isDone(habit, iso) ? t("nothing, within the limit") : t("nothing recorded");
  }
  if (value > 0) return t("{value} of {target}", vars);
  return H.isScheduled(habit, iso) ? t("nothing recorded") : t("not scheduled");
}

function legend(year) {
  const el = document.createElement("div");
  el.className = "heatmap-legend";
  const from = formatDayMonth(`${year}-01-01`);
  // The grid covers the whole year.
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  el.innerHTML =
    `<span>${from} – ${to}</span><span style="flex:1"></span><span>${t("less")}</span>` +
    [0, 1, 2, 3, 4].map((l) => `<span class="heat" data-level="${l}"></span>`).join("") +
    `<span>${t("more")}</span>`;
  return el;
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
 * day, week or month, with the period's own sum highlighted at the top. The
 * server sums the values (GET /api/habits/{id}/totals).
 */
function cumulative(habit) {
  const panel = document.createElement("section");
  panel.className = "panel cum-panel";
  panel.append(grainHead(habit), cumulativeBody(habit));
  return panel;
}

/**
 * Rebuilds the chart of the habit shown, e.g. once its totals have arrived,
 * keeping the heatmap's scroll position.
 */
function redrawCumulative(id) {
  const panel = root.querySelector(".cum-panel");
  const habit = habitById(id);
  if (!panel || !habit || root.dataset.habit !== id) return;
  panel.replaceChild(cumulativeBody(habit), panel.lastElementChild);
  showNewest(panel);
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
      redrawCumulative(habit.id);
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
  // The year shown, to today in the current year.
  const year = shownYear;
  const current = year === currentYear();
  const summary = remote(
    `totals|${habit.id}|${year}|${grain}`,
    () => api.habitTotals(habit.id, year, grain),
    () => redrawCumulative(habit.id),
  );
  // Until the first answer arrives.
  if (!summary) {
    body.className = "cum-loading";
    return body;
  }

  if (summary.total === 0) {
    const empty = document.createElement("p");
    empty.className = "cum-empty";
    empty.textContent = current
      ? t("No entries in {year} yet.", { year })
      : t("No entries in {year}.", { year });
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
