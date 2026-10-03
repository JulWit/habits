/**
 * @fileoverview Habit detail view: statistics, activity chart and calendar
 * heatmap.
 */

import * as actions from '../data/actions.js';
import {api} from '../data/api.js';
import * as habitHelpers from '../data/habit-helpers.js';
import {useRemote} from '../data/remote-stats.js';
import {goHome, route} from '../data/route.js';
import {habitById, state} from '../data/state.js';
import {openHabitEditor} from '../dialogs/habit-editor.js';
import {openSkipEditor} from '../dialogs/skip-editor.js';
import {AppBar} from '../ui/app-bar.js';
import {colorValue, hasHabitIcon} from '../ui/icons.js';
import {AppFactsPanel, AppStatRow, changedItem, createdItem, daysAgo, factItem, percent, rateLabel} from '../ui/stat-panels.js';
import {hideTooltip} from '../ui/tooltip.js';
import {AppYearGrid, AppYearNavigation, centreToday, currentYear, dayLabel, useChartTooltips, yearRange} from '../ui/year-grid.js';
import {addDays, dayOfMonth, formatDayMonth, formatFull, formatLong, MONTH_LONG, MONTH_SHORT, monthIndex} from '../util/dates.js';
import {plural, t} from '../util/i18n.js';
import {computed, nextTick, ref, watch} from '../vue.js';

/** @import {Habit, Schedule, Totals} from '../data/state.js' */
/** @import {Fact} from '../ui/stat-panels.js' */
/** @import {Ref} from '../vue.js' */

/**
 * Chart granularities, each covering the year to date. `barMin` is the minimum
 * bar width before the chart scrolls; `every` is the label interval.
 * @const {!Object<string, {label: string, barMin: string, every: number}>}
 */
const GRAINS = {
  day: {label: t('Day'), barMin: '9px', every: 7},
  week: {label: t('Week'), barMin: '14px', every: 4},
  month: {label: t('Month'), barMin: '24px', every: 1},
};

/**
 * Formats a streak with its unit: "1 day", "6 days", "1 week", "2 months".
 * @param {number} count
 * @param {string} unit days, weeks or months
 * @return {string}
 */
function streakText(count, unit) {
  if (unit === 'months') return plural(count, '{n} month', '{n} months');
  if (unit === 'weeks') return plural(count, '{n} week', '{n} weeks');
  return plural(count, '{n} day', '{n} days');
}

/**
 * Returns the stat tiles from the server's statistics of the habit. Without a
 * due day in its window, the rate is a dash rather than 0 %.
 * @param {!Habit} habit
 * @return {!Array<!Array<string>>}
 */
function statTiles(habit) {
  const s = habit.stats;
  return [
    [t('Current streak'), streakText(s.currentStreak, s.streakUnit), 'streak'],
    [t('Best streak'), streakText(s.bestStreak, s.streakUnit), 'trophy'],
    [rateLabel(), percent(s.expected > 0 ? s.completionRate : null), 'percent'],
    [t('Total'), habitHelpers.formatTotal(habit, s.total), 'total'],
  ];
}

/**
 * Returns how the habit is set up: frequency, daily target (not for check
 * habits), earlier schedules, category and, if archived, its status.
 * @param {!Habit} habit
 * @return {!Array<!Fact>}
 */
function details(habit) {
  const all = habit.schedules;
  // With earlier schedules, the current one is dated.
  const since = all.length > 1 ?
      t('since {date}', {date: formatLong(all[all.length - 1].from)}) :
      '';
  const items = [factItem(
      t('Frequency'),
      habitHelpers.describeFrequency(
          habitHelpers.currentSchedule(habit).frequency),
      since)];
  const target = habitHelpers.describeTarget(habit);
  if (target) items.push(factItem(t('Daily target'), target, since));
  // Earlier schedules, newest first.
  for (let i = all.length - 2; i >= 0; i--) {
    const until = formatLong(addDays(all[i + 1].from, -1));
    items.push(factItem(
        t('Until {date}', {date: until}), describeSchedule(habit, all[i])));
  }
  const category = state.categories.find((c) => c.id === habit.categoryId);
  items.push(factItem(t('Category'), category?.name ?? t('No category')));
  if (habit.archivedAt) items.push(factItem(t('Status'), t('Archived')));
  return items;
}

