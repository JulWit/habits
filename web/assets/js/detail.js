// The single-habit screen: statistics and a calendar heatmap of the history.

import {
  addDays, startOfWeek, daysBetween, MONTH_SHORT, MONTH_LONG, monthIndex, dayOfMonth,
  formatFull, formatLong, formatDayMonth,
} from "./dates.js";
import { t, locale, userTimeZone } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { icons, habitIconBadge } from "./icons.js";

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
  // The squares the tooltip was anchored to are about to be replaced.
  hideTooltip();
  root.dataset.habit = habit.id;
  root.style.setProperty("--habit-color", habit.color);
  // The cumulative chart only makes sense where the values are a quantity: a
  // yes/no habit adds up to a count of days, which the heatmap already shows.
  const panels = [header(habit), stats(habit), activity(habit), heatmap(habit)];
  if (H.isCountable(habit)) panels.push(cumulative(habit));
  root.replaceChildren(...panels);
  showNewest(root);
  showToday(root);
}

/**
 * Scrolls the year grid so today's column sits in the middle, where the grid
 * is wider than its panel - on a phone, and anywhere late in the year now that
 * the grid runs to December. Where it fits there is nothing to scroll, and
 * setting scrollLeft does nothing.
 */
function showToday(panel) {
  const scroller = panel.querySelector(".heatmap-scroll");
  const cell = scroller?.querySelector(".heat.is-today");
  if (!cell) return;
  const box = scroller.getBoundingClientRect();
  const at = cell.getBoundingClientRect();
  scroller.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
}

function header(habit) {
  const wrap = document.createElement("div");

  const head = document.createElement("div");
  head.className = "detail-head";
  head.innerHTML = `
    <button class="icon-button is-back" type="button" data-action="back" aria-label="${t("Back")}">${icons.arrowLeft}</button>
    <div class="detail-title">
      <h2><span class="dot"></span><span class="name"></span></h2>
      <span class="sub"></span>
    </div>`;
  head.querySelector(".name").textContent = habit.name;
  const badge = habitIconBadge(habit, "habit-icon is-large");
  if (badge) head.querySelector(".dot").replaceWith(badge);
  // Same order as the board's second line: frequency, then target.
  const target = H.describeTarget(habit);
  head.querySelector(".sub").textContent =
    H.describeFrequency(habit) + (target ? ` · ${target}` : "") +
    (habit.archivedAt ? ` · ${t("archived")}` : "");

  const archived = habit.archivedAt != null;
  const buttons = document.createElement("div");
  buttons.className = "topbar-actions";
  buttons.append(
    actionButton("edit", t("Edit"), icons.edit),
    archived
      ? actionButton("archive", t("Reactivate"), icons.unarchive)
      : actionButton("archive", t("Archive", { context: "verb" }), icons.archive),
    actionButton("delete", t("Delete"), icons.trash, "danger"),
  );
  head.append(buttons);
  wrap.append(head);

  return wrap;
}

/**
 * A detail-header button: icon plus caption.
 *
 * The caption keeps an aria-label of its own because narrow screens hide the
 * visible text and leave only the icon.
 */
function actionButton(action, label, icon, variant = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = variant ? `button ${variant}` : "button";
  b.dataset.action = action;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = label;
  b.append(text);
  return b;
}

/** A streak with its unit agreeing: "1 day", "6 days", "1 week". */
function streakText(count, unit) {
  if (unit === "weeks") return count === 1 ? t("1 week") : t("{n} weeks", { n: count });
  return count === 1 ? t("1 day") : t("{n} days", { n: count });
}

function stats(habit) {
  const s = habit.stats;
  const row = document.createElement("div");
  row.className = "stat-row";
  for (const [label, value] of [
    [t("Current streak"), streakText(s.currentStreak, s.streakUnit)],
    [t("Best streak"), streakText(s.bestStreak, s.streakUnit)],
    [t("Rate (30 days)"), `${Math.round(s.completionRate * 100)} %`],
    [t("Total"), H.formatTotal(habit, s.total)],
  ]) {
    const tile = document.createElement("div");
    tile.className = "stat";
    tile.innerHTML = `<div class="value"></div><div class="label"></div>`;
    tile.querySelector(".value").textContent = value;
    tile.querySelector(".label").textContent = label;
    row.append(tile);
  }
  return row;
}

