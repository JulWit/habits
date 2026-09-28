// The current calendar year as the statistics views show it: the label of
// the range counted and the year grid of the heatmaps with its tooltips. Used
// by the habit, category and day statistics views.

import {
  addDays, startOfWeek, daysBetween, dayOfMonth, monthIndex, MONTH_SHORT, formatDayMonth,
  formatFull,
} from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { showTooltip, hideTooltip } from "./tooltip.js";
import { el } from "./dom.js";

/** Returns the current year, e.g. "2026". */
export function currentYear() {
  return state.today.slice(0, 4);
}

/** Returns "(2026)" for a full year, "(since 12 Mar)" otherwise. */
export function sinceLabel(from) {
  const year = currentYear();
  if (from === `${year}-01-01`) return `(${year})`;
  return t("(since {date})", { date: formatDayMonth(from) });
}

// ---------- year grid ----------

/**
 * Builds the scrolling year grid of a heatmap: one column per week, from the
 * week of 1 January to the week of 31 December, with the month names above
 * the week of each month's first day. `square(iso)` builds the square of a day
 * of the year; days of the neighbouring years are left blank.
 */
export function yearGrid(year, square) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const firstWeek = startOfWeek(yearStart);
  const weeks = Math.floor(daysBetween(firstWeek, yearEnd) / 7) + 1;

  const monthLabels = [];
  const squares = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWeek, w * 7 + d);
      if (iso < yearStart || iso > yearEnd) {
        squares.push(el("div", { class: "heat is-outside" }));
        continue;
      }
      squares.push(square(iso));
      if (dayOfMonth(iso) === 1) {
        monthLabels.push(el("span", { style: { "grid-column": String(w + 1) } }, MONTH_SHORT[monthIndex(iso)]));
      }
    }
  }

  return el("div", { class: "heatmap-scroll" },
    el("div", { class: "heatmap-body", style: { "--weeks": String(weeks) } },
      el("div", { class: "heatmap-months" }, ...monthLabels),
      el("div", { class: "heatmap" }, ...squares),
    ),
  );
}

/**
 * Scrolls the year grid below `root` so that today's square is centred, if
 * the grid overflows. Must be called once the grid is in the document.
 */
export function centreToday(root) {
  const scroller = root.querySelector(".heatmap-scroll");
  const cell = scroller?.querySelector(".heat.is-today");
  if (!cell) return;
  const box = scroller.getBoundingClientRect();
  const at = cell.getBoundingClientRect();
  scroller.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
}

/**
 * Shows a tooltip at once for the chart elements below `container` that match
 * `selector`: their data-tip, or for a heatmap square its date, above their
 * data-status.
 */
export function initChartTooltips(container, selector) {
  container.addEventListener("mouseover", (event) => {
    const target = event.target.closest(selector);
    if (!target) return;
    showTooltip(target, [
      el("div", { class: "tip-date" }, target.dataset.tip ?? formatFull(target.dataset.date)),
      el("div", { class: "tip-status" }, target.dataset.status),
    ]);
  });
  container.addEventListener("mouseout", (event) => {
    if (event.target.closest(selector)) hideTooltip();
  });
  // Hide the tooltip when a chart scrolls.
  container.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  container.addEventListener("mouseleave", hideTooltip);
}
