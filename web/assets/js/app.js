// Entry point: loads the state, initialises the views and handles routing,
// appearance and keyboard shortcuts. Data changes are in actions.js.

import { api } from "./api.js";
import { state, replaceState, habitById, upsertHabit, subscribe } from "./state.js";
import { setChangeHandler, toast, errorText, undoLast, redoLast } from "./undo.js";
import { initOverview, render as renderOverview, currentDays } from "./overview.js";
import { initDetail, renderDetail } from "./detail.js";
import { initCategory, renderCategory } from "./category.js";
import { initEditor } from "./editor.js";
import { initCategoryPicker } from "./categorypicker.js";
import { initCategoryEditor } from "./categoryeditor.js";
import { initSettings, blurLength } from "./settings.js";
import { initValueDialog } from "./value.js";
import { initSearch, openSearch } from "./search.js";
import * as actions from "./actions.js";
import { paintIcons } from "./icons.js";
import { translateDocument } from "./i18n.js";

// Theme labels.
const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" };
const DEFAULT_THEME = "system";

/** Returns `theme` if it is known, otherwise the default. */
function knownTheme(theme) {
  return THEME_LABEL[theme] ? theme : DEFAULT_THEME;
}

/** Known fonts, as in store.Fonts. Unknown values fall back to the default. */
const FONTS = ["system", "inter", "roboto", "geist", "opensans", "montserrat", "poppins", "lato"];
const DEFAULT_FONT = "inter";

function knownFont(font) {
  return FONTS.includes(font) ? font : DEFAULT_FONT;
}

/** Known densities, as in store.Densities. */
const DENSITIES = ["compact", "standard", "comfortable"];
const DEFAULT_DENSITY = "standard";

function knownDensity(density) {
  return DENSITIES.includes(density) ? density : DEFAULT_DENSITY;
}

/** Known background patterns, as in store.Patterns. */
const PATTERNS = ["none", "dots", "grid", "diagonal", "cross", "lines", "checks", "gradient", "glow", "image"];
const DEFAULT_PATTERN = "none";

function knownPattern(pattern) {
  return PATTERNS.includes(pattern) ? pattern : DEFAULT_PATTERN;
}

/** Returns `value` clamped to [min, max], or `fallback` if it is not a number. */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Whether reorder mode is active. Not persisted. */
let editing = false;

const overviewView = document.getElementById("view-overview");
const detailView = document.getElementById("view-detail");
const categoryView = document.getElementById("view-category");
const styleguideView = document.getElementById("view-styleguide");

const handlers = {
  openHabit: (id) => { location.hash = `#/habit/${id}`; },
  closeHabit: goHome,
  openCategory: (id) => { location.hash = `#/category/${id}`; },
  closeCategory: goHome,
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
};

function initEditMode() {
  // The reorder mode switch in the settings dialog.
  const input = document.getElementById("settings-edit");
  const apply = () => {
    document.documentElement.dataset.edit = editing ? "on" : "off";
    input.checked = editing;
    // The handles change the available width, so re-render the board.
    renderOverview();
  };
  input.addEventListener("change", () => {
    editing = input.checked;
    apply();
  });
  apply();
}

/**
 * Sets a class on the root element while the page is scrolled. Used for the
 * day header over a background image.
 */
function initScrollState() {
  const root = document.documentElement;
  const apply = () => {
    const on = window.scrollY > 4 ? "on" : "off";
    if (root.dataset.scrolled !== on) root.dataset.scrolled = on;
  };
  window.addEventListener("scroll", apply, { passive: true });
  apply();
}

/** Registers the service worker. Failures are ignored. */
function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

async function main() {
  // Translate first, so views read translated texts from the markup.
  translateDocument();
  // Insert the icons before the views are initialised.
  paintIcons();
  // Before the board, which measures its width depending on these settings.
  initAppearance();
  initCategoryPicker({ createCategory: actions.createCategory });
  initEditor();
  initCategoryEditor();
  initValueDialog();
  initOverview(handlers);
  initSearch(handlers);
  initDetail(handlers);
  initCategory(handlers);
  initEditMode();
  initScrollState();
  initServiceWorker();
  initSettings({ effectiveDays: currentDays, reload: refresh });
  initShortcuts();

  document.getElementById("add-habit").addEventListener("click", actions.createHabit);

  actions.configureActions({ refresh, currentHabitId, goHome });
  setChangeHandler(refresh);
  subscribe(syncRoute);
  window.addEventListener("hashchange", syncRoute);
  // pushState navigation triggers popstate, not hashchange.
  window.addEventListener("popstate", syncRoute);

  await refresh();
}

/**
 * The start date of the loaded entries, or null for the default window. Kept
 * for all subsequent reloads.
 */
let historyFrom = null;

async function refresh() {
  try {
    replaceState(await api.loadState(historyFrom));
    // The reloaded state only contains the entry window again.
    fullHistoryLoaded.clear();
  } catch (err) {
    toast(errorText(err), { error: true, timeout: 12000 });
  }
}

/** Loads entries back to `from`, unless they are already loaded. */
async function extendHistory(from) {
  if (historyFrom !== null && from >= historyFrom) return;
  historyFrom = from;
  await refresh();
}

/**
 * IDs of habits whose complete history has been loaded. /api/state only
 * contains recent entries; the detail view loads the rest per habit.
 */
const fullHistoryLoaded = new Set();

async function ensureFullHistory(id) {
  if (fullHistoryLoaded.has(id)) return;
  fullHistoryLoaded.add(id);
  try {
    upsertHabit(await api.getHabit(id));
  } catch (err) {
    fullHistoryLoaded.delete(id);
    toast(errorText(err), { error: true });
  }
}

