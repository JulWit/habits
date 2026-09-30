// Entry point: loads the state, initialises the views and handles routing,
// appearance and keyboard shortcuts. Data changes are in actions.js.

import * as actions from './actions.js';
import {api} from './api.js';
import {currentDays, editing, initOverview, measureBoard} from './board-view.js';
import {initCategoryEditor} from './category-editor.js';
import {initCategoryPicker} from './category-picker.js';
import {initCategory} from './category-view.js';
import {initValueDialog} from './day-editor.js';
import {initDays} from './day-stats-view.js';
import {initEditor} from './habit-editor.js';
import {initDetail} from './habit-view.js';
import {t, translateDocument} from './i18n.js';
import {paintIcons} from './icons.js';
import {isConnectionError, isOffline, overlay, pending, rememberedState, rememberState, setOffline, setStatusHandler, statusText} from './outbox.js';
import {definePatterns} from './patterns.js';
import {initSearch, openSearch} from './search-dialog.js';
import {initSettings} from './settings-dialog.js';
import {initSkipDialog, openSkipDialog} from './skip-editor.js';
import {habitById, replaceState, state, subscribe, upsertHabit} from './state.js';
import {route} from './route.js';
import {initTooltips} from './tooltip.js';
import {errorText, redoLast, setChangeHandler, toast, undoLast} from './undo.js';
import {createVueApp} from './vue-app.js';
import {watchEffect} from './vue.js';

const boardView = document.getElementById('board-view');
const styleGuideView = document.getElementById('style-guide-view');

/**
 * The actions the views call, by name.
 * @const {!Object<string, !Function>}
 */
const handlers = {
  openHabit: (id) => openView(`#/habit/${id}`),
  closeHabit: goHome,
  openCategory: (id) => openView(`#/category/${id}`),
  closeCategory: goHome,
  openDays: () => openView('#/days'),
  closeDays: goHome,
  createHabit: actions.createHabit,
  editHabit: actions.editHabit,
  deleteHabit: actions.deleteHabit,
  toggleArchive: actions.toggleArchive,
  tapEntry: actions.tapEntry,
  editEntry: actions.editEntry,
  extendHistory,
  updateCategory: actions.updateCategory,
  moveCategory: actions.moveCategory,
  setCategoryOrder: actions.setCategoryOrder,
  moveHabit: actions.moveHabit,
  setHabitOrder: actions.setHabitOrder,
  deleteCategory: actions.deleteCategory,
  // Opens the page for skipping days of a habit, or of all for null.
  skipDays: (habitId) =>
      openSkipDialog(habitId ? habitById(habitId) : null, actions.skipDays),
};

/**
 * Connects the reorder mode switch in the settings.
 */
function initEditMode() {
  // The reorder mode switch in the settings dialog.
  // The board shows the handles and measures its width again.
  const input = document.getElementById('settings-edit');
  input.addEventListener('change', () => {
    editing.value = input.checked;
  });
  watchEffect(() => {
    input.checked = editing.value;
  });
}

/**
 * Sets a class on the root element while the page is scrolled. Used for the
 * day header over a background image.
 */
