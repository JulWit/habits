// Day statistics, opened from the day summary: perfect days, streaks of them,
// a year heatmap shaded by each day's share of completed habits, and the
// average share per weekday and per month.

import {
  addDays, startOfWeek, daysBetween, weekdayIndex, monthIndex, dayOfMonth,
  MONTH_SHORT, MONTH_LONG, WEEKDAY_SHORT, WEEKDAY_LONG, formatFull, formatDayMonth,
} from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { appBar } from "./appbar.js";
import { statRow, factsPanel, factItem } from "./panels.js";
import { showTooltip, hideTooltip } from "./tooltip.js";

let root;
let actions;

export function initDays(handlers) {
  actions = handlers;
  root = document.getElementById("view-days");
  root.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (el?.dataset.action === "back") actions.closeDays();
  });
  initTooltip(root);
}

export function renderDays() {
  // Nothing to count before the state is loaded.
  if (!root || !state.today) return;
  hideTooltip();
  const year = state.today.slice(0, 4);
  const days = dayRecords(activeHabits(), `${year}-01-01`, `${year}-12-31`);
  const past = days.filter((d) => d.iso <= state.today && d.iso >= rangeStart());
  root.replaceChildren(
    appBar({ title: t("Day statistics"), sub: String(year), edit: false, menu: [] }),
    stats(past),
    heatmap(days, year),
    weekdays(past),
    months(past),
    highlights(past),
  );
  showToday(root);
}

/** The habits counted: those not archived, as in the day summary. */
function activeHabits() {
  return state.habits.filter((h) => !h.archivedAt);
}

/** Returns January 1 of this year, or the start of the loaded entries if later. */
function rangeStart() {
  const yearStart = `${state.today.slice(0, 4)}-01-01`;
  const loaded = state.entriesFrom ?? yearStart;
  return loaded > yearStart ? loaded : yearStart;
}

/**
 * Returns one record per day from `from` to `to`: the habits due (`due`), how
 * many of them are complete (`done`) and the share (`rate`, 0…1, null if
 * nothing is due). Habits count from their creation day, or from their first
 * entry if that is earlier (imported history).
 */
function dayRecords(habits, from, to) {
  const bornOn = new Map(habits.map((h) => {
    const created = (h.createdAt ?? "").slice(0, 10);
    const first = Object.keys(h.entries).reduce((a, b) => (b < a ? b : a), created);
    return [h.id, first];
  }));
  const records = [];
  for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
    const due = habits.filter((h) => bornOn.get(h.id) <= iso && H.isScheduled(h, iso));
    const done = iso > state.today
      ? 0
      : due.filter((h) => H.isComplete(h, iso, h.entries[iso] ?? 0)).length;
    records.push({
      iso,
      due: due.length,
      done,
      rate: due.length === 0 ? null : done / due.length,
    });
  }
  return records;
}

const isPerfect = (d) => d.due > 0 && d.done === d.due;

/**
 * Returns the current and the longest run of perfect days. Days without due
 * habits neither extend nor end a run; an open today does not end the current
 * one.
 */
function streaks(days) {
  let run = 0;
  let best = 0;
  for (const d of days) {
    if (d.due === 0) continue;
    if (isPerfect(d)) {
      run++;
      best = Math.max(best, run);
    } else if (d.iso !== state.today) {
      run = 0;
    }
  }
  return { current: run, best };
}

/** Returns the average share of the days with due habits, 0…1, or null. */
function average(days) {
  const counted = days.filter((d) => d.rate !== null && d.iso !== state.today);
  // Today alone still counts, rather than showing nothing.
  const list = counted.length > 0 ? counted : days.filter((d) => d.rate !== null);
  if (list.length === 0) return null;
  return list.reduce((sum, d) => sum + d.rate, 0) / list.length;
}

const percent = (rate) => (rate === null ? "–" : `${Math.round(rate * 100)} %`);
const dayCount = (n) => (n === 1 ? t("1 day") : t("{n} days", { n }));

