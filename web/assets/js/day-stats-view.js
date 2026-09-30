// Day statistics, opened from the day summary: perfect days, streaks of them,
// a year heatmap shaded by each day's share of completed habits, and the
// average share per weekday and per month. The server counts the days and
// computes the statistics (GET /api/days); this view only shows them.

import {api} from './api.js';
import {AppBar} from './app-bar.js';
import {formatDayMonth, formatFull, MONTH_LONG, MONTH_SHORT, WEEKDAY_LONG, WEEKDAY_SHORT} from './dates.js';
import {t} from './i18n.js';
import {remote} from './remote-stats.js';
import {goHome, route} from './route.js';
import {factItem, FactsPanel, StatRow} from './stat-panels.js';
import {state} from './state.js';
import {hideTooltip} from './tooltip.js';
import {computed, nextTick, onMounted, ref, watch} from './vue.js';
import {centreToday, currentYear, initChartTooltips, sinceLabel, YearGrid} from './year-grid.js';

/**
 * Formats a rate as a percentage, or a dash for none.
 * @param {?number} rate
 * @return {string}
 */
const percent = (rate) => (rate === null ? '–' : `${Math.round(rate * 100)} %`);

/**
 * Formats a number of days.
 * @param {number} n
 * @return {string}
 */
const dayCount = (n) => (n === 1 ? t('1 day') : t('{n} days', {n}));

/**
 * Returns the stat tiles of the year.
 * @param {!Object} stats the server's day statistics
 * @param {string} from the first day counted
 * @return {!Array<!Array<string>>}
 */
function statTiles(stats, from) {
  return [
    [
      t('Perfect days {since}', {since: sinceLabel(from)}),
      t('{n} of {total}', {n: stats.perfect, total: stats.counted}),
      'calendarCheck',
    ],
    [t('Current streak'), dayCount(stats.currentStreak), 'streak'],
    [t('Best streak'), dayCount(stats.bestStreak), 'trophy'],
    [t('Average per day'), percent(stats.average), 'percent'],
  ];
}

/**
 * Returns the facts: completed habits, days without any, best weekday and
 * month.
 * @param {!Object} stats
 * @return {!Array<!Object>}
 */
function highlights(stats) {
  const items = [
    factItem(t('Habits completed'), String(stats.completed)),
    factItem(t('Days without progress'), dayCount(stats.emptyDays)),
  ];
  if (stats.bestWeekday >= 0) {
    const rate = stats.weekdays[stats.bestWeekday].rate;
    items.push(factItem(
        t('Best weekday'), WEEKDAY_LONG[stats.bestWeekday],
        `Ø ${percent(rate)}`));
  }
  if (stats.bestMonth > 0) {
    const rate = stats.months[stats.bestMonth - stats.firstMonth].rate;
    items.push(factItem(
        t('Best month'), MONTH_LONG[stats.bestMonth - 1],
        `Ø ${percent(rate)}`));
  }
  return items;
}

/**
 * Returns the attributes of the square of a day from its total ({due,
 * done}): the shade grows with the share of completed habits.
 * @param {string} iso
 * @param {{due: number, done: number}} total
 * @return {!Object}
 */
function heatSquare(iso, {due, done}) {
  const ahead = iso > state.today;
  const counted = !ahead && due > 0;
  const status = heatStatus(due, done, ahead);
  const when = iso === state.today ?
      t('Today, {date}', {date: formatFull(iso)}) :
      formatFull(iso);
  return {
    class: [
      'heat',
      iso === state.today && 'is-today',
      ahead && 'is-future',
      !ahead && due === 0 && 'is-off',
      counted && done === due && 'is-perfect',
    ],
    style: counted ? {'--rate': (done / due).toFixed(3)} : null,
    'data-date': iso,
    'data-status': status,
    'role': 'img',
    'aria-label': `${when} — ${status}`,
  };
}

/**
 * Describes a day of the heatmap.
 * @param {number} due
 * @param {number} done
 * @param {boolean} ahead whether the day is in the future
 * @return {string}
 */
function heatStatus(due, done, ahead) {
  if (due === 0) return t('Nothing due on this day');
  if (ahead) {
    return due === 1 ? t('1 habit due') : t('{n} habits due', {n: due});
  }
  return `${t('{done} of {due} done', {done, due})} · ${percent(done / due)}`;
}

/**
 * Returns the bar of a group: its average share, with the number of perfect
 * days in the tooltip.
 * @param {{label: string, name: string, rate: ?number, perfect: number}} group
 * @return {!Object}
 */
