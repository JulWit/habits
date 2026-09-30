// Habit detail view: statistics, activity chart and calendar heatmap.

import * as actions from './actions.js';
import {api} from './api.js';
import {AppBar} from './app-bar.js';
import {addDays, dayOfMonth, formatDayMonth, formatFull, formatLong, MONTH_LONG, MONTH_SHORT, monthIndex} from './dates.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue, hasHabitIcon} from './icons.js';
import {remote} from './remote-stats.js';
import {goHome, route} from './route.js';
import {AppFactsPanel, AppStatRow, changedItem, createdItem, daysAgo, factItem, rateLabel} from './stat-panels.js';
import {habitById, state} from './state.js';
import {hideTooltip} from './tooltip.js';
import {computed, nextTick, onMounted, ref, watch} from './vue.js';
import {AppYearGrid, centreToday, currentYear, initChartTooltips} from './year-grid.js';

/**
 * The year the heatmap and the cumulative chart show, e.g. "2025", and the
 * habit it was chosen for. Another habit opens with the current year; the
 * choice is not kept beyond the session.
 */
const shownYear = ref('');
/** @type {?string} */
let shownFor = null;

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

/** The selected granularity, kept for the session only. */
const grain = ref('month');

/**
 * Formats a streak with its unit: "1 day", "6 days", "1 week", "2 months".
 * @param {number} count
 * @param {string} unit days, weeks or months
 * @return {string}
 */
function streakText(count, unit) {
  if (unit === 'months') {
    return count === 1 ? t('1 month') : t('{n} months', {n: count});
  }
  if (unit === 'weeks') {
    return count === 1 ? t('1 week') : t('{n} weeks', {n: count});
  }
  return count === 1 ? t('1 day') : t('{n} days', {n: count});
}

/**
 * Returns the first and the last year of the habit's history, as numbers.
 * @param {!Habit} habit
 * @return {!Array<number>}
 */
function yearRange(habit) {
  const last = Number(currentYear());
  const first = Number(habit.historyStart?.slice(0, 4)) || last;
  return [Math.min(first, last), last];
}

/**
 * Returns the stat tiles from the server's statistics of the habit.
 * @param {!Habit} habit
 * @return {!Array<!Array<string>>}
 */
