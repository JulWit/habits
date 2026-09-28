// Habit detail view: statistics, activity chart and calendar heatmap.

import {
  addDays, daysBetween, MONTH_SHORT, MONTH_LONG, monthIndex, dayOfMonth, formatFull, formatLong,
  formatDayMonth, localISO,
} from "./dates.js";
import { t, locale, userTimeZone } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge, colorValue } from "./icons.js";
import { appBar } from "./appbar.js";
import { statRow, factsPanel, factItem, rateLabel } from "./panels.js";
import { hideTooltip } from "./tooltip.js";
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
    }
  });
  initChartTooltips(root, ".heat[data-date], .cum-col[data-tip]");
}

export function renderDetail(habit) {
  if (!root || !habit) return;
  // The tooltip's target is about to be replaced.
  hideTooltip();
  root.dataset.habit = habit.id;
  root.style.setProperty("--habit-color", colorValue(habit.color));
  // The cumulative chart is only shown for countable habits.
  const panels = [header(habit), stats(habit), details(habit), activity(habit), heatmap(habit)];
  if (H.isCountable(habit)) panels.push(cumulative(habit));
  // The notes only with notes to show.
  const notes = notesPanel(habit);
  if (notes) panels.push(notes);
  root.replaceChildren(...panels);
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
    [t("Current streak"), streakText(s.currentStreak, s.streakUnit)],
    [t("Best streak"), streakText(s.bestStreak, s.streakUnit)],
    [rateLabel(), `${Math.round(s.completionRate * 100)} %`],
    [t("Total"), H.formatTotal(habit, s.total)],
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

/**
 * Returns the latest day up to today whose value met the target, or null. A
 * limit is also met by days without a value, so its days are walked back from
 * today.
 */
function lastDone(habit) {
  if (H.isLimit(habit, state.today)) {
    const first = H.historyStart(habit);
    for (let iso = state.today; iso >= first; iso = addDays(iso, -1)) {
      if (H.isDue(habit, iso) && H.isComplete(habit, iso, habit.entries[iso] ?? 0)) return iso;
    }
    return null;
  }
  let newest = null;
  for (const [iso, value] of Object.entries(habit.entries)) {
    // Skip future days and incomplete days.
    if (iso > state.today || !H.isComplete(habit, iso, value)) continue;
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

  const year = currentYear();
  const title = document.createElement("h3");
  title.textContent = t("Year {year}", { year });

  panel.append(title, yearGrid(year, (iso) => heatCell(habit, iso)), legend(year));
  return panel;
}

function heatCell(habit, iso) {
  const el = document.createElement("div");
  el.className = "heat";
  const value = habit.entries[iso] ?? 0;

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

/**
 * Describes a day of the heatmap, with its note. Future days only show planned
 * values.
 */
function heatStatus(habit, iso, value) {
  const note = habit.notes?.[iso];
  const status = dayStatus(habit, iso, value);
  return note ? `${status} · ${note}` : status;
}

function dayStatus(habit, iso, value) {
  if (H.isSkipped(habit, iso)) return t("skipped");
  const vars = { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit, iso)) };
  if (iso > state.today) {
    if (value > 0) return t("{value} planned", vars);
    return H.isScheduled(habit, iso) ? t("still ahead") : t("not scheduled");
  }
  if (H.isLimit(habit, iso) && H.isScheduled(habit, iso)) {
    if (value > 0) return t("{value} of at most {target}", vars);
    return H.isComplete(habit, iso, value) ? t("nothing, within the limit") : t("nothing recorded");
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
  const year = currentYear();
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

/** How many notes the detail view lists, newest first. */
const NOTES_SHOWN = 30;

/**
 * Lists the habit's latest notes, each with its day and what was recorded
 * then. Returns null without notes.
 */
function notesPanel(habit) {
  const days = Object.keys(habit.notes ?? {}).sort().reverse();
  if (days.length === 0) return null;
  const items = days.slice(0, NOTES_SHOWN).map((iso) => {
    const item = factItem(formatLong(iso), habit.notes[iso], dayStatus(habit, iso, habit.entries[iso] ?? 0));
    item.className = "note-item";
    return item;
  });
  const title = days.length > NOTES_SHOWN
    ? t("Notes (latest {n} of {total})", { n: NOTES_SHOWN, total: days.length })
    : t("Notes");
  return factsPanel(title, items, "notes");
}
