/**
 * @fileoverview Day statistics, opened from the day summary: perfect days,
 * streaks of them, a year heatmap shaded by each day's share of completed
 * habits, and the average share per weekday and per month, of the current
 * year or an earlier one. The server counts the days and computes the
 * statistics (GET /api/days); this view only shows them.
 */

import {api} from '../data/api.js';
import {remote} from '../data/remote-stats.js';
import {goHome, route} from '../data/route.js';
import {state} from '../data/state.js';
import {AppBar} from '../ui/app-bar.js';
import {AppFactsPanel, AppStatRow, factItem, percent} from '../ui/stat-panels.js';
import {hideTooltip} from '../ui/tooltip.js';
import {AppDayHeatmap, AppYearNavigation, centreToday, currentYear, initChartTooltips, sinceLabel, streakLabel, yearRange} from '../ui/year-grid.js';
import {MONTH_LONG, MONTH_SHORT, WEEKDAY_LONG, WEEKDAY_SHORT} from '../util/dates.js';
import {t} from '../util/i18n.js';
import {computed, nextTick, onMounted, ref, watch} from '../vue.js';

/**
 * The year shown, e.g. "2025", or "" for the current one. Kept for the
 * session only.
 */
const chosenYear = ref('');

/**
 * Formats a number of days.
 * @param {number} n
 * @return {string}
 */
const dayCount = (n) => (n === 1 ? t('1 day') : t('{n} days', {n}));

/**
 * Returns the stat tiles of a year.
 * @param {!DayStats} stats
 * @param {string} year
 * @return {!Array<!Array<string>>}
 */
function statTiles(stats, year) {
  return [
    [
      t('Perfect days {since}', {since: sinceLabel(`${year}-01-01`)}),
      t('{n} of {total}', {n: stats.perfect, total: stats.counted}),
      'calendarCheck',
    ],
    [streakLabel(year), dayCount(stats.currentStreak), 'streak'],
    [t('Best streak'), dayCount(stats.bestStreak), 'trophy'],
    [t('Average per day'), percent(stats.average), 'percent'],
  ];
}

/**
 * Returns the facts: completed habits, days without any, best weekday and
 * month.
 * @param {!DayStats} stats
 * @return {!Array<!Fact>}
 */
function highlights(stats) {
  const items = [
    factItem(t('Habits completed'), String(stats.completed)),
    factItem(t('Days without progress'), dayCount(stats.emptyDays)),
  ];
  if (stats.bestWeekday >= 0) {
    const rate = stats.weekdays[stats.bestWeekday].rate;
    items.push(factItem(
        t('Best weekday'),
        WEEKDAY_LONG[stats.bestWeekday],
        `Ø ${percent(rate)}`));
  }
  if (stats.bestMonth > 0) {
    const rate = stats.months[stats.bestMonth - stats.firstMonth].rate;
    items.push(factItem(
        t('Best month'),
        MONTH_LONG[stats.bestMonth - 1],
        `Ø ${percent(rate)}`));
  }
  return items;
}

/**
 * Returns the bar of a group: its average share, with the number of perfect
 * days in the tooltip.
 * @param {{label: string, name: string, rate: ?number, perfect: number}} group
 * @return {{label: string, name: string, empty: boolean, status: string,
 *     width: string, value: string}}
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
const DayStatsBarPanel = {
  name: 'DayStatsBarPanel',
  props: {
    title: {type: String, required: true},
    bars: {type: Array, required: true},
  },
  template: `
    <section class="panel">
      <h3>{{ title }}</h3>
      <div class="day-stats-bar-panel-bars">
        <div
          v-for="b in bars"
          :key="b.name"
          class="day-stats-bar-panel-bar"
          :class="{'is-empty': b.empty}"
          :data-tip="b.name"
          :data-status="b.status"
        >
          <span class="day-stats-bar-panel-label">{{ b.label }}</span>
          <span class="day-stats-bar-panel-track">
            <span
              class="day-stats-bar-panel-fill"
              :style="{width: b.width}"
            ></span>
          </span>
          <span class="day-stats-bar-panel-value">{{ b.value }}</span>
        </div>
      </div>
    </section>`,
};

/** The day statistics of a year, by default the current one. */
export const TheDayStatsView = {
  name: 'TheDayStatsView',
  components: {
    AppBar,
    AppDayHeatmap,
    AppFactsPanel,
    AppStatRow,
    AppYearNavigation,
    DayStatsBarPanel,
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const root = ref(null);
    const shown = computed(() => route.view === 'days');
    const year = computed({
      get: () => chosenYear.value || currentYear(),
      set: (value) => {
        chosenYear.value = value === currentYear() ? '' : value;
      },
    });
    // The years of the habits counted, those that are not archived.
    const range =
        computed(() => yearRange(state.habits.filter((h) => !h.archivedAt)));
    // Nothing is loaded while the view is hidden, nor before the state is.
    // While another year loads, the last one stays; everything is labelled
    // with the year of the answer shown.
    let previous;
    const data = computed(() => {
      if (!shown.value || !state.today) return undefined;
      const loaded = remote(`days|${year.value}`, () => api.days(year.value));
      previous = loaded ?? previous;
      return previous;
    });
    const shownYear = computed(() => String(data.value?.year ?? ''));

    // The tooltip's target is replaced; the heatmap is scrolled to today once
    // the statistics of a year are shown.
    watch(shownYear, async (loaded) => {
      hideTooltip();
      if (!loaded) return;
      await nextTick();
      centreToday(root.value);
    });
    onMounted(() => {
      initChartTooltips(
          root.value,
          '.heatmap-day[data-date], .day-stats-bar-panel-bar[data-tip]');
    });

    return {
      root,
      state,
      shown,
      year,
      range,
      data,
      shownYear,
      tiles: computed(() => statTiles(data.value.stats, shownYear.value)),
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
      back: goHome,
    };
  },
  template: `
    <main
      id="day-stats-view"
      ref="root"
      class="view stats-view"
      :hidden="!shown"
    >
      <app-bar
        :title="t('Day statistics')"
        :sub="shownYear || year"
        :edit="false"
        @back="back"
      />
      <template v-if="data">
        <app-stat-row :stats="tiles"/>
        <app-facts-panel
          :title="t('Highlights')"
          :items="highlights"
        />
        <day-stats-bar-panel
          :title="t('By weekday')"
          :bars="weekdays"
        />
        <day-stats-bar-panel
          :title="t('By month')"
          :bars="months"
        />
        <section class="panel">
          <app-year-navigation
            v-model:year="year"
            :first="range[0]"
            :last="range[1]"
          />
          <app-day-heatmap
            :year="shownYear"
            :totals="data.totals"
            :today="state.today"
          />
        </section>
      </template>
    </main>`,
};