/**
 * Describes a schedule of the habit: its frequency and, if any, its target.
 * @param {!Habit} habit
 * @param {!Schedule} schedule
 * @return {string}
 */
function describeSchedule(habit, schedule) {
  return [
    habitHelpers.describeFrequency(schedule.frequency),
    habitHelpers.describeTarget(habit, schedule),
  ].filter(Boolean)
      .join(' · ');
}

/**
 * Returns when the habit was created, last completed and last changed (the
 * server's updatedAt).
 * @param {!Habit} habit
 * @return {!Array<!Fact>}
 */
function activity(habit) {
  // The server leaves it empty if the habit was never done.
  const done = habit.stats?.lastDone || null;
  return [
    createdItem(habit.createdAt),
    factItem(
        t('Last done'),
        done ? formatLong(done) : t('Not yet'),
        done ? daysAgo(done) : ''),
    changedItem(habit.updatedAt),
  ];
}

/**
 * Returns the attributes of the square of a day in the heatmap.
 * @param {!Habit} habit
 * @param {string} iso
 * @return {!Object<string, *>} the attributes
 */
function heatSquare(habit, iso) {
  const {value} = habitHelpers.entryOn(habit, iso);
  const ahead = iso > state.today;
  // Unscheduled days are marked in the future too, so the schedule stays
  // visible. Days before the habit began are not counted, so they look the
  // same.
  const off = (!habitHelpers.isScheduled(habit, iso) && value === 0) ||
      habitHelpers.isBeforeStart(habit, iso);
  const skipped = !off && habitHelpers.isSkipped(habit, iso);
  const status = heatStatus(habit, iso, value);
  const when = dayLabel(iso, state.today);

  return {
    'class': [
      'heatmap-day',
      // Used by centreToday().
      iso === state.today && 'is-today',
      ahead && 'is-future',
      off && 'is-off',
      skipped && 'is-skipped',
    ],
    'data-date': iso,
    'data-status': status,
    'data-level': off || skipped || ahead ?
        undefined :
        habitHelpers.heatLevel(habit, iso, value),
    // Uses the chart tooltip instead of a title attribute; the aria-label
    // holds the same text.
    'role': 'img',
    'aria-label': `${when} — ${status}`,
  };
}

/**
 * Describes a day of the heatmap. Future days only show planned values.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {number} value
 * @return {string}
 */
function heatStatus(habit, iso, value) {
  if (habitHelpers.isSkipped(habit, iso)) return t('skipped');
  if (habitHelpers.isBeforeStart(habit, iso)) {
    return t('before the habit began');
  }
  const vars = {
    value: habitHelpers.formatValue(habit, value),
    target: habitHelpers.formatValue(habit, habitHelpers.target(habit, iso)),
  };
  if (iso > state.today) {
    if (value > 0) return t('{value} planned', vars);
    return habitHelpers.isScheduled(habit, iso) ? t('still ahead') :
                                                  t('not scheduled');
  }
  if (habitHelpers.isLimit(habit, iso) &&
      habitHelpers.isScheduled(habit, iso)) {
    if (value > 0) return t('{value} of at most {target}', vars);
    return habitHelpers.isDone(habit, iso) ? t('nothing, within the limit') :
                                             t('nothing recorded');
  }
  if (value > 0) return t('{value} of {target}', vars);
  return habitHelpers.isScheduled(habit, iso) ? t('nothing recorded') :
                                                t('not scheduled');
}

/**
 * Returns a bar of the cumulative chart of `grain`: its height is the running
 * total, the period's own sum is highlighted at its top.
 * @param {!Habit} habit
 * @param {string} grain
 * @param {{start: string, sum: number, cumulative: number}} bucket
 * @param {number} total
 * @param {number} index
 * @param {number} count the number of buckets
 * @return {{start: string, tip: string, status: string, height: string,
 *     zero: boolean, gain: ?string, label: string}}
 */
