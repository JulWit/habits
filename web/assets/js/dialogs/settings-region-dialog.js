/**
 * @fileoverview The language and time page of the settings: the language and
 * the time zone, which decides when a new day begins.
 */

import {refresh} from '../data/loader.js';
import {state, userTimeZone} from '../data/state.js';
import {locale, t} from '../util/i18n.js';
import {computed} from '../vue.js';

import {options, reloadInto, saveSetting, SettingsPage} from './settings-page.js';

/**
 * Returns the browser's time zone, or "".
 * @return {string}
 */
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Returns all time zones known to the browser, grouped by region, or a short
 * fallback list for browsers without Intl.supportedValuesOf. Each zone is
 * named without its region and underscores.
 * @return {!Array<{region: string, zones: !Array<{value: string, label:
 *     string}>}>}
 */
function timeZoneGroups() {
  let known;
  try {
    known = Intl.supportedValuesOf('timeZone');
  } catch {
    known = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York'];
  }
  const groups = new Map();
  for (const zone of known) {
    const region =
        zone.includes('/') ? zone.slice(0, zone.indexOf('/')) : t('Other');
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push({
      value: zone,
      label: zone.slice(zone.indexOf('/') + 1)
                 .replaceAll('_', ' ')
                 .replaceAll('/', ' / '),
    });
  }
  return [...groups].map(([region, zones]) => ({region, zones}));
}

/**
 * Returns the time zone hint, including the current time there.
 * @return {string}
 */
function timeZoneText() {
  let now = '';
  try {
    now = new Date().toLocaleTimeString(
        locale, {hour: '2-digit', minute: '2-digit', timeZone: userTimeZone()});
  } catch {
    // Omit the time if the browser cannot format the zone.
  }
  const lead = t('Decides when a new day begins on the board.');
  return now ? `${lead} ${t('It is {time} there now.', {time: now})}` : lead;
}

/** The language and time page. */
export const SettingsRegionPage = {
  name: 'SettingsRegionPage',
  components: {SettingsPage},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const settings = computed(() => state.settings);
    const zones = timeZoneGroups();
    const zoneValues =
        new Set(zones.flatMap((g) => g.zones.map((z) => z.value)));
    const device = deviceTimeZone();

    /**
     * Saves the time zone and reloads the state, as it changes "today".
     * @param {string} zone
     */
    const saveTimeZone = async (zone) => {
      if (await saveSetting({timeZone: zone})) await refresh();
    };

    return {
      settings,
      options,
      zones,
      device,
      saveTimeZone,
      timeZoneText,
      serverZone: computed(() => {
        const server = state.serverTimeZone;
        // "Local" is a server zone without a name.
        return server && server !== 'Local' ?
            t('Server default ({zone})', {zone: server}) :
            t('Server default');
      }),
      // The chosen zone is offered even if the browser does not list it.
      unlistedZone: computed(() => {
        const chosen = settings.value.timeZone;
        return chosen && !zoneValues.has(chosen) ? chosen : '';
      }),
      // Only offered if the device is in a different time zone.
      offerDeviceZone: computed(
          () => device &&
              device !== (settings.value.timeZone || state.serverTimeZone)),
      /**
       * Reloads the page to apply a new language, once the server has it,
       * and shows this page again.
       * @param {string} language
       */
      saveLanguage: async (language) => {
        if (await saveSetting({language})) reloadInto('settings-region');
      },
    };
  },
  template: `
    <settings-page
      id="settings-region"
      :title="t('Language & time')"
    >
      <div class="field">
        <label>
          <span class="field-label">{{ t('Language') }}</span>
          <!-- Each language is named in its own language. -->
          <select
            class="select"
            autocomplete="off"
            :value="settings.language"
            @change="saveLanguage($event.target.value)"
          >
            <option
              v-for="o in options('language')"
              :key="o.value"
              :value="o.value"
              :lang="o.lang || undefined"
            >
              {{ o.lang ? o.label : t(o.label) }}
            </option>
          </select>
        </label>
        <p class="field-hint">
          {{ t('The page reloads to switch the language.') }}
        </p>
      </div>
      <div class="field">
        <label>
          <span class="field-label">{{ t('Time zone') }}</span>
          <select
            class="select"
            autocomplete="off"
            :value="settings.timeZone"
            @change="saveTimeZone($event.target.value)"
          >
            <option value="">{{ serverZone }}</option>
            <option
              v-if="unlistedZone"
              :value="unlistedZone"
            >
              {{ unlistedZone }}
            </option>
            <optgroup
              v-for="group in zones"
              :key="group.region"
              :label="group.region"
            >
              <option
                v-for="zone in group.zones"
                :key="zone.value"
                :value="zone.value"
              >
                {{ zone.label }}
              </option>
            </optgroup>
          </select>
        </label>
        <p class="field-hint">{{ timeZoneText() }}</p>
        <button
          v-if="offerDeviceZone"
          type="button"
          class="button"
          @click="saveTimeZone(device)"
        >
          {{ t("Use this device's time zone ({zone})", {zone: device}) }}
        </button>
      </div>
    </settings-page>`,
};
