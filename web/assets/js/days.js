// Day statistics, opened from the day summary: perfect days, streaks of them,
// a year heatmap shaded by each day's share of completed habits, and the
// average share per weekday and per month. The server counts the days and
// computes the statistics (GET /api/days); this view only shows them.

import {
  MONTH_SHORT, MONTH_LONG, WEEKDAY_SHORT, WEEKDAY_LONG, formatFull, formatDayMonth,
} from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { api } from "./api.js";
import { remote } from "./remote.js";
import { appBar } from "./appbar.js";
import { statRow, factsPanel, factItem } from "./panels.js";
import { hideTooltip } from "./tooltip.js";
import { currentYear, sinceLabel, yearGrid, centreToday, initChartTooltips } from "./year.js";

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
  const bar = appBar({ title: t("Day statistics"), sub: year, edit: false, menu: [] });
  const data = remote(`days|${year}`, () => api.days(year), () => {
    if (!root.hidden) renderDays();
  });
  // Until the first answer arrives.
  if (!data) {
    root.replaceChildren(bar);
    return;
  }
  const { stats } = data;
  root.replaceChildren(
    bar,
    statTiles(stats, `${year}-01-01`),
    highlights(stats),
    weekdays(stats),
    months(stats),
    heatmap(data.totals, year),
  );
  centreToday(root);
}

const percent = (rate) => (rate === null ? "–" : `${Math.round(rate * 100)} %`);
const dayCount = (n) => (n === 1 ? t("1 day") : t("{n} days", { n }));

function statTiles(stats, from) {
  return statRow([
    [t("Perfect days {since}", { since: sinceLabel(from) }),
      t("{n} of {total}", { n: stats.perfect, total: stats.counted }), "calendarCheck"],
    [t("Current streak"), dayCount(stats.currentStreak), "streak"],
    [t("Best streak"), dayCount(stats.bestStreak), "trophy"],
    [t("Average per day"), percent(stats.average), "percent"],
  ]);
}

// ---------- heatmap ----------

function heatmap(totals, year) {
  const panel = document.createElement("section");
  panel.className = "panel days-heatmap";

  const title = document.createElement("h3");
  title.textContent = t("Year {year}", { year });

  const byDate = new Map(totals.map((d) => [d.date, d]));
  panel.append(title, yearGrid(year, (iso) => heatCell(iso, byDate.get(iso))), legend(year));
  return panel;
}

/** Builds the square of a day from its total ({due, done}). */
function heatCell(iso, { due, done }) {
  const el = document.createElement("div");
  el.className = "heat";
  if (iso === state.today) el.classList.add("is-today");
  const ahead = iso > state.today;
  if (ahead) {
    el.classList.add("is-future");
  } else if (due === 0) {
    el.classList.add("is-off");
  } else {
    // The shade grows with the share of completed habits.
    el.style.setProperty("--rate", (done / due).toFixed(3));
    if (done === due) el.classList.add("is-perfect");
  }

  el.dataset.date = iso;
  el.dataset.status = heatStatus(due, done, ahead);
  el.setAttribute("role", "img");
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);
  el.setAttribute("aria-label", `${when} — ${el.dataset.status}`);
  return el;
}

function heatStatus(due, done, ahead) {
  if (due === 0) return t("Nothing due on this day");
  if (ahead) return due === 1 ? t("1 habit due") : t("{n} habits due", { n: due });
  return `${t("{done} of {due} done", { done, due })} · ${percent(done / due)}`;
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
 * the number of perfect days. `groups` are { label, name, rate, perfect }.
 */
function barPanel(title, groups) {
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = "day-bars";
  for (const { label, name, rate, perfect } of groups) {
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

function weekdays(stats) {
  return barPanel(t("By weekday"), stats.weekdays.map((group, i) => ({
    label: WEEKDAY_SHORT[i],
    name: WEEKDAY_LONG[i],
    ...group,
  })));
}

function months(stats) {
  // The server's months run from the first with due habits; firstMonth is 1
  // for January.
  return barPanel(t("By month"), (stats.months ?? []).map((group, i) => ({
    label: MONTH_SHORT[stats.firstMonth - 1 + i],
    name: MONTH_LONG[stats.firstMonth - 1 + i],
    ...group,
  })));
}

/** Facts: completed habits, days without any, best weekday and month. */
function highlights(stats) {
  const items = [
    factItem(t("Habits completed"), String(stats.completed)),
    factItem(t("Days without progress"), dayCount(stats.emptyDays)),
  ];
  if (stats.bestWeekday >= 0) {
    const rate = stats.weekdays[stats.bestWeekday].rate;
    items.push(factItem(t("Best weekday"), WEEKDAY_LONG[stats.bestWeekday], `Ø ${percent(rate)}`));
  }
  if (stats.bestMonth > 0) {
    const rate = stats.months[stats.bestMonth - stats.firstMonth].rate;
    items.push(factItem(t("Best month"), MONTH_LONG[stats.bestMonth - 1], `Ø ${percent(rate)}`));
  }
  return factsPanel(t("Highlights"), items);
}
