// Category detail view: its habits and its perfect days, i.e. days on which
// every scheduled habit of the category was completed.

import * as actions from './actions.js';
import {api} from './api.js';
import {AppBar} from './app-bar.js';
import {openCategoryEditor} from './category-editor.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue, hasHabitIcon} from './icons.js';
import {remote} from './remote-stats.js';
import {goHome, openHabit, route} from './route.js';
import {changedItem, createdItem, factItem, FactsPanel, rateLabel, StatRow} from './stat-panels.js';
import {categoryById, state} from './state.js';
import {computed} from './vue.js';
import {currentYear, sinceLabel} from './year-grid.js';


/**
 * Returns the stat tiles from the server's day statistics of the category's
 * habits this year (GET /api/days?category=); dashes until they have arrived.
 * @param {!Category} category
 * @return {!Array<!Array<string>>}
 */
function statTiles(category) {
  const year = currentYear();
  const s = remote(
      `category|${category.id}|${year}`, () => api.days(year, category.id));
  if (!s) {
    return [
      [t('Current streak'), '–', 'streak'],
      [
        t('Perfect days {since}', {since: sinceLabel(`${year}-01-01`)}),
        '–',
        'calendarCheck',
      ],
      [rateLabel(), '–', 'percent'],
      [t('Habits'), '–', 'list'],
    ];
  }
  const rate = s.expected > 0 ? Math.round((s.achieved / s.expected) * 100) : 0;
  const {currentStreak, perfect, counted} = s.stats;
  return [
    [
      t('Current streak'),
      currentStreak === 1 ? t('1 day') : t('{n} days', {n: currentStreak}),
      'streak',
    ],
    [
      t('Perfect days {since}', {since: sinceLabel(`${s.year}-01-01`)}),
      t('{n} of {total}', {n: perfect, total: counted}),
      'calendarCheck',
    ],
    [rateLabel(), `${rate} %`, 'percent'],
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
export const CategoryView = {
  name: 'CategoryView',
  components: {AppBar, FactsPanel, StatRow},
  setup() {
    // Nothing is shown, or loaded, while the view is hidden.
    const category = computed(
        () => route.view === 'category' ? categoryById(route.id) : null);
    return {
      category,
      colorValue,
      hasHabitIcon,
      describeHabit: habitHelpers.describeHabit,
      shortStreak,
      habits: computed(
          () => state.habits.filter(
              (h) => h.categoryId === category.value.id && !h.archivedAt)),
      stats: computed(() => statTiles(category.value)),
      details: computed(() => [factItem(
          t('Progress'),
          category.value.showProgress ? t('Shown on the board') :
                                        t('Not shown'))]),
      activity: computed(() => [
        createdItem(category.value.createdAt),
        changedItem(category.value.updatedAt),
      ]),
      menu: [{action: 'delete', label: t('Delete'), icon: 'trash', danger: true}],
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
  // colour.
  template: `
    <main id="category-view" class="view" :hidden="!category">
      <template v-if="category">
        <app-bar :title="category.name" :menu="menu" @back="back" @edit="edit"
                 @action="remove">
          <template #badge>
            <icon-badge class="habit-icon" :icon="category.icon" :color="category.color || null"/>
          </template>
        </app-bar>
        <facts-panel :title="t('Details')" :items="details"/>
        <stat-row :stats="stats"/>
        <section class="panel">
          <h3>{{ t('Habits') }}</h3>
          <p v-if="habits.length === 0" class="block-empty">{{ t('No habit in this category yet.') }}</p>
          <div v-else class="cat-habits">
            <button v-for="habit in habits" :key="habit.id" type="button"
                    class="cat-habit" :style="{'--habit-color': colorValue(habit.color)}"
                    @click="openHabit(habit.id)">
              <icon-badge v-if="hasHabitIcon(habit.icon)" class="habit-icon"
                          :icon="habit.icon" :color="habit.color"/>
              <span v-else class="dot"></span>
              <span class="cat-habit-text">
                <span class="habit-name">{{ habit.name }}</span>
                <span class="habit-meta">{{ describeHabit(habit) }}</span>
              </span>
              <span class="cat-habit-streak">{{ shortStreak(habit.stats) }}</span>
            </button>
          </div>
        </section>
        <facts-panel :title="t('Activity')" :items="activity"/>
      </template>
    </main>`,
};

