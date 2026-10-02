/**
 * @fileoverview Category detail view: its habits and its perfect days, i.e.
 * days on which every scheduled habit of the category was completed, of the
 * current year or an earlier one.
 */

import * as actions from '../data/actions.js';
import {api} from '../data/api.js';
import {remote} from '../data/remote-stats.js';
import {goHome, openHabit, route} from '../data/route.js';
import {categoryById, state} from '../data/state.js';
import {openCategoryEditor} from '../dialogs/category-editor.js';
import {AppBar} from '../ui/app-bar.js';
import {colorValue, hasHabitIcon} from '../ui/icons.js';
import {AppFactsPanel, AppStatRow, changedItem, createdItem, factItem, percent, rateLabel} from '../ui/stat-panels.js';
import {hideTooltip} from '../ui/tooltip.js';
import {AppDayHeatmap, AppYearNavigation, centreToday, currentYear, initChartTooltips, sinceLabel, streakLabel, yearRange} from '../ui/year-grid.js';
import * as habitHelpers from '../util/habit-helpers.js';
import {t} from '../util/i18n.js';
import {computed, nextTick, onMounted, ref, watch} from '../vue.js';

/**
 * The year shown, e.g. "2025", and the category it was chosen for. Another
 * category opens with the current year; the choice is not kept beyond the
 * session.
 */
const shownYear = ref('');
/** @type {?string} */
let shownFor = null;

/**
 * Returns the stat tiles from the server's day statistics of the category's
 * habits in a year (GET /api/days?category=), or dashes until they have
 * arrived. The rate and the number of habits are those of today; without a
 * due day, e.g. in an empty category, the rate is a dash rather than 0 %.
 * @param {?Days} s
 * @param {string} year
 * @return {!Array<!Array<string>>}
 */
function statTiles(s, year) {
  if (!s) {
    return [
      [streakLabel(year), '–', 'streak'],
      [
        t('Perfect days {since}', {since: sinceLabel(`${year}-01-01`)}),
        '–',
        'calendarCheck',
      ],
      [rateLabel(), '–', 'percent'],
      [t('Habits'), '–', 'list'],
    ];
  }
  const rate = s.expected > 0 ? s.achieved / s.expected : null;
  const {currentStreak, perfect, counted} = s.stats;
  return [
    [
      streakLabel(year),
      currentStreak === 1 ? t('1 day') : t('{n} days', {n: currentStreak}),
      'streak',
    ],
    [
      t('Perfect days {since}', {since: sinceLabel(`${s.year}-01-01`)}),
      t('{n} of {total}', {n: perfect, total: counted}),
      'calendarCheck',
    ],
    [rateLabel(), percent(rate), 'percent'],
    [t('Habits'), String(s.habits), 'list'],
  ];
}

/**
 * Formats the current streak shortly: "1 day", "5 days", "3 wk", "2 mo".
 * @param {{currentStreak: number, streakUnit: string}} stats
 * @return {string}
 */
function shortStreak({currentStreak, streakUnit}) {
  // Singular/plural for days; "wk" and "mo" need no plural.
  let unit = currentStreak === 1 ? t('day') : t('days');
  if (streakUnit === 'weeks') unit = t('wk');
  if (streakUnit === 'months') unit = t('mo');
  return `${currentStreak} ${unit}`;
}

/**
 * The category view: its title bar, whether its progress is shown on the
 * board, its statistics, its habits in board order and its activity.
 */
