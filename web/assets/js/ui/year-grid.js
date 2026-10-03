/**
 * @fileoverview The calendar years the statistics views show: the label of the
 * range counted, the navigation between the years, the year grid of the
 * heatmaps with its tooltips, the label of a day in it and the heatmap of the
 * day statistics. Used by the habit, category and day statistics views.
 */

import {state} from '../data/state.js';
import {addDays, dayOfMonth, daysBetween, formatDayMonth, formatFull, MONTH_SHORT, monthIndex, startOfWeek} from '../util/dates.js';
import {plural, t} from '../util/i18n.js';
import {computed, nextTick, onMounted, onUnmounted, ref} from '../vue.js';

import {percent} from './stat-panels.js';
import {hideTooltip, showTooltip} from './tooltip.js';

/** @import {DayTotal, Habit} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */

/**
 * Returns the current year, e.g. "2026".
 * @return {string}
 */
export function currentYear() {
  return state.today.slice(0, 4);
}

/**
 * Returns the first and the last year the history of `habits` covers, as
 * numbers: from the year the earliest of them starts (historyStart) to the
 * current one.
 * @param {!Array<!Habit>} habits
 * @return {!Array<number>}
 */
export function yearRange(habits) {
  const last = Number(currentYear());
  const starts = habits.map((h) => Number(h.historyStart?.slice(0, 4)) || last);
  return [Math.min(last, ...starts), last];
}

/**
 * Labels the streak of perfect days of `year`: the current one, or for a past
 * year the one at its end.
 * @param {string} year
 * @return {string}
 */
export function streakLabel(year) {
  return year === currentYear() ? t('Current streak') :
                                  t('Streak at the end of {year}', {year});
}

/**
 * Returns the label of a day of the year grid: its full date, and for today
 * "Today" before it.
 * @param {string} iso
 * @param {string} today
 * @return {string}
 */
export function dayLabel(iso, today) {
  const date = formatFull(iso);
  return iso === today ? t('Today, {date}', {date}) : date;
}

/**
 * Returns "(2026)" for a full year, "(since 12 Mar)" otherwise.
 * @param {string} from the first day counted
 * @return {string}
 */
export function sinceLabel(from) {
  if (from.endsWith('-01-01')) return `(${from.slice(0, 4)})`;
  return t('(since {date})', {date: formatDayMonth(from)});
}

/**
 * The heading of a year panel, "Year 2026", with arrows to the years before and
 * after, from `first` to `last`. `year` is bound with v-model:year.
 */
export const AppYearNavigation = {
  name: 'AppYearNavigation',
  props: {
    year: {type: String, required: true},
    first: {type: Number, required: true},
    last: {type: Number, required: true},
  },
  emits: ['update:year'],
  /**
   * @param {{year: string, first: number, last: number}} props
   * @param {{emit: function(string, *): void}} context
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props, {emit}) {
    /** @type {!Ref<?HTMLElement>} */
    const el = ref(null);
    return {
      el,
      /**
       * Shows the year before (-1) or after (+1) the one shown, keeping the
       * focus on the arrows: at the first or last year, the other one takes
       * it.
       * @param {number} delta
       * @param {!Event} event
       */
      show: async (delta, event) => {
        const button =
            /** @type {!HTMLButtonElement} */ (event.currentTarget);
        const next = Math.min(
            props.last, Math.max(props.first, Number(props.year) + delta));
        emit('update:year', String(next));
        await nextTick();
        const other = el.value?.querySelector('button:not(:disabled)');
        if (button.disabled && other instanceof HTMLElement) other.focus();
      },
    };
  },
  template: `
    <div
      ref="el"
      class="app-year-navigation"
    >
      <h3>{{ t('Year {year}', {year}) }}</h3>
      <div class="app-year-navigation-buttons">
        <button
          v-tooltip="t('Previous year')"
          type="button"
          class="icon-button"
          data-action="year-earlier"
          :aria-label="t('Previous year')"
          :disabled="Number(year) <= first"
          @click="show(-1, $event)"
        >
          <app-icon name="chevronLeft"/>
        </button>
        <button
          v-tooltip="t('Next year')"
          type="button"
          class="icon-button"
          data-action="year-later"
          :aria-label="t('Next year')"
          :disabled="Number(year) >= last"
          @click="show(1, $event)"
        >
          <app-icon name="chevronRight"/>
        </button>
      </div>
    </div>`,
};

/**
 * The scrolling year grid of a heatmap: one column per week, from the week of
 * 1 January to the week of 31 December, with the month names above the week
 * of each month's first day. `square(iso)` returns the attributes of the
 * square of a day of the year (class, data, aria); days of the neighbouring
 * years are left blank.
 */