function statTiles(habit) {
  const s = habit.stats;
  return [
    [t('Current streak'), streakText(s.currentStreak, s.streakUnit), 'streak'],
    [t('Best streak'), streakText(s.bestStreak, s.streakUnit), 'trophy'],
    [rateLabel(), `${Math.round(s.completionRate * 100)} %`, 'percent'],
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
      t('since {date}', {date: formatLong(all.at(-1).from)}) :
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
  // visible.
  const off = !habitHelpers.isScheduled(habit, iso) && value === 0;
  const skipped = !off && habitHelpers.isSkipped(habit, iso);
  const status = heatStatus(habit, iso, value);
  const when = iso === state.today ?
      t('Today, {date}', {date: formatFull(iso)}) :
      formatFull(iso);

  return {
    class: [
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
 * Returns a bar of the cumulative chart: its height is the running total,
 * the period's own sum is highlighted at its top.
 * @param {!Habit} habit
 * @param {{start: string, sum: number, cumulative: number}} bucket
 * @param {number} total
 * @param {number} index
 * @param {number} count the number of buckets
 * @return {{start: string, tip: string, status: string, height: string,
 *     zero: boolean, gain: ?string, label: string}}
 */
function chartColumn(
    habit, {start, sum, cumulative: running}, total, index, count) {
  // Shown by the shared tooltip.
  const tip = bucketName(start);
  const runningTotal = habitHelpers.formatTotal(habit, running);
  const status = sum > 0 ?
      t('{total} · of that +{sum}',
        {total: runningTotal, sum: habitHelpers.formatTotal(habit, sum)}) :
      t('{total} · nothing added', {total: runningTotal});
  // Counted from the end, so the latest bucket is always labelled.
  const labelled = (count - 1 - index) % GRAINS[grain.value].every === 0;
  return {
    start,
    tip,
    status,
    height: `${(running / total) * 100}%`,
    // Hides bars before the first entry.
    zero: running === 0,
    gain: sum > 0 && running > 0 ? `${(sum / running) * 100}%` : null,
    label: !labelled ? '' :
        grain.value === 'month' ?
                       MONTH_SHORT[monthIndex(start)] :
                       `${dayOfMonth(start)}.${monthIndex(start) + 1}.`,
  };
}

/**
 * Returns the tooltip label of a bucket.
 * @param {string} start
 * @return {string}
 */
function bucketName(start) {
  if (grain.value === 'month') {
    return t('End of {month}', {month: MONTH_LONG[monthIndex(start)]});
  }
  if (grain.value === 'week') {
    return t('Week from {date}', {date: formatDayMonth(start)});
  }
  return formatFull(start);
}

/**
 * The cumulative chart of a countable habit: each bar is the running total at
 * the end of its day, week or month, with the period's own sum highlighted at
 * the top. The server sums the values (GET /api/habits/{id}/totals). The
 * chart scrolls to its end (today) whenever it is drawn anew.
 */
const HabitCumulativeChart = {
  name: 'HabitCumulativeChart',
  props: {
    habit: {type: Object, required: true},
    year: {type: String, required: true},
  },
  /**
   * @param {{habit: !Habit, year: string}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const scroller = ref(null);
    /** @type {{value: (!Totals|undefined)}} */
    const summary = computed(
        () => remote(
            `totals|${props.habit.id}|${props.year}|${grain.value}`,
            () => api.habitTotals(props.habit.id, props.year, grain.value)));
    const columns = computed(() => {
      const s = summary.value;
      if (!s) return [];
      return s.buckets.map(
          (bucket, i) =>
              chartColumn(props.habit, bucket, s.total, i, s.buckets.length));
    });
    /**
     * Formats a total of the habit.
     * @param {number} value
     * @return {string}
     */
    const format = (value) => habitHelpers.formatTotal(props.habit, value);
    /** Scrolls the chart to its newest column. */
    const showNewest = () => {
      if (scroller.value) {
        scroller.value.scrollLeft = scroller.value.scrollWidth;
      }
    };
    watch(columns, showNewest, {flush: 'post'});
    onMounted(showNewest);

    return {
      scroller,
      summary,
      columns,
      format,
      grain,
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
      daysText: computed(() => {
        const n = summary.value.activeDays;
        return n === 1 ? t(' on 1 active day · best day ') :
                         t(' on {n} active days · best day ', {n});
      }),
      // Average per day with an entry.
      average: computed(
          () => Math.round(summary.value.total / summary.value.activeDays)),
      chartStyle: computed(() => ({
                             '--cols': String(columns.value.length),
                             '--bar-min': GRAINS[grain.value].barMin,
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
              v-model="grain"
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
  components:
      {AppBar, HabitCumulativeChart, AppFactsPanel, AppStatRow, AppYearGrid},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const root = ref(null);
    // Nothing is shown, or loaded, while the view is hidden.
    const habit =
        computed(() => route.view === 'habit' ? habitById(route.id) : null);
    const shownId = computed(() => habit.value?.id ?? null);

    // Another habit opens with the current year. The tooltip's target is
    // about to be replaced; the heatmap is scrolled to today once it shows
    // another habit or year.
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
    onMounted(() => {
      initChartTooltips(
          root.value,
          '.heatmap-day[data-date], .habit-cumulative-chart-column[data-tip]');
    });

    const range = computed(() => yearRange(habit.value));

    /**
     * Shows the year before (-1) or after (+1) the one shown, keeping the
     * focus on the arrows.
     * @param {number} delta
     * @param {!Event} event
     */
    const showYear = async (delta, event) => {
      const button = event.currentTarget;
      const [first, last] = range.value;
      shownYear.value = String(
          Math.min(last, Math.max(first, Number(shownYear.value) + delta)));
      await nextTick();
      // At the first or last year, the other arrow takes the focus.
      if (button.disabled) {
        root.value.querySelector('.habit-view-year-nav button:not(:disabled)')
            ?.focus();
      }
    };

    const archived = computed(() => habit.value?.archivedAt != null);
    return {
      root,
      habit,
      shownYear,
      range,
      showYear,
      // The habit's colour for the view.
      colorStyle: computed(
          () => habit.value ? {'--habit-color': colorValue(habit.value.color)} :
                              null),
      hasHabitIcon,
      isCountable: habitHelpers.isCountable,
      stats: computed(() => statTiles(habit.value)),
      details: computed(() => details(habit.value)),
      activity: computed(() => activity(habit.value)),
      square: (iso) => heatSquare(habit.value, iso),
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
      edit: () => actions.editHabit(habit.value.id),
      /**
       * Runs an action of the overflow menu.
       * @param {string} action
       */
      onMenu: (action) => {
        const id = habit.value.id;
        if (action === 'skip') actions.skipDays(id);
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
      class="view"
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
          :habit="habit"
          :year="shownYear"
        />
        <section class="panel">
          <div class="habit-view-year-head">
            <h3>{{ t('Year {year}', {year: shownYear}) }}</h3>
            <div class="habit-view-year-nav">
              <button
                type="button"
                class="icon-button"
                data-action="year-earlier"
                :title="t('Previous year')"
                :aria-label="t('Previous year')"
                :disabled="Number(shownYear) <= range[0]"
                @click="showYear(-1, $event)"
              >
                <app-icon name="chevronLeft"/>
              </button>
              <button
                type="button"
                class="icon-button"
                data-action="year-later"
                :title="t('Next year')"
                :aria-label="t('Next year')"
                :disabled="Number(shownYear) >= range[1]"
                @click="showYear(1, $event)"
              >
                <app-icon name="chevronRight"/>
              </button>
            </div>
          </div>
          <app-year-grid
            :year="shownYear"
            :square="square"
          />
          <div class="heatmap-legend">
            <span>{{ legendRange }}</span>
            <span style="flex: 1"></span>
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