/**
 * When the habit was last done and when it was last touched at all.
 *
 * The two differ on purpose: "done" is the newest day that met the target -
 * a half-finished day does not count - while "changed" is the server's own
 * timestamp, which every tick, clear and edit moves on, including a tick on a
 * day long past.
 */
function activity(habit) {
  const panel = document.createElement("section");
  panel.className = "panel activity";

  const title = document.createElement("h3");
  title.textContent = t("Activity");

  const list = document.createElement("dl");
  list.className = "activity-list";

  const done = lastDone(habit);
  list.append(
    activityItem(
      t("Last done"),
      done ? formatLong(done) : t("Not yet"),
      done ? daysAgo(done) : "",
    ),
    activityItem(
      t("Last changed"),
      formatStamp(habit.updatedAt),
      timeAgo(habit.updatedAt),
    ),
  );

  panel.append(title, list);
  return panel;
}

function activityItem(label, value, note) {
  const item = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  if (note) {
    const small = document.createElement("span");
    small.className = "note";
    small.textContent = note;
    dd.append(small);
  }
  item.append(dt, dd);
  return item;
}

/** The newest day up to today whose value met the target, or null. */
function lastDone(habit) {
  let newest = null;
  for (const [iso, value] of Object.entries(habit.entries)) {
    // A day ahead can carry a plan, but it has not been done yet.
    if (iso > state.today || !H.isComplete(habit, value)) continue;
    if (newest === null || iso > newest) newest = iso;
  }
  return newest;
}

/** "today", "yesterday", "5 days ago" - counted in calendar days. */
function daysAgo(iso) {
  const n = daysBetween(iso, state.today);
  if (n === 0) return t("today");
  if (n === 1) return t("yesterday");
  return t("{n} days ago", { n });
}

/** "Sat, 26 Sep 2026, 15:42" in the user's time zone. */
function formatStamp(stamp) {
  const at = new Date(stamp);
  const time = at.toLocaleTimeString(locale,
    { hour: "2-digit", minute: "2-digit", timeZone: userTimeZone() });
  return `${formatLong(localISO(at))}, ${time}`;
}

/** "just now", "12 min ago", "3 h ago", then whole days. */
function timeAgo(stamp) {
  const minutes = Math.floor((Date.now() - new Date(stamp).getTime()) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  if (minutes < 24 * 60) return t("{n} h ago", { n: Math.floor(minutes / 60) });
  return daysAgo(localISO(new Date(stamp)));
}

/**
 * The calendar day a moment falls on in the user's time zone - the zone the
 * server counts "today" in, so "yesterday" here and on the board agree. en-CA
 * because it is the locale that writes a date the ISO way round.
 */
function localISO(at) {
  return at.toLocaleDateString("en-CA",
    { year: "numeric", month: "2-digit", day: "2-digit", timeZone: userTimeZone() });
}

function heatmap(habit) {
  const panel = document.createElement("section");
  panel.className = "panel";

  const title = document.createElement("h3");
  const year = state.today.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // The grid is one column per calendar week, so it starts on the Monday of the
  // week holding 1 January and runs to the week holding 31 December - the days
  // still ahead greyed out. The days of those weeks that belong to the
  // neighbouring years are drawn as blanks rather than dropped, which is what
  // keeps every row a fixed weekday.
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
 * The month row above the grid. Without it a 37-column year is unreadable.
 *
 * A month is labelled at the column of the week that actually contains its
 * first day, so the caption sits over the week the month starts in rather than
 * being rounded to the nearest Monday.
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
    // A day of the previous or next year, present only to keep the first and
    // last columns square.
    el.classList.add("is-outside");
    return el;
  }
  // Not drawn any differently; showToday() finds the column by it.
  if (iso === state.today) el.classList.add("is-today");
  if (iso > state.today) {
    el.classList.add("is-future");
  } else if (!H.isScheduled(habit, iso) && value === 0) {
    el.classList.add("is-off");
  } else {
    el.dataset.level = String(H.heatLevel(habit, value));
  }

  el.dataset.date = iso;
  // A day still ahead has nothing to report yet - unless something was planned
  // on it from the board.
  const ahead = iso > state.today;
  el.dataset.status = ahead
    ? value > 0 ? t("{value} planned", { value: H.formatValue(habit, value) }) : t("still ahead")
    : value > 0
      ? t("{value} of {target}",
        { value: H.formatValue(habit, value), target: H.formatValue(habit, H.target(habit)) })
      : H.isScheduled(habit, iso)
        ? t("nothing recorded")
        : t("not scheduled");
  // No title attribute: the custom tooltip below replaces it, and keeping both
  // would stack the browser's own tooltip on top a second later. The accessible
  // name carries the same text for anyone not using a pointer.
  el.setAttribute("role", "img");
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);
  el.setAttribute("aria-label", `${when} — ${el.dataset.status}`);
  return el;
}