export const AppYearGrid = {
  name: 'AppYearGrid',
  props: {
    year: {type: String, required: true},
    square: {type: Function, required: true},
  },
  /**
   * @param {{year: string, square: function(string): !Object<string, *>}}
   *     props
   * @return {!Object<string, *>} the bindings of the template
   */
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
    <div class="app-year-grid">
      <div
        class="app-year-grid-body"
        :style="{'--weeks': String(grid.weeks)}"
      >
        <div class="app-year-grid-months">
          <span
            v-for="month in grid.months"
            :key="month.name"
            :style="{'grid-column': String(month.week)}"
          >
            {{ month.name }}
          </span>
        </div>
        <div class="app-year-grid-days">
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
              class="heatmap-day is-outside"
            ></div>
          </template>
        </div>
      </div>
    </div>`,
};

/**
 * Describes a day of the day heatmap from its total.
 * @param {number} due
 * @param {number} done
 * @param {boolean} ahead whether the day is in the future
 * @return {string}
 */
function dayStatus(due, done, ahead) {
  if (due === 0) return t('Nothing due on this day');
  if (ahead) return plural(due, '{n} habit due', '{n} habits due');
  return `${t('{done} of {due} done', {done, due})} · ${percent(done / due)}`;
}

/**
 * Returns the attributes of the square of a day of the day heatmap from its
 * total ({due, done, bonus}): the shade grows with the share of completed
 * habits.
 * @param {string} iso
 * @param {{due: number, done: number, bonus: number}} total
 * @param {string} today
 * @return {!Object<string, *>} the attributes
 */
function daySquare(iso, {due, done, bonus}, today) {
  const ahead = iso > today;
  const counted = !ahead && due > 0;
  const bonusText = bonus > 0 ? ` · ${t('+{n} bonus', {n: bonus})}` : '';
  const status = dayStatus(due, done, ahead) + bonusText;
  return {
    'class': [
      'heatmap-day',
      iso === today && 'is-today',
      ahead && 'is-future',
      !ahead && due === 0 && 'is-off',
      counted && done === due && 'is-perfect',
    ],
    'style': counted ? {'--rate': (done / due).toFixed(3)} : null,
    'data-date': iso,
    'data-status': status,
    'role': 'img',
    'aria-label': `${dayLabel(iso, today)} — ${status}`,
  };
}

/**
 * The heatmap of the day statistics of `year`: each day shaded by its share
 * of completed habits, from the totals of GET /api/days, with its legend.
 * `today` marks the current day and the future. Used by the day statistics
 * and the category view.
 */
export const AppDayHeatmap = {
  name: 'AppDayHeatmap',
  components: {AppYearGrid},
  props: {
    year: {type: String, required: true},
    totals: {type: Array, required: true},
    today: {type: String, required: true},
  },
  /**
   * @param {{year: string, totals: !Array<!DayTotal>, today: string}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const byDate = computed(
        () => new Map(props.totals.map((total) => [total.date, total])));
    return {
      square: (iso) => daySquare(
          iso,
          byDate.value.get(iso) ?? {due: 0, done: 0, bonus: 0},
          props.today),
      legendRange: computed(
          () => `${formatDayMonth(`${props.year}-01-01`)} – ` +
              `${formatDayMonth(`${props.year}-12-31`)} ${props.year}`),
    };
  },
  template: `
    <div class="app-day-heatmap">
      <app-year-grid
        :year="year"
        :square="square"
      />
      <div class="heatmap-legend">
        <span class="heatmap-legend-range">{{ legendRange }}</span>
        <span>0 %</span>
        <span
          v-for="rate in [0, 0.25, 0.5, 0.75]"
          :key="rate"
          class="heatmap-day"
          :style="{'--rate': String(rate)}"
        ></span>
        <span
          class="heatmap-day is-perfect"
          :style="{'--rate': '1'}"
        ></span>
        <span>100 %</span>
      </div>
    </div>`,
};

/**
 * Scrolls the year grid below `root` so that today's square is centred, if
 * the grid overflows. Must be called once the grid is in the document.
 * @param {!Element} root
 */
export function centreToday(root) {
  const scroller = root.querySelector('.app-year-grid');
  const cell = scroller?.querySelector('.heatmap-day.is-today');
  if (!scroller || !cell) return;
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
 * Shows a tooltip at once for the chart elements below `root` that match
 * `selector`: their data-tip, or for a heatmap square its date, above their
 * data-status. The listeners are removed when the calling component is
 * unmounted.
 * @param {!Ref<?HTMLElement>} root
 * @param {string} selector
 */
export function useChartTooltips(root, selector) {
  /**
   * Shows the tooltip of the chart element under the mouse.
   * @param {!MouseEvent} event
   */
  const onOver = (event) => {
    const target = /** @type {!Element} */ (event.target).closest(selector);
    if (!(target instanceof HTMLElement)) return;
    const {tip, date, status} = target.dataset;
    showTooltip(target, [
      tipLine('tooltip-date', tip ?? (date ? formatFull(date) : '')),
      tipLine('tooltip-status', status ?? ''),
    ]);
  };
  /**
   * Hides the tooltip when the mouse leaves a chart element.
   * @param {!MouseEvent} event
   */
  const onOut = (event) => {
    if (/** @type {!Element} */ (event.target).closest(selector)) {
      hideTooltip();
    }
  };
  // Also hidden when a chart scrolls.
  const scrolling = {capture: true, passive: true};

  onMounted(() => {
    const container = root.value;
    if (!container) return;
    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseout', onOut);
    container.addEventListener('scroll', hideTooltip, scrolling);
    container.addEventListener('mouseleave', hideTooltip);
  });
  onUnmounted(() => {
    const container = root.value;
    if (!container) return;
    container.removeEventListener('mouseover', onOver);
    container.removeEventListener('mouseout', onOut);
    container.removeEventListener('scroll', hideTooltip, scrolling);
    container.removeEventListener('mouseleave', hideTooltip);
  });
}