function bar({label, name, rate, perfect}) {
  const perfectDays = t('Perfect days: {n}', {n: perfect});
  return {
    label,
    name,
    empty: rate === null,
    status: rate === null ? t('Nothing due') :
                            `Ø ${percent(rate)} · ${perfectDays}`,
    width: `${Math.round((rate ?? 0) * 100)}%`,
    value: percent(rate),
  };
}

/**
 * A panel of horizontal bars, one per group (see bar).
 */
const BarPanel = {
  name: 'BarPanel',
  props: {
    title: {type: String, required: true},
    bars: {type: Array, required: true},
  },
  template: `
    <section class="panel">
      <h3>{{ title }}</h3>
      <div class="day-bars">
        <div
          v-for="b in bars"
          :key="b.name"
          class="day-bar"
          :class="{'is-empty': b.empty}"
          :data-tip="b.name"
          :data-status="b.status"
        >
          <span class="day-bar-label">{{ b.label }}</span>
          <span class="day-bar-track">
            <span
              class="day-bar-fill"
              :style="{width: b.width}"
            ></span>
          </span>
          <span class="day-bar-value">{{ b.value }}</span>
        </div>
      </div>
    </section>`,
};

/** The day statistics of the current year. */
export const DayStatsView = {
  name: 'DayStatsView',
  components: {AppBar, BarPanel, FactsPanel, StatRow, YearGrid},
  setup() {
    const root = ref(null);
    const shown = computed(() => route.view === 'days');
    const year = computed(() => currentYear());
    // Nothing is loaded while the view is hidden, nor before the state is.
    const data = computed(
        () => shown.value && state.today ?
            remote(`days|${year.value}`, () => api.days(year.value)) :
            undefined);
    const byDate = computed(
        () => new Map((data.value?.totals ?? []).map((d) => [d.date, d])));

    // The tooltip's target is replaced; the heatmap is scrolled to today once
    // the statistics are shown.
    watch(() => Boolean(data.value), async (loaded) => {
      hideTooltip();
      if (!loaded) return;
      await nextTick();
      centreToday(root.value);
    });
    onMounted(() => {
      initChartTooltips(root.value, '.heat[data-date], .day-bar[data-tip]');
    });

    return {
      root,
      shown,
      year,
      data,
      tiles: computed(() => statTiles(data.value.stats, `${year.value}-01-01`)),
      highlights: computed(() => highlights(data.value.stats)),
      weekdays: computed(
          () => data.value.stats.weekdays.map(
              (group, i) => bar(
                  {label: WEEKDAY_SHORT[i], name: WEEKDAY_LONG[i], ...group}))),
      // The server's months run from the first with due habits; firstMonth
      // is 1 for January.
      months: computed(() => (data.value.stats.months ?? []).map((group, i) => {
        const month = data.value.stats.firstMonth - 1 + i;
        return bar(
            {label: MONTH_SHORT[month], name: MONTH_LONG[month], ...group});
      })),
      square: (iso) =>
          heatSquare(iso, byDate.value.get(iso) ?? {due: 0, done: 0}),
      legendRange: computed(
          () => `${formatDayMonth(`${year.value}-01-01`)} – ` +
              `${formatDayMonth(`${year.value}-12-31`)} ${year.value}`),
      back: goHome,
    };
  },
  template: `
    <main
      id="day-stats-view"
      ref="root"
      class="view"
      :hidden="!shown"
    >
      <app-bar
        :title="t('Day statistics')"
        :sub="year"
        :edit="false"
        @back="back"
      />
      <template v-if="data">
        <stat-row :stats="tiles"/>
        <facts-panel
          :title="t('Highlights')"
          :items="highlights"
        />
        <bar-panel
          :title="t('By weekday')"
          :bars="weekdays"
        />
        <bar-panel
          :title="t('By month')"
          :bars="months"
        />
        <section class="panel days-heatmap">
          <h3>{{ t('Year {year}', {year}) }}</h3>
          <year-grid
            :year="year"
            :square="square"
          />
          <div class="heatmap-legend">
            <span>{{ legendRange }}</span>
            <span style="flex: 1"></span>
            <span>0 %</span>
            <span
              v-for="rate in [0, 0.25, 0.5, 0.75]"
              :key="rate"
              class="heat"
              :style="{'--rate': String(rate)}"
            ></span>
            <span
              class="heat is-perfect"
              style="--rate: 1"
            ></span>
            <span>100 %</span>
          </div>
        </section>
      </template>
    </main>`,
};
