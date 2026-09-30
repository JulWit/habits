// The current calendar year as the statistics views show it: the label of
// the range counted and the year grid of the heatmaps with its tooltips. Used
// by the habit, category and day statistics views.

import {addDays, dayOfMonth, daysBetween, formatDayMonth, formatFull, MONTH_SHORT, monthIndex, startOfWeek} from './dates.js';
import {t} from './i18n.js';
import {state} from './state.js';
import {hideTooltip, showTooltip} from './tooltip.js';
import {computed} from './vue.js';

/**
 * Returns the current year, e.g. "2026".
 * @return {string}
 */
export function currentYear() {
  return state.today.slice(0, 4);
}

/**
 * Returns "(2026)" for a full year, "(since 12 Mar)" otherwise.
 * @param {string} from the first day counted
 * @return {string}
 */
export function sinceLabel(from) {
  const year = currentYear();
  if (from === `${year}-01-01`) return `(${year})`;
  return t('(since {date})', {date: formatDayMonth(from)});
}

/**
 * The scrolling year grid of a heatmap: one column per week, from the week of
 * 1 January to the week of 31 December, with the month names above the week
 * of each month's first day. `square(iso)` returns the attributes of the
 * square of a day of the year (class, data, aria); days of the neighbouring
 * years are left blank.
 */
export const YearGrid = {
  name: 'YearGrid',
  props: {
    year: {type: String, required: true},
    square: {type: Function, required: true},
  },
  setup(props) {
    const grid = computed(() => {
      const yearStart = `${props.year}-01-01`;
      const yearEnd = `${props.year}-12-31`;
      const firstWeek = startOfWeek(yearStart);
      const weeks = Math.floor(daysBetween(firstWeek, yearEnd) / 7) + 1;
      const days = [];
      const months = [];
      for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
          const iso = addDays(firstWeek, w * 7 + d);
          const inYear = iso >= yearStart && iso <= yearEnd;
          days.push({iso, inYear});
          if (inYear && dayOfMonth(iso) === 1) {
            months.push({week: w + 1, name: MONTH_SHORT[monthIndex(iso)]});
          }
        }
      }
      return {weeks, days, months};
    });
    return {grid};
  },
  template: `
    <div class="heatmap-scroll">
      <div
        class="heatmap-body"
        :style="{'--weeks': String(grid.weeks)}"
      >
        <div class="heatmap-months">
          <span
            v-for="month in grid.months"
            :key="month.name"
            :style="{'grid-column': String(month.week)}"
          >
            {{ month.name }}
          </span>
        </div>
        <div class="heatmap">
          <template
            v-for="day in grid.days"
            :key="day.iso"
          >
            <div
              v-if="day.inYear"
              v-bind="square(day.iso)"
            ></div>
            <div
              v-else
              class="heat is-outside"
            ></div>
          </template>
        </div>
      </div>
    </div>`,
};

/**
 * Scrolls the year grid below `root` so that today's square is centred, if
 * the grid overflows. Must be called once the grid is in the document.
 * @param {!Element} root
 */
export function centreToday(root) {
  const scroller = root.querySelector('.heatmap-scroll');
  const cell = scroller?.querySelector('.heat.is-today');
  if (!cell) return;
  const box = scroller.getBoundingClientRect();
  const at = cell.getBoundingClientRect();
  scroller.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
}

/**
 * Returns a line of a chart tooltip.
 * @param {string} className
 * @param {string} text
 * @return {!HTMLElement}
 */
function tipLine(className, text) {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  return line;
}

/**
 * Shows a tooltip at once for the chart elements below `container` that match
 * `selector`: their data-tip, or for a heatmap square its date, above their
 * data-status.
 * @param {!Element} container
 * @param {string} selector
 */
export function initChartTooltips(container, selector) {
  container.addEventListener('mouseover', (event) => {
    const target = event.target.closest(selector);
    if (!target) return;
    showTooltip(target, [
      tipLine(
          'tip-date', target.dataset.tip ?? formatFull(target.dataset.date)),
      tipLine('tip-status', target.dataset.status),
    ]);
  });
  container.addEventListener('mouseout', (event) => {
    if (event.target.closest(selector)) hideTooltip();
  });
  // Hide the tooltip when a chart scrolls.
  container.addEventListener(
      'scroll', hideTooltip, {capture: true, passive: true});
  container.addEventListener('mouseleave', hideTooltip);
}
