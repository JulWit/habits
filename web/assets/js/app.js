// Entry point: the app's shell (title bar, views, pages, toasts), appearance
// and keyboard shortcuts. Routing is in route.js, loading the state in
// loader.js and data changes in actions.js.

import * as actions from './actions.js';
import {onlyOpen, TheBoardView, toggleFilter} from './board-view.js';
import {TheCategoryEditor} from './category-editor.js';
import {TheCategoryPicker} from './category-picker.js';
import {TheCategoryView} from './category-view.js';
import {TheDayEditor} from './day-editor.js';
import {TheDayStatsView} from './day-stats-view.js';
import {TheHabitEditor} from './habit-editor.js';
import {TheHabitView} from './habit-view.js';
import {t} from './i18n.js';
import {AppIcon, AppIconBadge} from './icons.js';
import {initSync, refresh, syncStatus} from './loader.js';
import {definePatterns} from './patterns.js';
import {goHome, route, syncRoute} from './route.js';
import {openSearch, TheSearchDialog} from './search-dialog.js';
import {openSettings, TheSettingsDialog} from './settings-dialog.js';
import {TheSkipEditor} from './skip-editor.js';
import {state, stateRevision} from './state.js';
import {initTooltips} from './tooltip.js';
import {errorText, redoLast, TheToastList, toast, undoLast} from './undo.js';
import {createApp, defineAsyncComponent, ref, watch, watchEffect} from './vue.js';

/**
 * The style guide, loaded on first use: it is only reachable at #/styleguide.
 */
const TheStyleGuideView = defineAsyncComponent({
  loader: () => import('./style-guide-view.js')
                    .then((module) => module.TheStyleGuideView),
  onError: (err, retry, fail) => {
    toast(errorText(err), {error: true});
    fail();
  },
});

/**
 * The shell: the title bar, the views (one shown at a time, see route.js),
 * the pages and dialogs, the toasts and the live region of the board.
 */
const App = {
  name: 'App',
  components: {
    TheBoardView,
    TheCategoryEditor,
    TheCategoryPicker,
    TheCategoryView,
    TheDayEditor,
    TheDayStatsView,
    TheHabitEditor,
    TheHabitView,
    TheSearchDialog,
    TheSettingsDialog,
    TheSkipEditor,
    TheStyleGuideView,
    TheToastList,
  },
  setup() {
    // The style guide stays loaded once it has been shown.
    const guideShown = ref(false);
    watchEffect(() => {
      if (route.view === 'styleguide') guideShown.value = true;
    });

    return {
      route,
      syncStatus,
      onlyOpen,
      guideShown,
      announcement: actions.announcement,
      // Without a keyboard the shortcut in the title means nothing; screen
      // readers would still read it out.
      searchTitle: matchMedia('(pointer: coarse)').matches ? t('Search') :
                                                             t('Search (/)'),
      createHabit: actions.createHabit,
      openSearch,
      openSettings,
      toggleFilter,
    };
  },
  // The logo is a check mark in a ring with four gaps at the bottom, matching
  // the day marks and the category progress. Square line caps, so the gaps
  // stay open; the ring stays inside the viewBox to avoid clipping. The app
  // name is not translated.
  template: `
    <header class="topbar">
      <div class="topbar-inner">
        <h1 class="brand">
          <svg
            class="brand-mark"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
          >
            <path d="M2.98 15.28A9.6 9.6 0 1 1 21.02 15.28"/>
            <path d="M20.14 17.09A9.6 9.6 0 0 1 16.41 20.53"/>
            <path d="M14.54 21.26A9.6 9.6 0 0 1 9.46 21.26"/>
            <path d="M7.59 20.53A9.6 9.6 0 0 1 3.86 17.09"/>
            <path
              d="M8 12.3 10.9 15.2 16.1 9.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span
            class="brand-text"
            translate="no"
          >Habits</span>
        </h1>
        <div class="topbar-actions">
          <span
            class="sync-status"
            role="status"
            :hidden="!syncStatus.text"
          >
            {{ syncStatus.text }}
          </span>
          <button
            id="add-habit"
            class="icon-button"
            type="button"
            :title="t('New habit')"
            :aria-label="t('New habit')"
            @click="createHabit"
          >
            <app-icon name="plus"/>
          </button>
          <button
            id="open-search"
            class="icon-button"
            type="button"
            :title="searchTitle"
            :aria-label="t('Search')"
            aria-haspopup="dialog"
            @click="openSearch"
          >
            <app-icon name="search"/>
          </button>
          <button
            id="filter-open-habits"
            class="icon-button"
            type="button"
            :title="t('Show only open')"
            :aria-label="t('Show only open')"
            :aria-pressed="String(onlyOpen)"
            @click="toggleFilter"
          >
            <app-icon name="filter"/>
          </button>
          <button
            id="open-settings"
            class="icon-button"
            type="button"
            :title="t('Settings')"
            :aria-label="t('Settings')"
            aria-haspopup="dialog"
            @click="openSettings"
          >
            <app-icon name="gear"/>
          </button>
        </div>
      </div>
    </header>
    <main
      id="board-view"
      class="view"
      :hidden="route.view !== 'board'"
    >
      <the-board-view/>
    </main>
    <the-habit-view/>
    <the-category-view/>
    <the-day-stats-view/>
    <main
      id="style-guide-view"
      class="view"
      :hidden="route.view !== 'styleguide'"
    >
      <the-style-guide-view v-if="guideShown"/>
    </main>
    <!-- Pages: full-screen dialogs with a back button, stacked (see
         page-stack.js). -->
    <the-habit-editor/>
    <the-settings-dialog/>
    <the-category-picker/>
    <the-category-editor/>
    <the-skip-editor/>
    <the-search-dialog/>
    <the-day-editor/>
    <!-- Asks before an editor with unsaved changes closes (see page-stack.js).
         The first button, keeping the changes, gets the focus. -->
    <dialog
      id="discard-dialog"
      class="dialog compact"
      aria-labelledby="discard-title"
    >
      <form method="dialog">
        <h2
          id="discard-title"
          class="dialog-head"
        >
          {{ t('Discard changes?') }}
        </h2>
        <footer class="dialog-foot">
          <button
            type="submit"
            class="button ghost"
            value="keep"
          >
            {{ t('Keep editing') }}
          </button>
          <button
            type="submit"
            class="button primary"
            value="discard"
          >
            {{ t('Discard') }}
          </button>
        </footer>
      </form>
    </dialog>
    <the-toast-list/>
    <!-- Live region announcing the result of a tap on the board. -->
    <div
      id="board-status"
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ announcement }}
    </div>`,
};

