/**
 * @fileoverview Settings pages: a list of sections, each opening its own page.
 * Every change is saved immediately: the state is updated first and restored if
 * the server rejects the change.
 */

import * as actions from '../data/actions.js';
import {api} from '../data/api.js';
import {refresh} from '../data/loader.js';
import {forget} from '../data/outbox.js';
import {archivedCount, replaceState, state} from '../data/state.js';
import {AppColorSwatches, NEUTRAL} from '../ui/icons.js';
import {openPage, topPage} from '../ui/page-stack.js';
import {factItem} from '../ui/stat-panels.js';
import {errorText, toast} from '../ui/toast.js';
import {locale, t, userTimeZone} from '../util/i18n.js';
import {currentDays, editing} from '../views/board-view.js';
import {computed, reactive, ref} from '../vue.js';

/**
 * The last error and the page it belongs to; shown in the open settings page,
 * since pages cover the toasts.
 */
const error = reactive({page: '', message: ''});

/**
 * Shows an error in the open settings page, or as a toast outside of them.
 * @param {string} message
 */
function report(message) {
  const page = topPage();
  if (page?.id.startsWith('settings-')) {
    error.page = page.id;
    error.message = message;
    return;
  }
  toast(message, {error: true});
}

/**
 * Saves settings. The state is updated immediately and restored if the
 * server rejects the change. Resolves to whether the change was saved.
 * @param {!Object<string, *>} patch
 * @return {!Promise<boolean>}
 */
async function saveSetting(patch) {
  const before = {...state.settings};
  // Apply immediately; restored on failure.
  replaceState({settings: {...state.settings, ...patch}});
  try {
    replaceState({settings: await api.saveSettings(patch)});
    error.message = '';
    return true;
  } catch (err) {
    replaceState({settings: before});
    report(errorText(err));
    return false;
  }
}

/**
 * Up to two initials: first and last word, or the first letter alone.
 * @param {string} name
 * @return {string}
 */
function initials(name) {
  const words = name.split(/[\s._@-]+/).filter(Boolean);
  const letters =
      words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1);
  return letters.map((w) => [...w][0].toUpperCase()).join('');
}

/**
 * Formats the RFC 3339 build time in the user's language, or "Unknown".
 * @param {string} time
 * @return {string}
 */
function formatBuildTime(time) {
  const date = time ? new Date(time) : null;
  if (!date || Number.isNaN(date.getTime())) return t('Unknown');
  return date.toLocaleString(locale, {dateStyle: 'medium', timeStyle: 'short'});
}

/**
 * Describes the result of an import.
 * @param {{habits: number, categories: number, skipped: number}} result
 * @return {string}
 */
function importSummary({habits, categories, skipped}) {
  const parts = [
    habits === 1 ? t('1 habit imported.') :
                   t('{n} habits imported.', {n: habits}),
  ];
  if (categories > 0) {
    parts.push(
        categories === 1 ? t('1 category created.') :
                           t('{n} categories created.', {n: categories}));
  }
  if (skipped > 0) {
    parts.push(
        skipped === 1 ?
            t('1 habit already existed and was skipped.') :
            t('{n} habits already existed and were skipped.', {n: skipped}));
  }
  return parts.join(' ');
}

/**
 * Offers `text` as a JSON file to save.
 * @param {string} name
 * @param {string} text
 */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later, as some browsers read the URL after the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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

/**
 * A settings page: a full-screen dialog with a back button, its content and
 * the error of the last change made on it.
 */
const SettingsPage = {
  name: 'SettingsPage',
  props: {
    id: {type: String, required: true},
    title: {type: String, required: true},
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    return {error};
  },
  template: `
    <dialog
      :id="id"
      class="dialog page"
      :aria-labelledby="id + '-title'"
    >
      <header class="page-head">
        <button
          type="button"
          class="icon-button"
          data-page-back
          :title="t('Back')"
          :aria-label="t('Back')"
        >
          <app-icon name="arrowLeft"/>
        </button>
        <h2 :id="id + '-title'">{{ title }}</h2>
      </header>
      <div class="page-body">
        <slot/>
        <p
          v-if="error.message && error.page === id"
          class="error"
        >
          {{ error.message }}
        </p>
      </div>
    </dialog>`,
};