function legend(yearStart, year) {
  const el = document.createElement("div");
  el.className = "heatmap-legend";
  const from = formatDayMonth(yearStart);
  // The grid spans the whole year, the days still ahead greyed out, so the
  // caption names the whole year too.
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  el.innerHTML =
    `<span>${from} – ${to}</span><span style="flex:1"></span><span>${t("less")}</span>` +
    [0, 1, 2, 3, 4].map((l) => `<span class="heat" data-level="${l}"></span>`).join("") +
    `<span>${t("more")}</span>`;
  return el;
}

// ---------- heatmap tooltip ----------
//
// The native title attribute waits about a second and cannot be styled, which
// makes scanning a year of squares tedious. This one appears at once and is
// position: fixed — the grid sits in a horizontally scrolling box, and an
// absolutely positioned tooltip inside it would be clipped by that box.

let tooltip = null;

/** Elements that carry a tooltip: the heatmap's squares and the chart's bars. */
const TIP_TARGETS = ".heat[data-date], .cum-col[data-tip]";

function tooltipElement() {
  if (!tooltip?.isConnected) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  return tooltip;
}

function showTooltip(cell) {
  const tip = tooltipElement();

  const date = document.createElement("div");
  date.className = "tip-date";
  // A bar names its own bucket ("Week from 23 Mar"); a heatmap square is a
  // single day and spells that day out.
  date.textContent = cell.dataset.tip ?? formatFull(cell.dataset.date);

  const status = document.createElement("div");
  status.className = "tip-status";
  status.textContent = cell.dataset.status;

  tip.replaceChildren(date, status);
  tip.hidden = false;

  // Measured after filling, because the width depends on the text.
  const anchor = cell.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const margin = 8;

  let left = anchor.left + anchor.width / 2 - box.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));

  // Above the square by default, flipped below when the panel sits near the
  // top of the window.
  let top = anchor.top - box.height - margin;
  if (top < margin) top = anchor.bottom + margin;

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

export function hideTooltip() {
  if (tooltip) tooltip.hidden = true;
}

function initTooltip(container) {
  container.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(TIP_TARGETS);
    if (cell) showTooltip(cell);
  });
  container.addEventListener("mouseout", (event) => {
    if (event.target.closest(TIP_TARGETS)) hideTooltip();
  });
  // Scrolling the year sideways moves the squares out from under a tooltip that
  // is anchored to viewport coordinates, so it is dismissed instead.
  container.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  container.addEventListener("mouseleave", hideTooltip);
}

/**
 * The bucket sizes the chart offers. All three cover the same stretch — the
 * year to date, like the heatmap above — and differ only in how finely it is
 * cut. A year of single days is far wider than the panel, so the bars scroll
 * sideways instead of being squeezed; `barMin` is how narrow a bar may get
 * before that starts, and `every` how many buckets share one label.
 */
const GRAINS = {
  day: { label: t("Day"), barMin: "9px", every: 7 },
  week: { label: t("Week"), barMin: "14px", every: 4 },
  month: { label: t("Month"), barMin: "24px", every: 1 },
};

/**
 * Remembered for the session, not stored: it is a way of looking at the data,
 * not a preference about the app, and it should not outlive the tab.
 */
let grain = "month";

