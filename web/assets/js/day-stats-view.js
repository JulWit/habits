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
import { remote } from "./remote-stats.js";
import { appBar } from "./app-bar.js";
import { statRow, factsPanel, factItem } from "./stat-panels.js";
import { hideTooltip } from "./tooltip.js";
import { currentYear, sinceLabel, yearGrid, centreToday, initChartTooltips } from "./year-grid.js";
import { el } from "./dom.js";

let root;
let actions;

export function initDays(handlers) {
  actions = handlers;
  root = document.getElementById("view-days");
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (target?.dataset.action === "back") actions.closeDays();
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
  const byDate = new Map(totals.map((d) => [d.date, d]));
  return el("section", { class: "panel days-heatmap" },
    el("h3", {}, t("Year {year}", { year })),
    yearGrid(year, (iso) => heatCell(iso, byDate.get(iso))),
    legend(year),
  );
}

/** Builds the square of a day from its total ({due, done}). */
function heatCell(iso, { due, done }) {
  const ahead = iso > state.today;
  const counted = !ahead && due > 0;
  const status = heatStatus(due, done, ahead);
  const when = iso === state.today ? t("Today, {date}", { date: formatFull(iso) }) : formatFull(iso);

  return el("div", {
    class: [
      "heat",
      iso === state.today && "is-today",
      ahead && "is-future",
      !ahead && due === 0 && "is-off",
      counted && done === due && "is-perfect",
    ],
    // The shade grows with the share of completed habits.
    style: { "--rate": counted ? (done / due).toFixed(3) : undefined },
    data: { date: iso, status },
    role: "img",
    "aria-label": `${when} — ${status}`,
  });
}

function heatStatus(due, done, ahead) {
  if (due === 0) return t("Nothing due on this day");
  if (ahead) return due === 1 ? t("1 habit due") : t("{n} habits due", { n: due });
  return `${t("{done} of {due} done", { done, due })} · ${percent(done / due)}`;
}

function legend(year) {
  const from = formatDayMonth(`${year}-01-01`);
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  return el("div", { class: "heatmap-legend" },
    el("span", {}, `${from} – ${to}`),
    el("span", { style: { flex: "1" } }),
    el("span", {}, "0 %"),
    ...[0, 0.25, 0.5, 0.75].map((rate) => el("span", { class: "heat", style: { "--rate": String(rate) } })),
    el("span", { class: "heat is-perfect", style: { "--rate": "1" } }),
    el("span", {}, "100 %"),
  );
}

// ---------- weekdays and months ----------

/**
 * Builds a panel of horizontal bars, one per group: the average share and
 * the number of perfect days. `groups` are { label, name, rate, perfect }.
 */
function barPanel(title, groups) {
  return el("section", { class: "panel" },
    el("h3", {}, title),
    el("div", { class: "day-bars" }, ...groups.map(({ label, name, rate, perfect }) =>
      el("div", {
        class: ["day-bar", rate === null && "is-empty"],
        data: {
          tip: name,
          status: rate === null
            ? t("Nothing due")
            : `Ø ${percent(rate)} · ${t("Perfect days: {n}", { n: perfect })}`,
        },
      },
        el("span", { class: "day-bar-label" }, label),
        el("span", { class: "day-bar-track" },
          el("span", { class: "day-bar-fill", style: { width: `${Math.round((rate ?? 0) * 100)}%` } }),
        ),
        el("span", { class: "day-bar-value" }, percent(rate)),
      ))),
  );
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
