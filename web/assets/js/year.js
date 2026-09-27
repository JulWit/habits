// The current calendar year as the statistics views show it: the range of
// loaded days, the perfect days, and the year grid of the heatmaps with its
// tooltips. Used by the habit, category and day statistics views.

import {
  addDays, startOfWeek, daysBetween, dayOfMonth, monthIndex, MONTH_SHORT, formatDayMonth,
  formatFull,
} from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { showTooltip, hideTooltip } from "./tooltip.js";

/** Returns the current year, e.g. "2026". */
export function currentYear() {
  return state.today.slice(0, 4);
}

/** Returns January 1 of this year, or the start of the loaded entries if later. */
export function rangeStart() {
  const yearStart = `${currentYear()}-01-01`;
  const loaded = state.entriesFrom ?? yearStart;
  return loaded > yearStart ? loaded : yearStart;
}

/** Returns "(2026)" for a full year, "(since 12 Mar)" otherwise. */
export function sinceLabel(from) {
  const year = currentYear();
  if (from === `${year}-01-01`) return `(${year})`;
  return t("(since {date})", { date: formatDayMonth(from) });
}

// ---------- perfect days ----------

/**
 * Returns one record per day from `from` to `to`: the habits due (`due`), how
 * many of them are complete (`done`) and the share (`rate`, 0…1, null if
 * nothing is due). Habits count from their creation day, or from their first
 * entry if that is earlier (imported history). Future days have nothing done.
 */
export function dayRecords(habits, from, to) {
  const firstDay = new Map(habits.map((h) => {
    const created = h.createdAt.slice(0, 10);
    const firstEntry = Object.keys(h.entries).sort()[0];
    return [h.id, firstEntry && firstEntry < created ? firstEntry : created];
  }));

  const records = [];
  for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
    const due = habits.filter((h) => firstDay.get(h.id) <= iso && H.isScheduled(h, iso));
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

/** Reports whether every habit due on the day of `record` is complete. */
export function isPerfect(record) {
  return record.due > 0 && record.done === record.due;
}

/**
 * Returns the current and the longest run of perfect days. Days without due
 * habits neither extend nor end a run; an open today does not end the current
 * one.
 */
export function perfectStreaks(records) {
  let run = 0;
  let best = 0;
  for (const d of records) {
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

  const months = document.createElement("div");
  months.className = "heatmap-months";
  const map = document.createElement("div");
  map.className = "heatmap";

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWeek, w * 7 + d);
      if (iso < yearStart || iso > yearEnd) {
        const blank = document.createElement("div");
        blank.className = "heat is-outside";
        map.append(blank);
        continue;
      }
      map.append(square(iso));
      if (dayOfMonth(iso) === 1) {
        const label = document.createElement("span");
        label.textContent = MONTH_SHORT[monthIndex(iso)];
        label.style.gridColumn = String(w + 1);
        months.append(label);
      }
    }
  }

  const body = document.createElement("div");
  body.className = "heatmap-body";
  body.style.setProperty("--weeks", String(weeks));
  body.append(months, map);

  const scroll = document.createElement("div");
  scroll.className = "heatmap-scroll";
  scroll.append(body);
  return scroll;
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
    const el = event.target.closest(selector);
    if (!el) return;
    const title = document.createElement("div");
    title.className = "tip-date";
    title.textContent = el.dataset.tip ?? formatFull(el.dataset.date);
    const status = document.createElement("div");
    status.className = "tip-status";
    status.textContent = el.dataset.status;
    showTooltip(el, [title, status]);
  });
  container.addEventListener("mouseout", (event) => {
    if (event.target.closest(selector)) hideTooltip();
  });
  // Hide the tooltip when a chart scrolls.
  container.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  container.addEventListener("mouseleave", hideTooltip);
}