function stats(days) {
  const counted = days.filter((d) => d.due > 0);
  const perfect = counted.filter(isPerfect).length;
  const { current, best } = streaks(days);
  return statRow([
    [t("Perfect days {since}", { since: sinceLabel(rangeStart()) }),
      t("{n} of {total}", { n: perfect, total: counted.length })],
    [t("Current streak"), dayCount(current)],
    [t("Best streak"), dayCount(best)],
    [t("Average per day"), percent(average(days))],
  ]);
}

/** Returns "(2026)" for a full year, "(since 12 Mar)" otherwise. */
function sinceLabel(from) {
  const year = state.today.slice(0, 4);
  if (from === `${year}-01-01`) return `(${year})`;
  return t("(since {date})", { date: formatDayMonth(from) });
}

// ---------- heatmap ----------

function heatmap(days, year) {
  const panel = document.createElement("section");
  panel.className = "panel days-heatmap";

  const title = document.createElement("h3");
  title.textContent = t("Year {year}", { year });

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // One column per week, as in the habit view; neighbouring years are blanks.
  const firstWeek = startOfWeek(yearStart);
  const weeks = Math.floor(daysBetween(firstWeek, yearEnd) / 7) + 1;
  const byDate = new Map(days.map((d) => [d.iso, d]));

  const scroll = document.createElement("div");
  scroll.className = "heatmap-scroll";
  const body = document.createElement("div");
  body.className = "heatmap-body";
  body.style.setProperty("--weeks", String(weeks));

  const map = document.createElement("div");
  map.className = "heatmap";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWeek, w * 7 + d);
      map.append(heatCell(byDate.get(iso), iso));
    }
  }

  body.append(monthLabels(firstWeek, weeks, yearStart, yearEnd), map);
  scroll.append(body);
  panel.append(title, scroll, legend(year));
  return panel;
}

function heatCell(record, iso) {
  const el = document.createElement("div");
  el.className = "heat";
  if (!record) {
    el.classList.add("is-outside");
    return el;
  }
  if (iso === state.today) el.classList.add("is-today");
  const ahead = iso > state.today;
  if (ahead) el.classList.add("is-future");
  else if (record.due === 0) el.classList.add("is-off");
  else {
    // The shade grows with the share of completed habits.
    el.style.setProperty("--rate", record.rate.toFixed(3));
    if (isPerfect(record)) el.classList.add("is-perfect");
  }

  el.dataset.date = iso;
  el.dataset.status = heatStatus(record, ahead);
  el.setAttribute("role", "img");
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);
  el.setAttribute("aria-label", `${when} — ${el.dataset.status}`);
  return el;
}

function heatStatus({ due, done, rate }, ahead) {
  if (due === 0) return t("Nothing due on this day");
  if (ahead) return due === 1 ? t("1 habit due") : t("{n} habits due", { n: due });
  return `${t("{done} of {due} done", { done, due })} · ${percent(rate)}`;
}

/** Month labels above the grid, at the week containing the first of the month. */
function monthLabels(firstWeek, weeks, yearStart, yearEnd) {
  const row = document.createElement("div");
  row.className = "heatmap-months";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWeek, w * 7 + d);
      if (iso < yearStart || iso > yearEnd || dayOfMonth(iso) !== 1) continue;
      const label = document.createElement("span");
      label.textContent = MONTH_SHORT[monthIndex(iso)];
      label.style.gridColumn = String(w + 1);
      row.append(label);
    }
  }
  return row;
}

