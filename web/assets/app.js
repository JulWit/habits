// Bootstrap: loads the state, wires the views and owns routing, theme and
// keyboard shortcuts. Data mutations live in actions.js.

import { api } from "./api.js";
import { state, replaceState, habitById, upsertHabit, subscribe } from "./state.js";
import { setChangeHandler, toast, errorText, undoLast, redoLast } from "./undo.js";
import { initOverview, render as renderOverview, currentDays } from "./overview.js";
import { initDetail, renderDetail } from "./detail.js";
import { initCategory, renderCategory } from "./category.js";
import { initEditor } from "./editor.js";
import { initCategoryPicker } from "./categorypicker.js";
import { initSettings, blurLength } from "./settings.js";
import { initValueDialog } from "./value.js";
import * as actions from "./actions.js";
import { paintIcons } from "./icons.js";

// Three choices: the two explicit ones and "system", which hands the decision
// to the device. The stylesheet turns each into a color-scheme.
const THEME_LABEL = { system: "System", light: "Hell", dark: "Dunkel" };
const DEFAULT_THEME = "system";

/** Falls back to the default for anything the client does not know. */
function knownTheme(theme) {
  return THEME_LABEL[theme] ? theme : DEFAULT_THEME;
}

/**
 * The keys the stylesheet has a rule for, mirroring store.Fonts on the server.
 *
 * A key the client does not know would leave --font unset and the page in the
 * browser's own font, so anything unfamiliar falls back to the default.
 */
const FONTS = ["system", "inter", "roboto", "geist", "opensans", "montserrat", "poppins", "lato"];
const DEFAULT_FONT = "inter";

function knownFont(font) {
  return FONTS.includes(font) ? font : DEFAULT_FONT;
}

/** The background textures the stylesheet draws, mirroring store.Patterns. */
const PATTERNS = ["none", "dots", "grid", "diagonal", "cross", "image"];
const DEFAULT_PATTERN = "none";

function knownPattern(pattern) {
  return PATTERNS.includes(pattern) ? pattern : DEFAULT_PATTERN;
}

/** A number the server sent, kept inside the range the stylesheet expects. */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Whether the board is in reordering mode.
 *
 * Deliberately not a stored setting: it is a mode one enters to move something
 * and leaves again, like a text cursor - carrying it across reloads or to
 * another device would only mean finding handles one did not ask for.
 */
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
  renameCategory: actions.renameCategory,
  moveCategory: actions.moveCategory,
  setCategoryOrder: actions.setCategoryOrder,
  moveHabit: actions.moveHabit,
  setHabitOrder: actions.setHabitOrder,
  deleteCategory: actions.deleteCategory,
};

function initEditMode() {
  // In the settings, beside the choice of how things are moved: the mode and
  // that choice are one subject, and the title bar has four controls competing
  // for a bar that is only as wide as the board. Still owned here rather than
  // by settings.js, because nothing about it is written to the server.
  const input = document.getElementById("settings-edit");
  const apply = () => {
    document.documentElement.dataset.edit = editing ? "on" : "off";
    input.checked = editing;
    // The day columns follow the width the handles leave behind, so the board
    // has to be measured again.
    renderOverview();
  };
  input.addEventListener("change", () => {
    editing = input.checked;
    apply();
  });
  apply();
}

/**
 * Whether the page is scrolled, on the root element.
 *
 * One thing depends on it: over an uploaded background the day header stays
 * invisible until something is actually sliding underneath it. A scroll
 * listener rather than a scroll-driven animation, because it is a switch, not
 * a curve - and passive, so it never holds up the scroll itself.
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

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * Failure is not worth reporting: the page works without it, and a browser that
 * refuses - an insecure origin, a private window - is not something the person
 * at the keyboard can act on.
 */
function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

async function main() {
  // Before the views wire themselves up, so every declared icon is in place.
  paintIcons();
  initCategoryPicker({ createCategory: actions.createCategory });
  initEditor();
  initValueDialog();
  initOverview(handlers);
  initDetail(handlers);
  initCategory(handlers);
  initAppearance();
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
  // pushState navigation (the back arrow, and the browser's own Back button)
  // reports through popstate rather than hashchange.
  window.addEventListener("popstate", syncRoute);

  await refresh();
}

/**
 * The earliest day the board has asked for, or null for the default window.
 *
 * Remembered rather than passed in once: every later refresh — an edit, an undo
 * — has to keep the window the user paged to, or the days they are looking at
 * would come back empty.
 */
let historyFrom = null;

async function refresh() {
  try {
    replaceState(await api.loadState(historyFrom));
    // The fresh state carries windowed entries again, so anything pulled in
    // full before has just been replaced by a partial history.
    fullHistoryLoaded.clear();
  } catch (err) {
    toast(errorText(err), { error: true, timeout: 12000 });
  }
}