function chartColumn(
    habit, grain, {start, sum, cumulative: running}, total, index, count) {
  // Shown by the shared tooltip.
  const tip = bucketName(grain, start);
  const runningTotal = habitHelpers.formatTotal(habit, running);
  const status = sum > 0 ?
      t('{total} · of that +{sum}',
        {total: runningTotal, sum: habitHelpers.formatTotal(habit, sum)}) :
      t('{total} · nothing added', {total: runningTotal});
  // Counted from the end, so the latest bucket is always labelled.
  const labelled = (count - 1 - index) % GRAINS[grain].every === 0;
  return {
    start,
    tip,
    status,
    height: `${(running / total) * 100}%`,
    // Hides bars before the first entry.
    zero: running === 0,
    gain: sum > 0 && running > 0 ? `${(sum / running) * 100}%` : null,
    label: !labelled      ? '' :
        grain === 'month' ? MONTH_SHORT[monthIndex(start)] :
                            `${dayOfMonth(start)}.${monthIndex(start) + 1}.`,
  };
}

/**
 * Returns the tooltip label of a bucket of `grain`.
 * @param {string} grain
 * @param {string} start
 * @return {string}
 */
function bucketName(grain, start) {
  if (grain === 'month') {
    return t('End of {month}', {month: MONTH_LONG[monthIndex(start)]});
  }
  if (grain === 'week') {
    return t('Week from {date}', {date: formatDayMonth(start)});
  }
  return formatFull(start);
}

/**
 * The cumulative chart of a countable habit: each bar is the running total at
 * the end of its day, week or month, with the period's own sum highlighted at
 * the top. The server sums the values (GET /api/habits/{id}/totals). The
 * chart scrolls to its end (today) whenever it is drawn anew. `grain` is the
 * period of a bar, bound with v-model:grain.
 */
