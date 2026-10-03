/**
 * @fileoverview The appearance page of the settings: theme, font, density,
 * accent colour, today band and background pattern.
 */

import {state} from '../data/state.js';
import {AppColorSwatches, NEUTRAL} from '../ui/icons.js';
import {computed, reactive} from '../vue.js';

import {options, saveSetting, SettingsPage, SettingsSegmented} from './settings-page.js';

/** The appearance page. */
export const SettingsLookPage = {
  name: 'SettingsLookPage',
  components: {AppColorSwatches, SettingsPage, SettingsSegmented},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    // The sliders' values while they move, before they are saved.
    const preview = reactive({bandOpacity: null, bandFillOpacity: null});
    const settings = computed(() => state.settings);

    return {
      state,
      settings,
      options,
      NEUTRAL,
      save: saveSetting,
      // What the sliders show: the value while they move, else the setting.
      sliders: computed(
          () => ({
            bandOpacity: preview.bandOpacity ?? settings.value.bandOpacity,
            bandFillOpacity:
                preview.bandFillOpacity ?? settings.value.bandFillOpacity,
          })),
      /**
       * Previews a slider's value through the custom property `cssVar` while
       * it moves.
       * @param {string} key
       * @param {string} cssVar
       * @param {!Event} event the slider's input event
       */
      slide: (key, cssVar, event) => {
        const value = /** @type {!HTMLInputElement} */ (event.target).value;
        preview[key] = value;
        document.documentElement.style.setProperty(cssVar, `${value}%`);
      },
      /**
       * Saves a slider's value on release.
       * @param {string} key
       * @param {!Event} event the slider's change event
       */
      release: async (key, event) => {
        const value = /** @type {!HTMLInputElement} */ (event.target).value;
        await saveSetting({[key]: Number(value)});
        preview[key] = null;
      },
    };
  },
  template: `
    <settings-page
      id="settings-look"
      :title="t('Appearance')"
    >
      <fieldset class="field">
        <legend class="field-label">{{ t('Theme') }}</legend>
        <settings-segmented
          name="settings-theme"
          :label="t('Theme')"
          :options="options('theme')"
          :model-value="settings.theme"
          @update:model-value="save({theme: $event})"
        />
      </fieldset>
      <label class="field">
        <span class="field-label">{{ t('Font') }}</span>
        <select
          id="settings-font"
          class="select settings-font"
          autocomplete="off"
          :value="settings.font"
          @change="save({font: $event.target.value})"
        >
          <option
            v-for="o in options('font')"
            :key="o.value"
            :value="o.value"
          >
            {{ t(o.label) }}
          </option>
        </select>
      </label>
      <fieldset class="field">
        <legend class="field-label">{{ t('Density') }}</legend>
        <settings-segmented
          name="settings-density"
          :label="t('Density')"
          :options="options('density')"
          :model-value="settings.density"
          @update:model-value="save({density: $event})"
        />
        <p class="field-hint">
          {{ t('Spacing inside and around every element, and how heavy its emphasis is set.') }}
        </p>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">{{ t('Accent colour') }}</legend>
        <app-color-swatches
          :colors="[NEUTRAL, ...state.colors]"
          :model-value="settings.bandColor"
          :aria-label="t('Accent colour')"
          @update:model-value="save({bandColor: $event})"
        />
        <!-- The sliders preview their value while they move and save it on
             release. -->
        <label class="slider">
          <span class="field-label">{{ t('Opacity') }}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            autocomplete="off"
            :value="sliders.bandOpacity"
            @input="slide('bandOpacity', '--today-opacity', $event)"
            @change="release('bandOpacity', $event)"
          >
          <output>{{ sliders.bandOpacity }}%</output>
        </label>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">{{ t('Today band') }}</legend>
        <label class="switch">
          <input
            type="checkbox"
            autocomplete="off"
            :checked="settings.showBand"
            @change="save({showBand: $event.target.checked})"
          >
          <span>{{ t("Band through today's column") }}</span>
        </label>
        <p class="field-hint">
          {{ t("Off, only today's date in the header is marked.") }}
        </p>
        <!-- Only while the band is on. -->
        <label
          v-if="settings.showBand"
          class="slider"
        >
          <span class="field-label">{{ t('Band opacity') }}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            autocomplete="off"
            :value="sliders.bandFillOpacity"
            @input="slide('bandFillOpacity', '--band-opacity', $event)"
            @change="release('bandFillOpacity', $event)"
          >
          <output>{{ sliders.bandFillOpacity }}%</output>
        </label>
      </fieldset>
      <label class="field">
        <span class="field-label">{{ t('Background pattern') }}</span>
        <select
          class="select"
          autocomplete="off"
          :value="settings.pattern"
          @change="save({pattern: $event.target.value})"
        >
          <option
            v-for="o in options('pattern')"
            :key="o.value"
            :value="o.value"
          >
            {{ t(o.label) }}
          </option>
        </select>
      </label>
    </settings-page>`,
};
