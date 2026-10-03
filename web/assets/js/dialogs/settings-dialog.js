/**
 * @fileoverview Settings: the menu with the signed-in user, and the pages it
 * opens. The appearance, overview, language and data pages are modules of
 * their own (settings-*-dialog.js); the small version and archive pages are
 * here. What the pages share is in settings-page.js.
 */

import {archivedCount, state} from '../data/state.js';
import {openPage} from '../ui/page-stack.js';
import {factItem} from '../ui/stat-panels.js';
import {locale, plural, t} from '../util/i18n.js';
import {computed} from '../vue.js';

import {SettingsBoardPage} from './settings-board-dialog.js';
import {SettingsDataPage} from './settings-data-dialog.js';
import {SettingsLookPage} from './settings-look-dialog.js';
import {clearError, pageToReopen, saveSetting, SettingsPage} from './settings-page.js';
import {SettingsRegionPage} from './settings-region-dialog.js';
import {openSkipEditor} from './skip-editor.js';

/**
 * Up to two initials: first and last word, or the first letter alone.
 * @param {string} name
 * @return {string}
 */
function initials(name) {
  const words = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] :
                                     words.slice(0, 1);
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
 * A row of the settings menu that opens the settings page `page`; without
 * one, its user handles the click.
 */
const SettingsMenuItem = {
  name: 'SettingsMenuItem',
  props: {
    page: {type: String, default: undefined},
    icon: {type: String, required: true},
    title: {type: String, required: true},
    hint: {type: String, default: ''},
  },
  /**
   * @param {{page?: string}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    return {
      /** Opens the row's page, if it has one. */
      open: () => {
        if (props.page) openSettingsPage(props.page);
      },
    };
  },
  template: `
    <button
      type="button"
      class="settings-menu-item"
      :data-page="page"
      @click="open"
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

/** The settings: the menu and its pages. */
export const TheSettingsDialog = {
  name: 'TheSettingsDialog',
  components: {
    SettingsBoardPage,
    SettingsDataPage,
    SettingsLookPage,
    SettingsMenuItem,
    SettingsPage,
    SettingsRegionPage,
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const version =
        computed(() => state.build?.version || t('Development build'));
    return {
      settings: computed(() => state.settings),
      version,
      account: computed(() => {
        const user = state.user ?? {id: '', name: '', email: ''};
        // Without a display name (e.g. single-user mode), the ID stands in.
        const name = user.name || user.id || t('Unknown');
        return {
          name,
          initials: initials(name),
          // The ID is only worth a line if the name does not show it already.
          detail: user.email || (user.id !== name ? user.id : ''),
        };
      }),
      versionFacts: computed(() => {
        const build = state.build ?? {};
        // Twelve characters identify a commit well enough.
        const commit = build.revision ? build.revision.slice(0, 12) +
                (build.modified ? ` (${t('modified')})` : '') :
                                        t('Unknown');
        return [
          factItem(t('Version'), version.value),
          factItem(t('Commit'), commit),
          factItem(t('Built'), formatBuildTime(build.time)),
          factItem(t('Go version'), build.goVersion || t('Unknown')),
        ];
      }),
      archived: computed(() => archivedCount()),
      archivedHint: computed(
          () => plural(
              archivedCount(),
              '{n} habit is archived.',
              '{n} habits are archived.')),
      save: saveSetting,
      skipAll: () => openSkipEditor(null),
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
    <settings-look-page/>
    <settings-board-page/>
    <settings-region-page/>
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
    <settings-data-page/>`,
};

/**
 * Returns the settings page with the ID, once mounted.
 * @param {string} id
 * @return {?HTMLDialogElement}
 */
function pageById(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLDialogElement ? el : null;
}

/**
 * Opens the settings page with the ID on top of the open pages.
 * @param {string} id
 */
function openSettingsPage(id) {
  const el = pageById(id);
  if (el) openPage(el);
}

/** Opens the settings. */
export function openSettings() {
  clearError();
  openSettingsPage('settings-dialog');
}

/**
 * Opens the settings page left by the reload for a new language, if any, so
 * the user is where they were.
 */
export function reopenSettings() {
  const page = pageToReopen();
  if (!page || !pageById(page)) return;
  openSettings();
  openSettingsPage(page);
}
