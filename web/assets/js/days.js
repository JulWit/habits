// Day statistics, opened from the day summary: perfect days, streaks of them,
// a year heatmap shaded by each day's share of completed habits, and the
// average share per weekday and per month.

import {
  weekdayIndex, monthIndex, MONTH_SHORT, MONTH_LONG, WEEKDAY_SHORT, WEEKDAY_LONG, formatFull,
  formatDayMonth,
} from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { appBar } from "./appbar.js";
import { statRow, factsPanel, factItem } from "./panels.js";
import { hideTooltip } from "./tooltip.js";
import {
  currentYear, rangeStart, sinceLabel, dayRecords, isPerfect, perfectStreaks, yearGrid,
  centreToday, initChartTooltips,
} from "./year.js";

let root;
let actions;

export function initDays(handlers) {
  actions = handlers;
  root = document.getElementById("view-days");
  root.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (el?.dataset.action === "back") actions.closeDays();
  });
  initChartTooltips(root, ".heat[data-date], .day-bar[data-tip]");
}

export function renderDays() {
  // Nothing to count before the state is loaded.
  if (!root || !state.today) return;
  hideTooltip();
  const year = currentYear();
  // The habits counted: those not archived, as in the day summary.
  const habits = state.habits.filter((h) => !h.archivedAt);
  const days = dayRecords(habits, `${year}-01-01`, `${year}-12-31`);
  const past = days.filter((d) => d.iso <= state.today && d.iso >= rangeStart());
  root.replaceChildren(
    appBar({ title: t("Day statistics"), sub: year, edit: false, menu: [] }),
    stats(past),
    heatmap(days, year),
    weekdays(past),
    months(past),
    highlights(past),
  );
  centreToday(root);
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
  const { current, best } = perfectStreaks(days);
  return statRow([
    [t("Perfect days {since}", { since: sinceLabel(rangeStart()) }),
      t("{n} of {total}", { n: perfect, total: counted.length })],
    [t("Current streak"), dayCount(current)],
    [t("Best streak"), dayCount(best)],
    [t("Average per day"), percent(average(days))],
  ]);
}

// ---------- heatmap ----------

function heatmap(days, year) {
  const panel = document.createElement("section");
  panel.className = "panel days-heatmap";

  const title = document.createElement("h3");
  title.textContent = t("Year {year}", { year });

  const byDate = new Map(days.map((d) => [d.iso, d]));
  panel.append(title, yearGrid(year, (iso) => heatCell(byDate.get(iso))), legend(year));
  return panel;
}

function heatCell(record) {
  const { iso } = record;
  const el = document.createElement("div");
  el.className = "heat";
  if (iso === state.today) el.classList.add("is-today");
  const ahead = iso > state.today;
  if (ahead) {
    el.classList.add("is-future");
  } else if (record.due === 0) {
    el.classList.add("is-off");
  } else {
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

  // The group with the highest average share, as { name, rate }, or null.
  const best = (names, groupOf) => {
    let top = null;
    names.forEach((name, i) => {
      const rate = average(days.filter((d) => groupOf(d.iso) === i));
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