/**
 * Sets a class on the root element while the page is scrolled. Used for the
 * day header over a background image.
 */
function initScrollState() {
  const root = document.documentElement;
  /** Marks the document as scrolled once it has left the top. */
  const apply = () => {
    const on = window.scrollY > 4 ? 'on' : 'off';
    if (root.dataset.scrolled !== on) root.dataset.scrolled = on;
  };
  window.addEventListener('scroll', apply, {passive: true});
  apply();
}

/** Registers the service worker. Failures are ignored. */
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/**
 * Shows the view the URL names, and again whenever the URL or the state
 * changes.
 */
function initRouting() {
  window.addEventListener('hashchange', syncRoute);
  // pushState navigation triggers popstate, not hashchange.
  window.addEventListener('popstate', syncRoute);
  watch(stateRevision, syncRoute);
  syncRoute();

  // The route classes on <html> hide the app's title bar on the views that
  // have their own (see components.css).
  watchEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('route-styleguide', route.view === 'styleguide');
    root.classList.toggle(
        'route-detail',
        route.view === 'habit' || route.view === 'category' ||
            route.view === 'days');
  });
}

/**
 * Initialises the app and loads the state.
 * @return {!Promise<void>}
 */
async function main() {
  // Before the board, which measures its width depending on these settings.
  initAppearance();
  const app = createApp(App);
  // What every template may use: the icons and t() for the UI texts.
  app.component('AppIcon', AppIcon);
  app.component('AppIconBadge', AppIconBadge);
  app.config.globalProperties.t = t;
  app.mount('#app');
  initRouting();
  initScrollState();
  initServiceWorker();
  initShortcuts();
  initTooltips();
  initSync();
  await refresh();
}

// ---------- theme ----------

/**
 * Applies the appearance settings to <html> whenever they change. Until the
 * state is loaded, the initial HTML carries them, set by the server. The
 * server also validates them, so they are applied as they are.
 */
function initAppearance() {
  // The images of the icon and halftone patterns.
  definePatterns(document.documentElement);
  watchEffect(() => {
    const settings = state.settings;
    if (!settings.theme) return;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    applyThemeColor(settings.theme);
    root.dataset.font = settings.font;
    // Affects the column width, so this runs before the board is measured.
    root.dataset.density = settings.density;
    root.dataset.pattern = settings.pattern;
    // Affects the width of the last column.
    root.dataset.reorder = settings.reorderMode;
    root.dataset.band = settings.bandColor;
    root.dataset.todayBand = settings.showBand ? 'on' : 'off';

    // Custom properties, as the stylesheet computes with them.
    root.style.setProperty('--today-opacity', `${settings.bandOpacity}%`);
    root.style.setProperty('--band-opacity', `${settings.bandFillOpacity}%`);
  });
  rememberColorScheme();
}

/**
 * Stores the device's colour scheme in a cookie, so the manifest can carry the
 * matching bar colour for the "system" theme. Firefox on Android colours the
 * system bars of an installed app from the manifest only and ignores the
 * theme-color entries.
 */
function rememberColorScheme() {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return;
  /** Stores the current colour scheme in a cookie for the server. */
  const store = () => {
    const scheme = query.matches ? 'dark' : 'light';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `color_scheme=${scheme}; Path=/; Max-Age=31536000; ` +
        `SameSite=Lax${secure}`;
  };
  query.addEventListener('change', store);
  store();
}

/**
 * Colours of the system bars, matching --bg in base.css and index.html.
 * @const {!Object<string, string>}
 */
const THEME_COLORS = {
  light: '#e6e8ec',
  dark: '#0f0f0f',
};

/**
 * Sets the theme-color entries in <head>. A chosen theme gives both entries
 * its colour; "system" gives each entry the colour of its colour scheme.
 * @param {string} theme
 */
function applyThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLORS[theme === 'system' ? scheme : theme];
  }
}

// ---------- keyboard ----------

/**
 * Registers the keyboard shortcuts.
 */
function initShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const inField = event.target.closest?.('input, textarea, select');
    const inDialog = event.target.closest?.('dialog');
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z' && !inField) {
      event.preventDefault();
      if (event.shiftKey) {
        redoLast();
      } else {
        undoLast();
      }
    } else if (mod && key === 'y' && !inField) {
      event.preventDefault();
      redoLast();
    } else if (key === 'n' && !mod && !inField && !inDialog) {
      event.preventDefault();
      actions.createHabit();
    } else if (
        ((key === '/' && !mod) || (mod && key === 'k')) && !inField &&
        !inDialog) {
      event.preventDefault();
      openSearch();
    } else if (event.key === 'Escape' && !inDialog && [
                 'habit', 'category', 'days'
               ].includes(route.view)) {
      goHome();
    }
  });
}

main();