/**
 * The year as a growing bar: each bar is the running total up to the end of its
 * day, week or month, with that bucket's own contribution picked out at its top.
 *
 * The heatmap answers "did I do it that day"; this answers "how far have I got
 * since January". Because a running total only ever grows, the last bar is
 * always the tallest — so the top gridline is exactly the year's total and the
 * chart needs no axis of its own.
 */
function cumulative(habit) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.append(grainHead(habit), cumulativeBody(habit));
  return panel;
}

/**
 * Scrolls a chart to its right-hand end, where today is.
 *
 * Called after the panel is in the page, never while it is being built: reading
 * scrollWidth on a detached element gives zero, and the chart would stay parked
 * on the 1st of January. The read also forces the layout it needs, which is why
 * this works without waiting for a frame.
 */
function showNewest(panel) {
  const scroller = panel.querySelector(".cum-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

/** Title plus the Day/Week/Month switch. */
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
      // Only the panel's body is rebuilt: re-rendering the whole detail view
      // would throw away the heatmap's scroll position for a chart change.
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
  // The average is per day that has an entry, not per calendar day: for a habit
  // done twice a week, dividing by 365 would say nothing about a single run.
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

  // Outside the scrolling area on purpose: the line marks the tallest bar, and
  // that is the year's total whatever part of the year is on screen.
  const scale = document.createElement("div");
  scale.className = "cum-scale";
  scale.textContent = H.formatTotal(habit, total);

  const bars = document.createElement("div");
  bars.className = "cum-bars";
  for (const { start, sum, cumulative: running } of buckets) {
    const col = document.createElement("div");
    col.className = "cum-col";
    // Read by the shared tooltip, the same one the heatmap uses. Not a title
    // attribute: the browser draws that in its own style, a second late, and
    // the two would end up stacked.
    col.dataset.tip = bucketName(start);
    col.dataset.status = sum > 0
      ? t("{total} · of that +{sum}",
        { total: H.formatTotal(habit, running), sum: H.formatTotal(habit, sum) })
      : t("{total} · nothing added", { total: H.formatTotal(habit, running) });
    // The bar is a picture of a number, and the tooltip is not reachable
    // without a pointer, so the same sentence is the accessible name.
    col.setAttribute("role", "img");
    col.setAttribute("aria-label", `${col.dataset.tip}: ${col.dataset.status}`);

    const bar = document.createElement("div");
    bar.className = "cum-bar";
    bar.style.height = `${(running / total) * 100}%`;
    // Buckets before the first entry have nothing to show. Without this they
    // would still draw the sliver that keeps a small value visible, and a year
    // that started in June would look like it had been ticking over since
    // January.
    if (running === 0) bar.classList.add("is-zero");
    // The newest slice sits at the top of the bar, which is where the growth is.
    if (sum > 0 && running > 0) {
      const gain = document.createElement("div");
      gain.className = "cum-gain";
      gain.style.height = `${(sum / running) * 100}%`;
      bar.append(gain);
    }
    col.append(bar);
    bars.append(col);
  }

  // Bars and their labels scroll as one, so a label never drifts off its bar.
  const track = document.createElement("div");
  track.className = "cum-track";
  track.append(bars, bucketLabels(buckets));

  const scroller = document.createElement("div");
  scroller.className = "cum-scroll";
  scroller.append(track);

  chart.append(scale, scroller);
  return chart;
}

/** What a bucket is called in its tooltip. */
function bucketName(start) {
  if (grain === "month") return t("End of {month}", { month: MONTH_LONG[monthIndex(start)] });
  if (grain === "week") return t("Week from {date}", { date: formatDayMonth(start) });
  return formatFull(start);
}

/**
 * The row under the bars.
 *
 * Thirty daily labels would collide, so the finer grains print every fifth or
 * every fourth one and leave the rest blank — the empty cells keep the grid in
 * step with the bars above.
 */
function bucketLabels(buckets) {
  const row = document.createElement("div");
  row.className = "cum-months";
  const { every } = GRAINS[grain];
  buckets.forEach(({ start }, i) => {
    const span = document.createElement("span");
    // Counted from the right, so the newest bucket is always labelled.
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