/**
 * Widen the loaded history so the board can show `from`.
 *
 * ISO dates compare correctly as strings, so no parsing is needed to decide
 * whether the window already reaches far enough.
 */
async function extendHistory(from) {
  if (historyFrom !== null && from >= historyFrom) return;
  historyFrom = from;
  await refresh();
}

/**
 * Habits whose complete history has been merged into the cache.
 *
 * /api/state ships only the last few months of entries — enough for the board,
 * and small enough to send on every load. The detail view draws a whole
 * calendar year, so it pulls the rest from /api/habits/{id} once per habit and
 * merges it in. The set is what stops the merge from re-triggering itself
 * through the state subscription.
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

/**
 * Loads the styleguide the first time it is opened.
 *
 * A dynamic import, because nobody reaching the overview should pay for a page
 * that exists for whoever is building the next module. Rendered once: it has no
 * state of its own and nothing in it reacts to the store.
 */
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
 * Return to the overview.
 *
 * The fragment is dropped with pushState rather than by assigning
 * `location.hash = ""`, which leaves a bare "#" behind and does not reliably
 * fire hashchange. syncRoute is then called directly, so the view never depends
 * on an event that may not arrive.
 */
function goHome() {
  if (location.hash) history.pushState(null, "", location.pathname + location.search);
  syncRoute();
}

function syncRoute() {
  // The styleguide is not part of the app's navigation and needs no data, so it
  // is handled before anything looks at habits.
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

  // A category screen of its own: same shape as the habit screen, different
  // question - not how one habit is going, but whether the group holds.
  const categoryId = currentCategoryId();
  const category = categoryId
    ? state.categories.find((c) => c.id === categoryId)
    : null;
  if (categoryId && !category) {
    // Deleted, here or on another device: fall back rather than showing a
    // screen about nothing.
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (category) {
    document.documentElement.classList.add("route-detail");
    overviewView.hidden = true;
    detailView.hidden = true;
    categoryView.hidden = false;
    renderCategory(category);
    // The perfect-day count runs over the year, which the board alone does not
    // carry: the window is widened once, and the screen redrawn when it lands.
    extendHistory(`${state.today.slice(0, 4)}-01-01`);
    return;
  }
  categoryView.hidden = true;

  const id = currentHabitId();
  const habit = id ? habitById(id) : null;

  if (!habit) {
    // A hash pointing at a habit that no longer exists (deleted elsewhere, or
    // archived out of the list) falls back to the overview.
    if (id && state.habits.length > 0) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    document.documentElement.classList.remove("route-detail");
    overviewView.hidden = false;
    detailView.hidden = true;
    // The grid could not measure itself while it was hidden, so it is drawn
    // now that it has a width again.
    renderOverview();
    return;
  }
  // The header only tracks the board width on the overview; the detail view has
  // no day columns to match.
  document.documentElement.classList.add("route-detail");
  overviewView.hidden = true;
  detailView.hidden = false;
  renderDetail(habit);
  // Drawn at once from the cache, then redrawn when the full year arrives.
  ensureFullHistory(habit.id);
}

// ---------- theme ----------

/**
 * Applies the stored theme to the document.
 *
 * Choosing it lives in the settings dialog; this only reflects the choice, and
 * does so through the state subscription so it follows any write.
 */
/**
 * Keeps the two appearance choices on <html>, where the stylesheet reads them.
 *
 * The server already wrote both into the shell, so this changes nothing on a
 * cold load; it is what makes a choice in the settings dialog take effect
 * without a reload.
 */
function initAppearance() {
  const apply = () => {
    const root = document.documentElement;
    root.dataset.theme = knownTheme(state.settings?.theme);
    root.dataset.font = knownFont(state.settings?.font);
    root.dataset.pattern = knownPattern(state.settings?.pattern);
    // The width of the board's last column depends on it: one handle or two
    // arrows.
    root.dataset.reorder = state.settings?.reorderMode === "buttons" ? "buttons" : "drag";
    // The palette comes from the server, so anything else - an old value, a
    // colour since dropped - falls back to the neutral band.
    const band = state.settings?.bandColor;
    root.dataset.band = state.colors?.includes(band) ? band : "neutral";
    root.style.setProperty("--today-opacity",
      `${clampNumber(state.settings?.bandOpacity, 0, 100, 100)}%`);

    // The two knobs of the uploaded background. Written as custom properties
    // rather than data attributes, because the stylesheet has to compute with
    // them - a percentage and a length, not a selector.
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
    } else if (event.key === "Escape" && !inDialog && currentHabitId()) {
      goHome();
    }
  });
}

main();