function initScrollState() {
  const root = document.documentElement;
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
 * Initialises the app and loads the state.
 * @return {!Promise<void>}
 */
async function main() {
  actions.configureActions({refresh, currentHabitId, goHome});
  // Translate first, so views read translated texts from the markup.
  translateDocument();
  // Insert the icons before the views are initialised.
  paintIcons();
  // Before the board, which measures its width depending on these settings.
  initAppearance();
  initCategoryPicker({createCategory: actions.createCategory});
  initEditor();
  initCategoryEditor();
  initValueDialog();
  initSkipDialog();
  initOverview(handlers);
  initSearch(handlers);
  initDetail(handlers, document.getElementById('habit-view-host'));
  initCategory(handlers, document.getElementById('category-view-host'));
  initDays(handlers, document.getElementById('day-stats-view-host'));
  initEditMode();
  initScrollState();
  initServiceWorker();
  initSettings({
    effectiveDays: currentDays,
    reload: refresh,
    skipDays: handlers.skipDays,
  });
  initShortcuts();
  initTooltips();
  initSync();

  document.getElementById('add-habit')
      .addEventListener('click', actions.createHabit);

  setChangeHandler(refresh);
  subscribe(syncRoute);
  window.addEventListener('hashchange', syncRoute);
  // pushState navigation triggers popstate, not hashchange.
  window.addEventListener('popstate', syncRoute);

  await refresh();
}

/**
 * The start date of the loaded entries, or null for the default window. Kept
 * for all subsequent reloads.
 * @type {?string}
 */
let historyFrom = null;

/**
 * Loads the state from the server. Writes still waiting in the outbox are laid
 * over it and sent. Without a connection, the last loaded state is shown
 * instead (on startup), or the current one is kept.
 * @return {!Promise<void>}
 */
async function refresh() {
  let loaded;
  try {
    loaded = await api.loadState(historyFrom);
  } catch (err) {
    if (!isConnectionError(err)) {
      toast(errorText(err), {error: true, timeout: 12000});
      return;
    }
    setOffline(true);
    const remembered = state.user ? null : rememberedState();
    if (remembered) {
      replaceState(overlay(remembered));
      toast(t('Offline — showing the last loaded state'));
    } else if (state.user) {
      // Keep the current state, with writes queued since (e.g. by undo).
      replaceState(overlay({habits: state.habits}));
    } else {
      toast(errorText(err), {error: true, timeout: 12000});
    }
    return;
  }
  rememberState(loaded);
  setOffline(false);
  lastLoaded = Date.now();
  reloadAtNextDay(loaded.nextDayIn);
  replaceState(overlay(loaded));
  // The reloaded state only contains the entry window again.
  fullHistoryLoaded.clear();
  if (pending().length > 0) actions.syncOutbox();
}

/** When the state was last loaded (Date.now()), 0 before the first load. */
let lastLoaded = 0;

/** When the loaded `today` ends (Date.now()). */
let dayEndsAt = Infinity;

/**
 * The timer that reloads the state when the loaded `today` ends.
 * @type {number|undefined}
 */
let dayTimer;

/**
 * Reloads the state once the day the server called today is over, so a board
 * left open over midnight moves on to the new day. `ms` comes from the
 * server, which knows the user's time zone. A sleeping device may delay the
 * timer; the reload when the page becomes visible covers that.
 * @param {number|undefined} ms
 */
function reloadAtNextDay(ms) {
  if (typeof ms !== 'number') return;
  clearTimeout(dayTimer);
  dayEndsAt = Date.now() + ms;
  // A second later, so the server has surely reached the new day.
  dayTimer = setTimeout(refresh, ms + 1000);
}

/**
 * How old the state may be when the page becomes visible again before it is
 * reloaded, e.g. to show changes made on another device meanwhile.
 */
const STALE_MS = 10_000;

/**
 * Whether the shown state may be outdated: a new day, or loaded a while ago.
 * @return {boolean}
 */
function isStale() {
  const now = Date.now();
  return now >= dayEndsAt || now - lastLoaded > STALE_MS;
}

/** How often to try again while offline or while writes are waiting. */
const RETRY_MS = 30_000;

/**
 * Shows the sync status in the header and retries: when the browser reports
 * a connection, when the page becomes visible, and every RETRY_MS while
 * something is pending. A page that becomes visible also reloads a state
 * that may be outdated (isStale).
 */
function initSync() {
  const status = document.getElementById('sync-status');
  const paint = () => {
    const text = statusText();
    status.textContent = text;
    status.hidden = !text;
    document.documentElement.dataset.offline = isOffline() ? 'on' : 'off';
  };
  setStatusHandler(paint);
  paint();

  const retry = () => {
    if (pending().length > 0) {
      actions.syncOutbox();
    } else if (isOffline()) {
      refresh();
    }
  };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Sending the waiting writes reloads the state afterwards.
    if (pending().length > 0) {
      actions.syncOutbox();
    } else if (isOffline() || isStale()) {
      refresh();
    }
  });
  setInterval(() => {
    if (isOffline() || pending().length > 0) retry();
  }, RETRY_MS);
}

/**
 * Loads entries back to `from`, unless they are already loaded.
 * @param {string} from
 * @return {!Promise<void>}
 */
async function extendHistory(from) {
  if (historyFrom !== null && from >= historyFrom) return;
  historyFrom = from;
  await refresh();
}

/**
 * IDs of habits whose complete history has been loaded. /api/state only
 * contains recent entries; the detail view loads the rest per habit.
 * @const {!Set<string>}
 */
const fullHistoryLoaded = new Set();

/**
 * Loads the complete history of a habit, once.
 * @param {string} id
 * @return {!Promise<void>}
 */
async function ensureFullHistory(id) {
  if (fullHistoryLoaded.has(id)) return;
  fullHistoryLoaded.add(id);
  try {
    upsertHabit(await api.getHabit(id));
  } catch (err) {
    fullHistoryLoaded.delete(id);
    // Offline, the view shows the loaded entries; the header says why.
    if (!isConnectionError(err)) toast(errorText(err), {error: true});
  }
}