function legend(year) {
  const el = document.createElement("div");
  el.className = "heatmap-legend";
  const from = formatDayMonth(`${year}-01-01`);
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  el.innerHTML =
    `<span>${from} – ${to}</span><span style="flex:1"></span><span>0 %</span>` +
    [0, 0.25, 0.5, 0.75].map((r) => `<span class="heat" style="--rate:${r}"></span>`).join("") +
    `<span class="heat is-perfect" style="--rate:1"></span><span>100 %</span>`;
  return el;
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

// ---------- weekdays and months ----------

/**
 * Builds a panel of horizontal bars, one per group: the average share and
 * the number of perfect days. `groups` are { label, name, days }.
 */
function barPanel(title, groups) {
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = "day-bars";
  for (const { label, name, days } of groups) {
    const rate = average(days);
    const perfect = days.filter(isPerfect).length;
    const row = document.createElement("div");
    row.className = "day-bar";
    row.innerHTML = `
      <span class="day-bar-label"></span>
      <span class="day-bar-track"><span class="day-bar-fill"></span></span>
      <span class="day-bar-value"></span>`;
    row.querySelector(".day-bar-label").textContent = label;
    row.querySelector(".day-bar-fill").style.width = `${Math.round((rate ?? 0) * 100)}%`;
    row.querySelector(".day-bar-value").textContent = percent(rate);
    if (rate === null) row.classList.add("is-empty");
    row.dataset.tip = name;
    row.dataset.status = rate === null
      ? t("Nothing due")
      : `Ø ${percent(rate)} · ${t("Perfect days: {n}", { n: perfect })}`;
    list.append(row);
  }
  panel.append(heading, list);
  return panel;
}

function weekdays(days) {
  return barPanel(t("By weekday"), WEEKDAY_SHORT.map((label, i) => ({
    label,
    name: WEEKDAY_LONG[i],
    days: days.filter((d) => weekdayIndex(d.iso) === i),
  })));
}

function months(days) {
  // From the first month with due habits to this month.
  const firstDue = days.find((d) => d.due > 0);
  const first = firstDue ? monthIndex(firstDue.iso) : monthIndex(state.today);
  const last = monthIndex(state.today);
  const groups = [];
  for (let m = first; m <= last; m++) {
    groups.push({
      label: MONTH_SHORT[m],
      name: MONTH_LONG[m],
      days: days.filter((d) => monthIndex(d.iso) === m),
    });
  }
  return barPanel(t("By month"), groups);
}

/** Facts: completed habits, days without any, best weekday and month. */
function highlights(days) {
  const counted = days.filter((d) => d.due > 0 && d.iso !== state.today);
  const completed = days.reduce((sum, d) => sum + d.done, 0);
  const empty = counted.filter((d) => d.done === 0).length;

  const best = (names, key) => {
    let top = null;
    names.forEach((name, i) => {
      const rate = average(days.filter((d) => key(d.iso) === i));
      if (rate !== null && (top === null || rate > top.rate)) top = { name, rate };
    });
    return top;
  };
  const weekday = best(WEEKDAY_LONG, weekdayIndex);
  const month = best(MONTH_LONG, monthIndex);

  const items = [
    factItem(t("Habits completed"), String(completed)),
    factItem(t("Days without progress"), dayCount(empty)),
  ];
  if (weekday) items.push(factItem(t("Best weekday"), weekday.name, `Ø ${percent(weekday.rate)}`));
  if (month) items.push(factItem(t("Best month"), month.name, `Ø ${percent(month.rate)}`));
  return factsPanel(t("Highlights"), items);
}

// ---------- tooltip ----------

const TIP_TARGETS = ".heat[data-date], .day-bar[data-tip]";

function initTooltip(container) {
  container.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(TIP_TARGETS);
    if (!cell) return;
    const date = document.createElement("div");
    date.className = "tip-date";
    date.textContent = cell.dataset.tip ?? formatFull(cell.dataset.date);
    const status = document.createElement("div");
    status.className = "tip-status";
    status.textContent = cell.dataset.status;
    showTooltip(cell, [date, status]);
  });
  container.addEventListener("mouseout", (event) => {
    if (event.target.closest(TIP_TARGETS)) hideTooltip();
  });
  container.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  container.addEventListener("mouseleave", hideTooltip);
}