export const TheCategoryView = {
  name: 'TheCategoryView',
  components:
      {AppBar, AppDayHeatmap, AppFactsPanel, AppStatRow, AppYearNavigation},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const root = ref(null);
    // Nothing is shown, or loaded, while the view is hidden.
    const category = computed(
        () => route.view === 'category' ? categoryById(route.id) : null);
    const habits = computed(
        () => state.habits.filter(
            (h) => h.categoryId === category.value?.id && !h.archivedAt));

    // Another category opens with the current year.
    watch(() => category.value?.id, (id) => {
      if (id && id !== shownFor) {
        shownFor = id;
        shownYear.value = currentYear();
      }
    }, {immediate: true, flush: 'sync'});
    // The day statistics of the shown year; while another year of the same
    // category loads, the last one stays.
    /** @type {?{id: string, days: !Days}} */
    let previous = null;
    const days = computed(() => {
      if (!category.value) return undefined;
      const {id} = category.value;
      const year = shownYear.value;
      const loaded = remote(`category|${id}|${year}`, () => api.days(year, id));
      if (loaded) previous = {id, days: loaded};
      return previous?.id === id ? previous.days : undefined;
    });

    // The tooltip's target is replaced; the heatmap is scrolled to today once
    // it shows another year.
    watch(() => days.value?.year, async () => {
      hideTooltip();
      await nextTick();
      if (root.value) centreToday(root.value);
    });
    onMounted(() => {
      initChartTooltips(root.value, '.heatmap-day[data-date]');
    });

    return {
      root,
      state,
      category,
      colorValue,
      hasHabitIcon,
      describeHabit: habitHelpers.describeHabit,
      shortStreak,
      habits,
      shownYear,
      range: computed(() => yearRange(habits.value)),
      days,
      stats: computed(
          () => statTiles(
              days.value,
              days.value ? String(days.value.year) : shownYear.value)),
      details: computed(
          () => [factItem(
              t('Progress'),
              category.value.showProgress ? t('Shown on the board') :
                                            t('Not shown'))]),
      activity: computed(
          () =>
              [createdItem(category.value.createdAt),
               changedItem(category.value.updatedAt),
    ]),
      menu:
          [{action: 'delete', label: t('Delete'), icon: 'trash', danger: true}],
      back: goHome,
      edit: () => {
        const id = category.value.id;
        openCategoryEditor(id, (input) => actions.updateCategory(id, input));
      },
      remove: () => actions.deleteCategory(category.value.id),
      openHabit,
    };
  },
  // The habit count is a stat tile. A habit without an icon gets a dot in its
  // colour. The year panel shows the perfect days of the habits that are not
  // archived, as the day statistics do for all.
  template: `
    <main
      id="category-view"
      ref="root"
      class="view stats-view"
      :hidden="!category"
    >
      <template v-if="category">
        <app-bar
          :title="category.name"
          :menu="menu"
          @back="back"
          @edit="edit"
          @action="remove"
        >
          <template #badge>
            <app-icon-badge
              class="habit-icon"
              :icon="category.icon"
              :color="category.color || null"
            />
          </template>
        </app-bar>
        <app-facts-panel
          :title="t('Details')"
          :items="details"
        />
        <app-stat-row :stats="stats"/>
        <section class="panel">
          <h3>{{ t('Habits') }}</h3>
          <p
            v-if="habits.length === 0"
            class="category-view-empty"
          >
            {{ t('No habit in this category yet.') }}
          </p>
          <div
            v-else
            class="category-view-habits"
          >
            <button
              v-for="habit in habits"
              :key="habit.id"
              type="button"
              class="category-view-habit"
              :style="{'--habit-color': colorValue(habit.color)}"
              @click="openHabit(habit.id)"
            >
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
              <span class="category-view-habit-text">
                <span class="habit-name">{{ habit.name }}</span>
                <span class="habit-meta">{{ describeHabit(habit) }}</span>
              </span>
              <span class="category-view-habit-streak">
                {{ shortStreak(habit.stats) }}
              </span>
            </button>
          </div>
        </section>
        <section
          v-if="habits.length > 0"
          class="panel"
        >
          <app-year-navigation
            v-model:year="shownYear"
            :first="range[0]"
            :last="range[1]"
          />
          <app-day-heatmap
            v-if="days"
            :year="String(days.year)"
            :totals="days.totals"
            :today="state.today"
          />
        </section>
        <app-facts-panel
          :title="t('Activity')"
          :items="activity"
        />
      </template>
    </main>`,
};