/**
 * A row of the settings menu that opens the page `page` (see page-stack.js).
 */
const SettingsMenuItem = {
  name: 'SettingsMenuItem',
  props: {
    page: String,
    icon: {type: String, required: true},
    title: {type: String, required: true},
    hint: String,
  },
  template: `
    <button
      type="button"
      class="settings-menu-item"
      :data-open-page="page"
    >
      <span
        class="settings-menu-item-icon"
        aria-hidden="true"
      >
        <app-icon :name="icon"/>
      </span>
      <span class="settings-menu-item-text">
        <span class="settings-menu-item-title">{{ title }}</span>
        <span class="settings-menu-item-hint">{{ hint }}</span>
      </span>
      <span
        class="settings-menu-item-caret"
        aria-hidden="true"
      >
        <app-icon name="chevronRight"/>
      </span>
    </button>`,
};

/** The settings pages. */
export const TheSettingsDialog = {
  name: 'TheSettingsDialog',
  components: {AppColorSwatches, SettingsMenuItem, SettingsPage},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const importInput = ref(null);
    const deleteDialog = ref(null);
    const exporting = ref(false);
    const importing = ref(false);
    const deleting = ref(false);
    const importResult = ref('');
    // The sliders' values while they move, before they are saved.
    const preview = reactive({bandOpacity: null, bandFillOpacity: null});

    const settings = computed(() => state.settings);
    // What the sliders show: the value while they move, else the setting.
    const sliders = computed(
        () => ({
          bandOpacity: preview.bandOpacity ?? settings.value.bandOpacity,
          bandFillOpacity:
              preview.bandFillOpacity ?? settings.value.bandFillOpacity,
        }));
    /**
     * Returns the choices the server offers for the setting `key`.
     * @param {string} key
     * @return {!Array<{value: string, label: string}>}
     */
    const options = (key) => state.options?.[key] ?? [];

    // ---------- account and version ----------

    const account = computed(() => {
      const user = state.user ?? {};
      // Without a display name (e.g. single-user mode), the ID stands in.
      const name = user.name || user.id || t('Unknown');
      return {
        name,
        initials: initials(name),
        // The ID is only worth a line if the name does not show it already.
        detail: user.email || (user.id !== name ? user.id : ''),
        groups: user.groups ?? [],
      };
    });

    const version =
        computed(() => state.build?.version || t('Development build'));
    const versionFacts = computed(() => {
      const build = state.build ?? {};
      // Twelve characters identify a commit well enough.
      const revision = build.revision ? build.revision.slice(0, 12) +
              (build.modified ? ` (${t('modified')})` : '') :
                                        t('Unknown');
      return [
        factItem(t('Version'), version.value),
        factItem(t('Commit'), revision),
        factItem(t('Built'), formatBuildTime(build.time)),
        factItem(t('Go version'), build.goVersion || t('Unknown')),
      ];
    });

    // ---------- overview ----------

    const daysHint = computed(() => {
      const days = settings.value.overviewDays;
      const shown = currentDays();
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
    });

    const alignHint = computed(() => {
      const shown = currentDays();
      if (!settings.value.alignWeeks) return t('The overview ends on today.');
      // Week alignment requires at least seven columns.
      if (shown < 7) {
        return t('Possible from 7 columns on — {n} fit right now.', {n: shown});
      }
      return t(
          'The overview shows whole calendar weeks, including the remaining days of this week.');
    });

    // ---------- language and time ----------

    const zones = timeZoneGroups();
    const zoneValues =
        new Set(zones.flatMap((g) => g.zones.map((z) => z.value)));
    const serverZone = computed(() => {
      const server = state.serverTimeZone;
      // "Local" is a server zone without a name.
      return server && server !== 'Local' ?
          t('Server default ({zone})', {zone: server}) :
          t('Server default');
    });
    const device = deviceTimeZone();

    /**
     * Saves the time zone and reloads the state, as it changes "today".
     * @param {string} zone
     */
    const saveTimeZone = async (zone) => {
      if (await saveSetting({timeZone: zone})) await refresh();
    };

    // ---------- data ----------

    /** Downloads an export of the habits. */
    const exportHabits = async () => {
      exporting.value = true;
      try {
        const data = await api.exportHabits();
        download(`habits-${state.today}.json`, JSON.stringify(data, null, 2));
        error.message = '';
      } catch (err) {
        report(errorText(err));
      } finally {
        exporting.value = false;
      }
    };

    /** Imports the chosen file. */
    const importFile = async () => {
      const file = importInput.value.files[0];
      // Cleared, so that choosing the same file again fires "change".
      importInput.value.value = '';
      if (!file) return;
      importResult.value = '';

      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        report(t('The file is not an export of the habits.'));
        return;
      }
      importing.value = true;
      try {
        const counts = await api.importHabits(data);
        error.message = '';
        importResult.value = importSummary(counts);
        await refresh();
      } catch (err) {
        const message = errorText(err);
        // The server names the habit or category that is invalid.
        const name = err.params?.habit ?? err.params?.category;
        report(name ? t('"{name}": {message}', {name, message}) : message);
      } finally {
        importing.value = false;
      }
    };

    /** Asks before deleting all data; Escape leaves the answer empty. */
    const askToDeleteAll = () => {
      deleteDialog.value.returnValue = '';
      deleteDialog.value.showModal();
    };

    /** Deletes all data if the user confirmed it. */
    const deleteAll = async () => {
      if (deleteDialog.value.returnValue !== 'delete') return;
      deleting.value = true;
      try {
        await api.deleteAllData();
        // Nothing remembered may bring the data back, and the page starts
        // over with the default settings and without undo steps.
        forget();
        location.reload();
      } catch (err) {
        report(errorText(err));
        deleting.value = false;
      }
    };

    return {
      state,
      settings,
      options,
      editing,
      error,
      sliders,
      account,
      version,
      versionFacts,
      daysHint,
      alignHint,
      zones,
      serverZone,
      device,
      importInput,
      deleteDialog,
      exporting,
      importing,
      deleting,
      importResult,
      NEUTRAL,
      save: saveSetting,
      saveTimeZone,
      exportHabits,
      importFile,
      askToDeleteAll,
      deleteAll,
      timeZoneText,
      // The chosen zone is offered even if the browser does not list it.
      unlistedZone: computed(() => {
        const chosen = settings.value.timeZone;
        return chosen && !zoneValues.has(chosen) ? chosen : '';
      }),
      // Only offered if the device is in a different time zone.
      offerDeviceZone: computed(
          () => device &&
              device !== (settings.value.timeZone || state.serverTimeZone)),
      archived: computed(() => archivedCount()),
      archivedHint: computed(() => {
        const n = archivedCount();
        return n === 1 ? t('1 habit is archived.') :
                         t('{n} habits are archived.', {n});
      }),
      reorderHint: computed(
          () => settings.value.reorderMode === 'drag' ?
              t('Categories and habits are moved by their handle.') :
              t('Categories and habits are moved with arrows — by keyboard too.')),
      skipAll: () => actions.skipDays(null),
      /**
       * Reloads the page to apply a new language, once the server has it.
       * @param {string} language
       */
      saveLanguage: async (language) => {
        if (await saveSetting({language})) location.reload();
      },
      /**
       * Saves the completion rate's window; the server computes the rate, so
       * the statistics are reloaded.
       * @param {string} rateWindow
       */
      saveRateWindow: async (rateWindow) => {
        if (await saveSetting({rateWindow})) await refresh();
      },
      /**
       * Previews a slider's value through the custom property `cssVar` while
       * it moves.
       * @param {string} key
       * @param {string} cssVar
       * @param {!Event} event the slider's input event
       */
      slide: (key, cssVar, event) => {
        const value = event.target.value;
        preview[key] = value;
        document.documentElement.style.setProperty(cssVar, `${value}%`);
      },
      /**
       * Saves a slider's value on release.
       * @param {string} key
       * @param {!Event} event the slider's change event
       */
      release: async (key, event) => {
        await saveSetting({[key]: Number(event.target.value)});
        preview[key] = null;
      },
    };
  },
  template: `
    <settings-page
      id="settings-dialog"
      :title="t('Settings')"
    >
      <!-- The signed-in user. -->
      <section
        class="settings-account"
        :aria-label="t('Current user')"
      >
        <span
          class="settings-account-avatar"
          aria-hidden="true"
        >
          {{ account.initials }}
        </span>
        <div class="settings-account-text">
          <p class="settings-account-name">{{ account.name }}</p>
          <p
            v-if="account.detail"
            class="settings-account-detail"
          >
            {{ account.detail }}
          </p>
          <p
            v-if="account.groups.length > 0"
            class="settings-account-groups"
          >
            {{ t('Groups: {list}', {list: account.groups.join(', ')}) }}
          </p>
        </div>
      </section>
      <nav
        class="settings-menu"
        :aria-label="t('Settings sections')"
      >
        <settings-menu-item
          page="settings-look"
          icon="palette"
          :title="t('Appearance')"
          :hint="t('Theme, font, colours and background')"
        />
        <settings-menu-item
          page="settings-board"
          icon="board"
          :title="t('Overview')"
          :hint="t('Reordering and days shown')"
        />
        <settings-menu-item
          page="settings-region"
          icon="globe"
          :title="t('Language & time')"
          :hint="t('Language and time zone')"
        />
        <!-- Hidden if there are no archived habits and the switch is off. -->
        <settings-menu-item
          v-if="archived > 0 || settings.showArchived"
          page="settings-archive"
          icon="archive"
          :title="t('Archive')"
          :hint="t('Archived habits')"
        />
        <settings-menu-item
          icon="skip"
          :title="t('Skip days')"
          :hint="t('Skip days of all habits')"
          @click="skipAll"
        />
        <settings-menu-item
          page="settings-data"
          icon="transfer"
          :title="t('Data')"
          :hint="t('Import, export and delete')"
        />
      </nav>
      <nav
        class="settings-menu"
        :aria-label="t('About the app')"
      >
        <settings-menu-item
          page="settings-version"
          icon="info"
          :title="t('Version')"
          :hint="version"
        />
      </nav>
    </settings-page>
    <settings-page
      id="settings-version"
      :title="t('Version')"
    >
      <dl class="settings-facts">
        <div
          v-for="item in versionFacts"
          :key="item.label"
        >
          <dt>{{ item.label }}</dt><dd>{{ item.value }}</dd>
        </div>
      </dl>
    </settings-page>
    <settings-page
      id="settings-look"
      :title="t('Appearance')"
    >
      <fieldset class="field">
        <legend class="field-label">{{ t('Theme') }}</legend>
        <div
          class="segmented"
          role="radiogroup"
          :aria-label="t('Theme')"
        >
          <label
            v-for="o in options('theme')"
            :key="o.value"
          >
            <input
              type="radio"
              name="settings-theme"
              :value="o.value"
              autocomplete="off"
              :checked="settings.theme === o.value"
              @change="save({theme: o.value})"
            >
            <span><app-icon :name="o.icon"/>{{ t(o.label) }}</span>
          </label>
        </div>
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
        <div
          class="segmented"
          role="radiogroup"
          :aria-label="t('Density')"
        >
          <label
            v-for="o in options('density')"
            :key="o.value"
          >
            <input
              type="radio"
              name="settings-density"
              :value="o.value"
              autocomplete="off"
              :checked="settings.density === o.value"
              @change="save({density: o.value})"
            >
            <span>{{ t(o.label) }}</span>
          </label>
        </div>
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
    </settings-page>
    <settings-page
      id="settings-board"
      :title="t('Overview')"
    >
      <fieldset class="field">
        <legend class="field-label">{{ t('Reordering') }}</legend>
        <label class="switch">
          <input
            v-model="editing"
            type="checkbox"
            autocomplete="off"
          >
          <span>{{ t('Arrange') }}</span>
        </label>
        <p class="field-hint">
          {{ t('Shows the handles for moving habits and categories. Applies until the page is next loaded.') }}
        </p>
        <div
          class="segmented"
          role="radiogroup"
          :aria-label="t('Reordering')"
        >
          <label
            v-for="o in options('reorderMode')"
            :key="o.value"
          >
            <input
              type="radio"
              name="settings-reorder"
              :value="o.value"
              autocomplete="off"
              :checked="settings.reorderMode === o.value"
              @change="save({reorderMode: o.value})"
            >
            <span><app-icon :name="o.icon"/>{{ t(o.label) }}</span>
          </label>
        </div>
        <p class="field-hint">
          {{ reorderHint }}
        </p>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">{{ t('Days in the overview') }}</legend>
        <div
          class="segmented wrap"
          role="radiogroup"
          :aria-label="t('Days in the overview')"
        >
          <label
            v-for="n in [0, 7, 14, 21, 28]"
            :key="n"
          >
            <input
              type="radio"
              name="settings-days"
              :value="n"
              autocomplete="off"
              :checked="settings.overviewDays === n"
              @change="save({overviewDays: n})"
            >
            <span>{{ n === 0 ? t('Automatic') : n }}</span>
          </label>
        </div>
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
    </settings-page>
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
    </settings-page>
    <settings-page
      id="settings-archive"
      :title="t('Archive')"
    >
      <fieldset class="field">
        <legend class="field-label">{{ t('Archive') }}</legend>
        <!-- The state holds the archived habits; the overview shows them at
             once. -->
        <label class="switch">
          <input
            type="checkbox"
            autocomplete="off"
            :checked="settings.showArchived"
            @change="save({showArchived: $event.target.checked})"
          >
          <span>{{ t('Show archived habits') }}</span>
        </label>
        <p class="field-hint">
          {{ archivedHint }}
        </p>
      </fieldset>
    </settings-page>
    <settings-page
      id="settings-data"
      :title="t('Data')"
    >
      <div class="field">
        <span class="field-label">{{ t('Export') }}</span>
        <p class="field-hint">
          {{ t('Saves your habits with their schedules and recorded days, and your categories, as a file: a backup that importing restores. Statistics are computed again.') }}
        </p>
        <button
          type="button"
          class="button"
          :disabled="exporting"
          @click="exportHabits"
        >
          <app-icon name="download"/>{{ t('Export habits') }}
        </button>
      </div>
      <div class="field">
        <span class="field-label">{{ t('Import') }}</span>
        <p class="field-hint">
          {{ t('Adds the habits of an exported file with their history. Habits whose name already exists are skipped; categories of the same name are shared.') }}
        </p>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="importFile"
        >
        <button
          type="button"
          class="button"
          :disabled="importing"
          @click="importInput.click()"
        >
          <app-icon name="upload"/>{{ t('Import habits') }}
        </button>
        <p
          v-if="importResult"
          class="field-hint"
          role="status"
        >
          {{ importResult }}
        </p>
      </div>
      <div class="field">
        <span class="field-label">{{ t('Delete') }}</span>
        <p class="field-hint">
          {{ t('Deletes all your habits with their recorded days, your categories and your settings. This cannot be undone; export your habits first to keep them.') }}
        </p>
        <button
          type="button"
          class="button danger"
          :disabled="deleting"
          @click="askToDeleteAll"
        >
          <app-icon name="trash"/>{{ t('Delete all data') }}
        </button>
      </div>
    </settings-page>
    <dialog
      id="delete-all-dialog"
      ref="deleteDialog"
      class="dialog compact"
      aria-labelledby="delete-all-title"
      aria-describedby="delete-all-text"
      @close="deleteAll"
    >
      <form method="dialog">
        <h2
          id="delete-all-title"
          class="dialog-head"
        >
          {{ t('Delete all data?') }}
        </h2>
        <p
          id="delete-all-text"
          class="dialog-text"
        >
          {{ t('All habits, recorded days, categories and settings will be deleted for good.') }}
        </p>
        <footer class="dialog-foot">
          <button
            type="submit"
            class="button ghost"
            value="cancel"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="submit"
            class="button danger"
            value="delete"
          >
            {{ t('Delete') }}
          </button>
        </footer>
      </form>
    </dialog>`,
};

/** Opens the settings. */
export function openSettings() {
  error.message = '';
  openPage(document.getElementById('settings-dialog'));
}