const HabitCumulativeChart = {
  name: 'HabitCumulativeChart',
  props: {
    habit: {type: Object, required: true},
    year: {type: String, required: true},
    grain: {type: String, required: true},
  },
  emits: ['update:grain'],
  /**
   * @param {{habit: !Habit, year: string, grain: string}} props
   * @param {{emit: function(string, *): void}} context
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props, {emit}) {
    /** @type {!Ref<?HTMLElement>} */
    const scroller = ref(null);
    // Until the first answer of a year and period, the chart is empty.
    const {data} = useRemote(
        () => `totals|${props.habit.id}|${props.year}|${props.grain}`,
        (signal) =>
            api.habitTotals(props.habit.id, props.year, props.grain, signal));
    /** @type {!Ref<(!Totals|undefined)>} */
    const summary = data;
    const columns = computed(() => {
      const s = summary.value;
      if (!s) return [];
      return s.buckets.map(
          (bucket, i) => chartColumn(
              props.habit, props.grain, bucket, s.total, i, s.buckets.length));
    });
    /**
     * Formats a total of the habit.
     * @param {number} value
     * @return {string}
     */
    const format = (value) => habitHelpers.formatTotal(props.habit, value);
    /** Scrolls the chart to its newest column. */
    const showNewest = () => {
      const el = scroller.value;
      if (el) el.scrollLeft = el.scrollWidth;
    };
    watch(columns, showNewest, {flush: 'post', immediate: true});

    return {
      scroller,
      summary,
      columns,
      format,
      // The period, as the radio buttons bind it.
      period: computed({
        get: () => props.grain,
        set: (value) => emit('update:grain', value),
      }),
      GRAINS,
      emptyText: computed(
          () => props.year === currentYear() ?
              t('No entries in {year} yet.', {year: props.year}) :
              t('No entries in {year}.', {year: props.year})),
      // The texts between the figures of the summary line start and end with
      // a space.
      scopeText: computed(
          () => t(
              ' {scope} · avg ', {scope: t('in {year}', {year: props.year})})),
      daysText: computed(
          () => plural(
              summary.value?.activeDays ?? 0,
              ' on {n} active day · best day ',
              ' on {n} active days · best day ')),
      // Average per day with an entry.
      average: computed(
          () => summary.value ?
              Math.round(summary.value.total / summary.value.activeDays) :
              0),
      chartStyle: computed(() => ({
                             '--cols': String(columns.value.length),
                             '--bar-min': GRAINS[props.grain].barMin,
                           })),
    };
  },
  // Until the first answer arrives, the chart is empty. The scale line marks
  // the year's total, outside the scrolling area; bars and labels scroll
  // together.
  template: `
    <section class="panel habit-cumulative-chart">
      <div class="habit-cumulative-chart-head">
        <h3>{{ t('Cumulative') }}</h3>
        <div
          class="segmented habit-cumulative-chart-grain"
          role="radiogroup"
          :aria-label="t('Period')"
        >
          <label
            v-for="(info, key) in GRAINS"
            :key="key"
          >
            <input
              v-model="period"
              type="radio"
              name="habit-cumulative-chart-grain"
              :value="key"
            >
            <span>{{ info.label }}</span>
          </label>
        </div>
      </div>
      <div
        v-if="!summary"
        class="habit-cumulative-chart-loading"
      ></div>
      <div v-else-if="summary.total === 0">
        <p class="habit-cumulative-chart-empty">
          {{ emptyText }}
        </p>
      </div>
      <div v-else>
        <p class="habit-cumulative-chart-summary">
          <strong>{{ format(summary.total) }}</strong>{{ scopeText }}
          <strong>{{ format(average) }}</strong>{{ daysText }}
          <strong>{{ format(summary.best) }}</strong>
        </p>
        <div
          class="habit-cumulative-chart-plot"
          :class="{'is-fine': grain !== 'month'}"
          :style="chartStyle"
        >
          <div class="habit-cumulative-chart-scale">{{ format(summary.total) }}
          </div>
          <div
            ref="scroller"
            class="habit-cumulative-chart-scroll"
          >
            <div class="habit-cumulative-chart-track">
              <div class="habit-cumulative-chart-bars">
                <!-- An accessible name, as the tooltip requires a pointer. -->
                <div
                  v-for="col in columns"
                  :key="col.start"
                  class="habit-cumulative-chart-column"
                  :data-tip="col.tip"
                  :data-status="col.status"
                  role="img"
                  :aria-label="col.tip + ': ' + col.status"
                >
                  <div
                    class="habit-cumulative-chart-bar"
                    :class="{'is-zero': col.zero}"
                    :style="{height: col.height}"
                  >
                    <div
                      v-if="col.gain"
                      class="habit-cumulative-chart-gain"
                      :style="{height: col.gain}"
                    ></div>
                  </div>
                </div>
              </div>
              <div class="habit-cumulative-chart-months">
                <span
                  v-for="col in columns"
                  :key="col.start"
                >
                  <i v-if="col.label">{{ col.label }}</i>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`,
};

/**
 * The habit view: its title bar, how it is set up, its statistics, the
 * cumulative chart (only for countable habits), the heatmap of a year and its
 * activity.
 */