// ---------- styleguide ----------

/** Whether the style guide has been rendered. */
let styleguideDrawn = false;

/**
 * Loads (dynamic import) and renders the style guide on first use.
 * @return {!Promise<void>}
 */
async function showStyleguide() {
  if (styleguideDrawn) return;
  styleguideDrawn = true;
  try {
    const {StyleGuideView} = await import('./style-guide-view.js');
    createVueApp(StyleGuideView).mount(styleGuideView);
  } catch (err) {
    styleguideDrawn = false;
    toast(errorText(err), {error: true});
  }
}

// ---------- routing ----------

/**
 * Returns the ID of the habit the route shows, or null.
 * @return {?string}
 */
function currentHabitId() {
  const match = location.hash.match(/^#\/habit\/([\w-]+)$/);
  return match ? match[1] : null;
}

/**
 * Returns the ID of the category the route shows, or null.
 * @return {?string}
 */
function currentCategoryId() {
  const match = location.hash.match(/^#\/category\/([\w-]+)$/);
  return match ? match[1] : null;
}

/**
 * Opens a habit or category view as a new history entry, marked as opened by
 * the app, so that its back button can return through the history.
 * @param {string} hash
 */
function openView(hash) {
  history.pushState({view: true}, '', hash);
  syncRoute();
}

/**
 * Leaves the current view. A view opened in the app goes back one entry, as
 * the system back button does, so the next back does not return to it; this
 * also returns from a habit to the category it was opened from. Otherwise
 * (a view opened by its URL) it goes to the overview. Uses pushState, as
 * setting location.hash to "" leaves a "#" and does not reliably fire
 * hashchange.
 */
function goHome() {
  if (history.state?.view) {
    history.back();
    return;
  }
  if (location.hash) {
    history.pushState(null, '', location.pathname + location.search);
  }
  syncRoute();
}

/**
 * Shows the view `name` (see route.js); the habit, category and day statistics
 * views show themselves. The route classes on <html> hide the app's title bar
 * on the views that have their own (see components.css).
 * @param {string} name
 * @param {?string=} id the habit or category shown
 */
function showView(name, id = null) {
  route.view = name;
  route.id = id;
  boardView.hidden = name !== 'board';
  styleGuideView.hidden = name !== 'styleguide';
  const root = document.documentElement;
  root.classList.toggle('route-styleguide', name === 'styleguide');
  root.classList.toggle(
      'route-detail',
      name === 'habit' || name === 'category' || name === 'days');
}

/**
 * Returns to the overview without a history entry, e.g. for a removed habit.
 */
function replaceWithOverview() {
  history.replaceState(null, '', location.pathname + location.search);
}

/**
 * Shows the view the route names.
 */
function syncRoute() {
  // The style guide needs no data.
  if (location.hash === '#/styleguide') {
    showView('styleguide');
    showStyleguide();
    return;
  }

  if (location.hash === '#/days') {
    showView('days');
    return;
  }

  const categoryId = currentCategoryId();
  if (categoryId) {
    if (state.categories.some((c) => c.id === categoryId)) {
      showView('category', categoryId);
      return;
    }
    // The category no longer exists.
    replaceWithOverview();
  }

  const habitId = currentHabitId();
  if (habitId) {
    if (habitById(habitId)) {
      showView('habit', habitId);
      // Shown from the loaded entries, then again once the full history
      // arrives.
      ensureFullHistory(habitId);
      return;
    }
    // The habit no longer exists; before the state is loaded, it may yet.
    if (state.habits.length > 0) replaceWithOverview();
  }

  showView('board');
  // Measure again, as the board could not be measured while hidden.
  measureBoard();
}

// ---------- theme ----------

/**
 * Applies the appearance settings to <html> whenever the state changes. Until
 * the state is loaded, the initial HTML carries them, set by the server. The
 * server also validates them, so they are applied as they are.
 */
function initAppearance() {
  // The images of the icon and halftone patterns.
  definePatterns(document.documentElement);
  subscribe(() => {
    const settings = state.settings;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    applyThemeColor(settings.theme);
    root.dataset.font = settings.font;
    // Affects the column width, so this runs before the board is rendered.
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
    } else if (
        event.key === 'Escape' && !inDialog &&
        (currentHabitId() || currentCategoryId() ||
         location.hash === '#/days')) {
      goHome();
    }
  });
}

main();
