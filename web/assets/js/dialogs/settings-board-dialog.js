/**
 * @fileoverview The overview page of the settings: arranging and how it is
 * done, grouping by category, the days shown and the completion rate's window.
 */

import {refresh} from '../data/loader.js';
import {state} from '../data/state.js';
import {arranging, setArranging, shownDays} from '../ui/board-state.js';
import {t} from '../util/i18n.js';
import {computed} from '../vue.js';

import {options, saveSetting, SettingsPage, SettingsSegmented} from './settings-page.js';

/**
 * The choices of the days in the overview; 0 is automatic.
 * @const {!Array<{value: number, label: string}>}
 */
const DAY_CHOICES = [
  {value: 0, label: 'Automatic'},
  {value: 7, label: '7'},
  {value: 14, label: '14'},
  {value: 21, label: '21'},
  {value: 28, label: '28'},
];

/** The overview page. */
export const SettingsBoardPage = {
  name: 'SettingsBoardPage',
  components: {SettingsPage, SettingsSegmented},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const settings = computed(() => state.settings);
    return {
      settings,
      options,
      arranging,
      setArranging,
      DAY_CHOICES,
      save: saveSetting,
      daysHint: computed(() => {
        const days = settings.value.overviewDays;
        const shown = shownDays.value;
        if (days === 0) {
          return t(
              'As many days are shown as fit in the window — currently {n}.',
              {n: shown});
        }
        if (shown < days) {
          return t(
              'Only {n} days fit in the window right now. In a wider window it will be {days}.',
              {n: shown, days});
        }
        return t('{n} days are shown right now.', {n: shown});
      }),
      alignHint: computed(() => {
        const shown = shownDays.value;
        if (!settings.value.alignWeeks) return t('The overview ends on today.');
        // Week alignment requires at least seven columns.
        if (shown < 7) {
          return t(
              'Possible from 7 columns on — {n} fit right now.', {n: shown});
        }
        return t(
            'The overview shows whole calendar weeks, including the remaining days of this week.');
      }),
      groupHint: computed(
          () => settings.value.groupByCategory ?
              t('Each category is a block of its own.') :
              t('All habits are one list without headings; arranging sets their order across the categories.')),
      reorderHint: computed(
          () => settings.value.reorderMode === 'drag' ?
              t('Categories and habits are moved by their handle.') :
              t('Categories and habits are moved with arrows — by keyboard too.')),
      /**
       * Saves the completion rate's window; the server computes the rate, so
       * the statistics are reloaded.
       * @param {string} rateWindow
       */
      saveRateWindow: async (rateWindow) => {
        if (await saveSetting({rateWindow})) await refresh();
      },
    };
  },
  template: `
    <settings-page
      id="settings-board"
      :title="t('Overview')"
    >
      <fieldset class="field">
        <legend class="field-label">{{ t('Reordering') }}</legend>
        <label class="switch">
          <input
            type="checkbox"
            autocomplete="off"
            :checked="arranging"
            @change="setArranging($event.target.checked)"
          >
          <span>{{ t('Arrange') }}</span>
        </label>
        <p class="field-hint">
          {{ t('Shows the handles for moving habits and categories. Applies until the page is next loaded.') }}
        </p>
        <settings-segmented
          name="settings-reorder"
          :label="t('Reordering')"
          :options="options('reorderMode')"
          :model-value="settings.reorderMode"
          @update:model-value="save({reorderMode: $event})"
        />
        <p class="field-hint">
          {{ reorderHint }}
        </p>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">{{ t('Categories') }}</legend>
        <label class="switch">
          <input
            id="settings-board-group"
            type="checkbox"
            autocomplete="off"
            :checked="settings.groupByCategory"
            @change="save({groupByCategory: $event.target.checked})"
          >
          <span>{{ t('Group by category') }}</span>
        </label>
        <p class="field-hint">{{ groupHint }}</p>
        <!-- Only while grouped, as the single list has no headings. -->
        <template v-if="settings.groupByCategory">
          <label class="switch">
            <input
              id="settings-board-compact"
              type="checkbox"
              autocomplete="off"
              :checked="settings.compactCategories"
              @change="save({compactCategories: $event.target.checked})"
            >
            <span>{{ t('Compact categories') }}</span>
          </label>
          <p class="field-hint">
            {{ t("Instead of a heading with name, icon and progress, a line in the category's colour marks each block. Empty categories are left out; while arranging, the headings are shown.") }}
          </p>
        </template>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">{{ t('Days in the overview') }}</legend>
        <settings-segmented
          name="settings-days"
          :label="t('Days in the overview')"
          :options="DAY_CHOICES"
          :model-value="settings.overviewDays"
          wrap
          @update:model-value="save({overviewDays: $event})"
        />
        <p class="field-hint">{{ daysHint }}</p>
        <label class="switch">
          <input
            type="checkbox"
            autocomplete="off"
            :checked="settings.alignWeeks"
            @change="save({alignWeeks: $event.target.checked})"
          >
          <span>{{ t('Start the week on Monday') }}</span>
        </label>
        <p class="field-hint">{{ alignHint }}</p>
      </fieldset>
      <label class="field">
        <span class="field-label">{{ t('Completion rate over') }}</span>
        <select
          class="select"
          autocomplete="off"
          :value="settings.rateWindow"
          @change="saveRateWindow($event.target.value)"
        >
          <option
            v-for="o in options('rateWindow')"
            :key="o.value"
            :value="o.value"
          >
            {{ t(o.label) }}
          </option>
        </select>
        <span class="field-hint">
          {{ t("The rate in a habit's statistics: the share of its due days completed in this time, skipped days left out.") }}
        </span>
      </label>
    </settings-page>`,
};