export const TheHabitView = {
  name: 'TheHabitView',
  components: {
    AppBar,
    HabitCumulativeChart,
    AppFactsPanel,
    AppStatRow,
    AppYearGrid,
    AppYearNavigation,
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const root = ref(null);
    // Nothing is shown, or loaded, while the view is hidden.
    const habit = computed(
        () => route.view === 'habit' && route.id ? habitById(route.id) : null);
    const shownId = computed(() => habit.value?.id ?? null);
    // The year the heatmap and the cumulative chart show, e.g. "2025", and
    // the period of the chart's bars; both are kept for the session only.
    const shownYear = ref('');
    const grain = ref('month');

    // Another habit opens with the current year. The tooltip's target is
    // about to be replaced; the heatmap is scrolled to today once it shows
    // another habit or year.
    /** @type {?string} */
    let shownFor = null;
    watch(shownId, (id) => {
      if (id && id !== shownFor) {
        shownFor = id;
        shownYear.value = currentYear();
      }
    }, {immediate: true, flush: 'sync'});
    watch([shownId, shownYear], async () => {
      hideTooltip();
      await nextTick();
      if (root.value) centreToday(root.value);
    });
    useChartTooltips(
        root,
        '.heatmap-day[data-date], .habit-cumulative-chart-column[data-tip]');

    const range = computed(() => yearRange(habit.value ? [habit.value] : []));

    const archived = computed(() => habit.value?.archivedAt != null);
    return {
      root,
      habit,
      shownYear,
      grain,
      range,
      // The habit's colour for the view.
      colorStyle: computed(
          () => habit.value ? {'--habit-color': colorValue(habit.value.color)} :
                              null),
      hasHabitIcon,
      isCountable: habitHelpers.isCountable,
      stats: computed(() => habit.value ? statTiles(habit.value) : []),
      details: computed(() => habit.value ? details(habit.value) : []),
      activity: computed(() => habit.value ? activity(habit.value) : []),
      /**
       * Returns the heatmap square of `iso`.
       * @param {string} iso
       * @return {?Object<string, *>}
       */
      square: (iso) => habit.value ? heatSquare(habit.value, iso) : null,
      legendRange: computed(() => {
        const year = shownYear.value;
        // The grid covers the whole year.
        return `${formatDayMonth(`${year}-01-01`)} – ` +
            `${formatDayMonth(`${year}-12-31`)} ${year}`;
      }),
      menu: computed(
          () =>
              [{action: 'skip', label: t('Skip days…'), icon: 'skip'},
               archived.value ? {
                 action: 'archive',
                 label: t('Reactivate'),
                 icon: 'unarchive',
               } :
                                {
                                  action: 'archive',
                                  label: t('Archive', {context: 'verb'}),
                                  icon: 'archive',
                                },
               {
                 action: 'delete',
                 label: t('Delete'),
                 icon: 'trash',
                 danger: true,
               },
    ]),
      back: goHome,
      edit: () => openHabitEditor(habit.value),
      /**
       * Runs an action of the overflow menu.
       * @param {string} action
       */
      onMenu: (action) => {
        if (!habit.value) return;
        const id = habit.value.id;
        if (action === 'skip') openSkipEditor(habit.value);
        if (action === 'archive') actions.toggleArchive(id);
        if (action === 'delete') actions.deleteHabit(id);
      },
    };
  },
  // How the habit is set up comes first, then its statistics and the year,
  // then its activity. Frequency and target are in the details panel.
  template: `
    <main
      id="habit-view"
      ref="root"
      class="view stats-view"
      :hidden="!habit"
      :style="colorStyle"
    >
      <template v-if="habit">
        <app-bar
          :title="habit.name"
          :menu="menu"
          @back="back"
          @edit="edit"
          @action="onMenu"
        >
          <template #badge>
            <!-- Without an icon, a dot in the habit's colour. -->
            <app-icon-badge
              v-if="hasHabitIcon(habit.icon)"
              class="habit-icon"
              :icon="habit.icon"
              :color="habit.color"
            />
            <span
              v-else
              class="color-dot"
            ></span>
          </template>
        </app-bar>
        <app-facts-panel
          :title="t('Details')"
          :items="details"
        />
        <app-stat-row :stats="stats"/>
        <habit-cumulative-chart
          v-if="isCountable(habit)"
          :key="habit.id"
          v-model:grain="grain"
          :habit="habit"
          :year="shownYear"
        />
        <section class="panel">
          <app-year-navigation
            v-model:year="shownYear"
            :first="range[0]"
            :last="range[1]"
          />
          <app-year-grid
            :year="shownYear"
            :square="square"
          />
          <div class="heatmap-legend">
            <span class="heatmap-legend-range">{{ legendRange }}</span>
            <span>{{ t('less') }}</span>
            <span
              v-for="level in [0, 1, 2, 3, 4]"
              :key="level"
              class="heatmap-day"
              :data-level="level"
            ></span>
            <span>{{ t('more') }}</span>
          </div>
        </section>
        <app-facts-panel
          :title="t('Activity')"
          :items="activity"
        />
      </template>
    </main>`,
};