// ---------- styleguide ----------

/** Loads (dynamic import) and renders the style guide on first use. */
let styleguideDrawn = false;

async function showStyleguide() {
  if (styleguideDrawn) return;
  styleguideDrawn = true;
  try {
    const module = await import("./styleguide.js");
    module.renderStyleguide(styleguideView);
  } catch (err) {
    styleguideDrawn = false;
    toast(errorText(err), { error: true });
  }
}

// ---------- routing ----------

function currentHabitId() {
  const match = location.hash.match(/^#\/habit\/([\w-]+)$/);
  return match ? match[1] : null;
}

function currentCategoryId() {
  const match = location.hash.match(/^#\/category\/([\w-]+)$/);
  return match ? match[1] : null;
}

/**
 * Returns to the overview. Uses pushState, as setting location.hash to ""
 * leaves a "#" and does not reliably fire hashchange.
 */
function goHome() {
  if (location.hash) history.pushState(null, "", location.pathname + location.search);
  syncRoute();
}

function syncRoute() {
  // The style guide needs no data.
  if (location.hash === "#/styleguide") {
    document.documentElement.classList.remove("route-detail");
    document.documentElement.classList.add("route-styleguide");
    overviewView.hidden = true;
    detailView.hidden = true;
    categoryView.hidden = true;
    styleguideView.hidden = false;
    showStyleguide();
    return;
  }
  styleguideView.hidden = true;
  document.documentElement.classList.remove("route-styleguide");

  // Category detail view.
  const categoryId = currentCategoryId();
  const category = categoryId
    ? state.categories.find((c) => c.id === categoryId)
    : null;
  if (categoryId && !category) {
    // The category no longer exists: back to the overview.
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (category) {
    document.documentElement.classList.add("route-detail");
    overviewView.hidden = true;
    detailView.hidden = true;
    categoryView.hidden = false;
    renderCategory(category);
    // Perfect days are counted over the whole year.
    extendHistory(`${state.today.slice(0, 4)}-01-01`);
    return;
  }
  categoryView.hidden = true;

  const id = currentHabitId();
  const habit = id ? habitById(id) : null;

  if (!habit) {
    // The habit no longer exists: back to the overview.
    if (id && state.habits.length > 0) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    document.documentElement.classList.remove("route-detail");
    overviewView.hidden = false;
    detailView.hidden = true;
    // Re-render, as the board could not be measured while hidden.
    renderOverview();
    return;
  }
  // The detail view has no day columns.
  document.documentElement.classList.add("route-detail");
  overviewView.hidden = true;
  detailView.hidden = false;
  renderDetail(habit);
  // Render from the loaded entries, then again once the full history arrives.
  ensureFullHistory(habit.id);
}

// ---------- theme ----------

/**
 * Applies the appearance settings to <html> whenever the state changes. The
 * server already sets them in the initial HTML.
 */
function initAppearance() {
  const apply = () => {
    const root = document.documentElement;
    const theme = knownTheme(state.settings?.theme);
    root.dataset.theme = theme;
    applyThemeColor(theme);
    root.dataset.font = knownFont(state.settings?.font);
    // Affects the column width, so this runs before the board is rendered.
    root.dataset.density = knownDensity(state.settings?.density);
    root.dataset.pattern = knownPattern(state.settings?.pattern);
    // Affects the width of the last column.
    root.dataset.reorder = state.settings?.reorderMode === "buttons" ? "buttons" : "drag";
    // Unknown colours fall back to the neutral band.
    const band = state.settings?.bandColor;
    root.dataset.band = state.colors?.includes(band) ? band : "neutral";
    root.style.setProperty("--today-opacity",
      `${clampNumber(state.settings?.bandOpacity, 0, 100, 100)}%`);
    root.style.setProperty("--band-opacity",
      `${clampNumber(state.settings?.bandFillOpacity, 0, 100, 30)}%`);
    root.dataset.todayBand = state.settings?.showBand === false ? "off" : "on";

    // Custom properties, as the stylesheet computes with them.
    root.style.setProperty("--bg-dim", `${clampNumber(state.settings?.backgroundDim, 0, 100, 55)}%`);
    root.style.setProperty("--bg-blur", blurLength(clampNumber(state.settings?.backgroundBlur, 0, 100, 0)));
    root.style.setProperty("--surface-opacity",
      `${clampNumber(state.settings?.surfaceOpacity, 20, 100, 88)}%`);
    root.style.setProperty("--surface-blur",
      blurLength(clampNumber(state.settings?.surfaceBlur, 0, 100, 30)));
  };
  subscribe(apply);
  apply();
}

// Colours of the system bars, matching --bg in base.css and index.html.
const THEME_COLORS = { light: "#e6e8ec", dark: "#0f0f0f" };

/**
 * Sets the theme-color entries in <head>. A chosen theme gives both entries
 * its colour; "system" gives each entry the colour of its colour scheme.
 */
function applyThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[theme === "system" ? scheme : theme];
  }
}

// ---------- keyboard ----------

function initShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const inField = event.target.closest?.("input, textarea, select");
    const inDialog = event.target.closest?.("dialog");
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === "z" && !inField) {
      event.preventDefault();
      if (event.shiftKey) redoLast();
      else undoLast();
    } else if (mod && key === "y" && !inField) {
      event.preventDefault();
      redoLast();
    } else if (key === "n" && !mod && !inField && !inDialog) {
      event.preventDefault();
      actions.createHabit();
    } else if (((key === "/" && !mod) || (mod && key === "k")) && !inField && !inDialog) {
      event.preventDefault();
      openSearch();
    } else if (event.key === "Escape" && !inDialog && currentHabitId()) {
      goHome();
    }
  });
}

main();
