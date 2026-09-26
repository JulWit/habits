// The settings dialog.
//
// Every control writes through to the server immediately — there is no Save
// button, because each setting is independent and a half-applied dialog is
// worse than an instantly applied one. The state is updated first so the board
// reacts at once; a rejected write rolls the change back.

import { api } from "./api.js";
import { state, replaceState, subscribe } from "./state.js";
import { icons } from "./icons.js";
import { errorText, toast } from "./undo.js";

let dialog;
let themeInputs;
let fontSelect;
let densityInputs;
let patternSelect;
let bandChoices;
let bandOpacity;
let bandOpacityOut;
let bandFillOpacity;
let bandFillOpacityOut;
let showBandInput;
let reorderInputs;
let reorderHint;
let dayInputs;
let daysHint;
let archivedInput;
let alignInput;
let alignHint;
let archiveField;
let archiveHint;
let errorBox;
let bgFile;
let bgRemove;
let bgPreview;
let bgKnobs;
let bgDim;
let bgBlur;
let bgDimOut;
let bgBlurOut;
let surfaceOpacity;
let surfaceBlur;
let surfaceOpacityOut;
let surfaceBlurOut;
let patternImageOption;

/** Set by app.js: reports how many day columns the board is really drawing. */
let effectiveDays = () => 0;
/** Set by app.js: reloads the state from the server. */
let reload = async () => {};

export function initSettings(handlers = {}) {
  if (handlers.effectiveDays) effectiveDays = handlers.effectiveDays;
  if (handlers.reload) reload = handlers.reload;

  dialog = document.getElementById("settings-dialog");
  themeInputs = [...dialog.querySelectorAll('input[name="settings-theme"]')];
  fontSelect = document.getElementById("settings-font");
  densityInputs = [...dialog.querySelectorAll('input[name="settings-density"]')];
  patternSelect = document.getElementById("settings-pattern");
  bandChoices = document.getElementById("band-choices");
  bandOpacity = document.getElementById("band-opacity");
  bandOpacityOut = document.getElementById("band-opacity-out");
  bandFillOpacity = document.getElementById("band-fill-opacity");
  bandFillOpacityOut = document.getElementById("band-fill-opacity-out");
  showBandInput = document.getElementById("settings-show-band");
  reorderInputs = [...dialog.querySelectorAll('input[name="settings-reorder"]')];
  reorderHint = document.getElementById("settings-reorder-hint");
  dayInputs = [...dialog.querySelectorAll('input[name="settings-days"]')];
  daysHint = document.getElementById("settings-days-hint");
  archivedInput = document.getElementById("settings-archived");
  alignInput = document.getElementById("settings-align-weeks");
  alignHint = document.getElementById("settings-align-hint");
  archiveField = document.getElementById("settings-archive-field");
  archiveHint = document.getElementById("settings-archive-hint");
  errorBox = document.getElementById("settings-error");
  bgFile = document.getElementById("bg-file");
  bgRemove = document.getElementById("bg-remove");
  bgPreview = document.getElementById("bg-preview");
  bgKnobs = document.getElementById("bg-knobs");
  bgDim = document.getElementById("bg-dim");
  bgBlur = document.getElementById("bg-blur");
  bgDimOut = document.getElementById("bg-dim-out");
  bgBlurOut = document.getElementById("bg-blur-out");
  surfaceOpacity = document.getElementById("surface-opacity");
  surfaceBlur = document.getElementById("surface-blur");
  surfaceOpacityOut = document.getElementById("surface-opacity-out");
  surfaceBlurOut = document.getElementById("surface-blur-out");
  patternImageOption = document.getElementById("pattern-image-option");

  const openButton = document.getElementById("open-settings");
  openButton.innerHTML = icons.gear;
  openButton.addEventListener("click", () => {
    errorBox.hidden = true;
    paint();
    dialog.showModal();
  });

  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.close());
  initTabs();

  for (const input of themeInputs) {
    input.addEventListener("change", () => saveSetting({ theme: input.value }));
  }
  fontSelect.addEventListener("change", () => saveSetting({ font: fontSelect.value }));
  for (const input of densityInputs) {
    input.addEventListener("change", () => saveSetting({ density: input.value }));
  }
  patternSelect.addEventListener("change", () => saveSetting({ pattern: patternSelect.value }));
  bandChoices.addEventListener("click", (event) => {
    const swatch = event.target.closest(".swatch");
    if (swatch) saveSetting({ bandColor: swatch.dataset.color });
  });
  bandOpacity.addEventListener("input", () => {
    showKnob(bandOpacityOut, bandOpacity.value, "%");
    document.documentElement.style.setProperty("--today-opacity", `${bandOpacity.value}%`);
  });
  bandOpacity.addEventListener("change",
    () => saveSetting({ bandOpacity: Number(bandOpacity.value) }));
  bandFillOpacity.addEventListener("input", () => {
    showKnob(bandFillOpacityOut, bandFillOpacity.value, "%");
    document.documentElement.style.setProperty("--band-opacity", `${bandFillOpacity.value}%`);
  });
  bandFillOpacity.addEventListener("change",
    () => saveSetting({ bandFillOpacity: Number(bandFillOpacity.value) }));
  showBandInput.addEventListener("change", () => saveSetting({ showBand: showBandInput.checked }));

  alignInput.addEventListener("change", () => saveSetting({ alignWeeks: alignInput.checked }));
  for (const input of reorderInputs) {
    input.addEventListener("change", () => saveSetting({ reorderMode: input.value }));
  }
  for (const input of dayInputs) {
    input.addEventListener("change", () => saveSetting({ overviewDays: Number(input.value) }));
  }
  bgFile.addEventListener("change", () => {
    const file = bgFile.files?.[0];
    // The picker is emptied straight away, so choosing the same file twice in a
    // row still counts as a change.
    bgFile.value = "";
    if (file) uploadBackground(file);
  });
  bgRemove.addEventListener("click", removeBackground);

  // Both knobs write while the slider is still moving, which is the only way to
  // judge a veil: the page behind the dialog changes under the thumb. The
  // request is what waits - "input" would send one per pixel.
  bgDim.addEventListener("input", () => {
    showKnob(bgDimOut, bgDim.value, "%");
    document.documentElement.style.setProperty("--bg-dim", `${bgDim.value}%`);
  });
  bgBlur.addEventListener("input", () => {
    showKnob(bgBlurOut, bgBlur.value, "%");
    document.documentElement.style.setProperty("--bg-blur", blurLength(bgBlur.value));
  });
  bgDim.addEventListener("change", () => saveSetting({ backgroundDim: Number(bgDim.value) }));
  bgBlur.addEventListener("change", () => saveSetting({ backgroundBlur: Number(bgBlur.value) }));

  surfaceOpacity.addEventListener("input", () => {
    showKnob(surfaceOpacityOut, surfaceOpacity.value, "%");
    document.documentElement.style.setProperty("--surface-opacity", `${surfaceOpacity.value}%`);
  });
  surfaceBlur.addEventListener("input", () => {
    showKnob(surfaceBlurOut, surfaceBlur.value, "%");
    document.documentElement.style.setProperty("--surface-blur", blurLength(surfaceBlur.value));
  });
  surfaceOpacity.addEventListener("change",
    () => saveSetting({ surfaceOpacity: Number(surfaceOpacity.value) }));
  surfaceBlur.addEventListener("change",
    () => saveSetting({ surfaceBlur: Number(surfaceBlur.value) }));

  archivedInput.addEventListener("change", async () => {
    await saveSetting({ showArchived: archivedInput.checked });
    // Unlike the theme and the day count, this one changes *which* habits the
    // server sends, not merely how they are drawn, so the list is fetched again.
    await reload();
  });

  // The hint names the number actually on screen, which can be lower than the
  // chosen one on a narrow window.
  subscribe(paint);
}

function paint() {
  if (!dialog) return;
  const theme = state.settings?.theme ?? "system";
  const font = state.settings?.font ?? "inter";
  const density = state.settings?.density ?? "standard";
  const pattern = state.settings?.pattern ?? "none";
  const days = state.settings?.overviewDays ?? 0;
  const reorder = state.settings?.reorderMode ?? "drag";

  for (const input of themeInputs) input.checked = input.value === theme;
  fontSelect.value = font;
  for (const input of densityInputs) input.checked = input.value === density;
  patternSelect.value = pattern;
  paintBandChoices(state.settings?.bandColor ?? NEUTRAL_BAND);
  bandOpacity.value = String(state.settings?.bandOpacity ?? 100);
  showKnob(bandOpacityOut, bandOpacity.value, "%");
  showBandInput.checked = state.settings?.showBand ?? true;
  bandFillOpacity.value = String(state.settings?.bandFillOpacity ?? 30);
  showKnob(bandFillOpacityOut, bandFillOpacity.value, "%");
  // Without a band there is nothing for its slider to change, so it only shows
  // once the band is switched on.
  bandFillOpacity.closest(".slider").hidden = !showBandInput.checked;
  for (const input of reorderInputs) input.checked = input.value === reorder;
  reorderHint.textContent = reorder === "drag"
    ? "Categories and habits are moved by their handle."
    : "Categories and habits are moved with arrows — by keyboard too.";
  for (const input of dayInputs) input.checked = Number(input.value) === days;

  const shown = effectiveDays();
  daysHint.textContent = days === 0
    ? `As many days are shown as fit in the window — currently ${shown}.`
    : shown < days
      ? `Only ${shown} days fit in the window right now. In a wider window it will be ${days}.`
      : `${shown} days are shown right now.`;

  const aligned = state.settings?.alignWeeks ?? false;
  alignInput.checked = aligned;
  // Below a week of columns there is no Monday-aligned window that is sure to
  // contain today, so the board ignores the switch rather than paging away from
  // the current day. Said plainly instead of letting it look broken.
  alignHint.textContent = !aligned
    ? "The overview ends on today."
    : shown < 7
      ? `Possible from 7 columns on — ${shown} fit right now.`
      : "The overview shows whole calendar weeks, including the remaining days of this week.";

  paintBackground();

  const archived = state.archivedCount ?? 0;
  const on = state.settings?.showArchived ?? false;
  archivedInput.checked = on;
  // Nothing archived and the switch off: the whole section would be a control
  // that can never change anything. It stays while it is on, so there is always
  // a way back out.
  archiveField.hidden = archived === 0 && !on;
  // A tab whose only section is hidden would open on nothing.
  const archiveTab = document.getElementById("tab-archive");
  archiveTab.hidden = archiveField.hidden;
  if (archiveField.hidden && openTab === "tab-archive") showTab("tab-look");
  archiveHint.textContent = archived === 1
    ? "1 habit is archived."
    : `${archived} habits are archived.`;
}

/**
 * The tab strip at the top of the dialog.
 *
 * Which tab is open is remembered for as long as the page lives, so closing the
 * dialog to look at the board and opening it again lands where one left off -
 * but a reload starts at the front again rather than in a corner one has long
 * forgotten about.
 */
let openTab = "tab-look";

function initTabs() {
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];

  const show = (id) => {
    openTab = id;
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute("aria-selected", String(selected));
      // Only the open tab is in the tab order; the others are reached with the
      // arrow keys, which is how a tab strip is expected to behave.
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    }
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => show(tab.id));
    tab.addEventListener("keydown", (event) => {
      // Down and up for the list beside the settings, right and left for the
      // strip it folds into on a phone; both work in either layout.
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      show(next.id);
      next.focus();
    });
  }

  showTab = show;
  show(openTab);
}

/** Set by initTabs; paint() uses it to reopen the last tab. */
let showTab = () => {};

/** The value that leaves the today column grey, mirroring store.NeutralBand. */
const NEUTRAL_BAND = "neutral";

/**
 * The colours the today band may take: the habit palette, muted by the
 * stylesheet, with the plain grey in front of it.
 *
 * Built from the colours the server sent rather than from a list of its own, so
 * the board can never offer a shade the habit editor does not.
 */
function paintBandChoices(chosen) {
  const wanted = [NEUTRAL_BAND, ...(state.colors ?? [])];
  if (bandChoices.childElementCount !== wanted.length) {
    bandChoices.replaceChildren(...wanted.map((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = color;
      b.setAttribute("role", "radio");
      if (color === NEUTRAL_BAND) {
        b.style.background = "var(--today-neutral)";
        b.setAttribute("aria-label", "Neutral");
        b.title = "Neutral";
      } else {
        b.style.background = color;
        b.setAttribute("aria-label", `Colour ${color}`);
      }
      return b;
    }));
  }
  for (const el of bandChoices.children) {
    el.setAttribute("aria-checked", String(el.dataset.color === chosen));
  }
}

/**
 * Writes one or more settings.
 *
 * Goes through replaceState rather than touching state.settings directly:
 * a direct write would change the value without notifying subscribers, and the
 * board would keep drawing the old one.
 */
async function saveSetting(patch) {
  const before = { ...state.settings };
  // Applied before the request so the board redraws without waiting on a round
  // trip; the server stays the authority and a rejection restores the old value.
  replaceState({ settings: { ...state.settings, ...patch } });
  try {
    replaceState({ settings: await api.saveSettings(patch) });
    if (errorBox) errorBox.hidden = true;
  } catch (err) {
    replaceState({ settings: before });
    report(errorText(err));
  }
}

/**
 * The background section: preview, buttons and the two knobs.
 *
 * Everything here hangs off one fact from the server - whether a picture exists
 * - which is why the version travels with the state rather than being asked for
 * separately.
 */
function paintBackground() {
  const version = state.backgroundVersion ?? "";
  const has = version !== "";

  patternImageOption.disabled = !has;
  bgRemove.hidden = !has;
  bgKnobs.hidden = !has;
  // The version in the URL is what makes a new upload show at once: without it
  // the browser answers from the entry the old picture left behind.
  bgPreview.style.backgroundImage = has ? `url("/api/background?v=${version}")` : "";
  bgPreview.classList.toggle("is-empty", !has);

  bgDim.value = String(state.settings?.backgroundDim ?? 55);
  bgBlur.value = String(state.settings?.backgroundBlur ?? 0);
  surfaceOpacity.value = String(state.settings?.surfaceOpacity ?? 88);
  surfaceBlur.value = String(state.settings?.surfaceBlur ?? 30);
  showKnob(bgDimOut, bgDim.value, "%");
  showKnob(bgBlurOut, bgBlur.value, "%");
  showKnob(surfaceOpacityOut, surfaceOpacity.value, "%");
  showKnob(surfaceBlurOut, surfaceBlur.value, "%");
}

function showKnob(out, value, unit) {
  out.textContent = `${value}${unit}`;
}

/**
 * The blur as a length.
 *
 * The setting is a percentage — "how much of the picture is left" is the same
 * kind of choice as the veil, and pixels would say nothing to whoever pulls the
 * slider. What a hundred percent comes to on screen is the server's number,
 * sent with the state; the shell already applied the same one before any script
 * ran. The fallback only covers the first paint of a cold load.
 */
export function blurLength(percent) {
  const atFull = state.blurAtFull ?? 40;
  return `${((Number(percent) || 0) * atFull) / 100}px`;
}

async function uploadBackground(file) {
  // A picture that is far too large is worth saying so about here rather than
  // after it has been carried across the network; everything else - the format,
  // the dimensions - the server decides, because only it sees the bytes.
  if (file.size > 12 * 1024 * 1024) {
    report("The image may be at most 12 MB.");
    return;
  }
  bgFile.disabled = true;
  try {
    const res = await api.uploadBackground(file);
    replaceState({ settings: res.settings, backgroundVersion: res.version });
    // The page is showing the old picture from its cache; the version forces
    // the new one without a reload.
    document.documentElement.style.setProperty(
      "--pattern-image", `url("/api/background?v=${res.version}")`);
    if (errorBox) errorBox.hidden = true;
  } catch (err) {
    report(errorText(err));
  } finally {
    bgFile.disabled = false;
  }
}

async function removeBackground() {
  try {
    const res = await api.deleteBackground();
    replaceState({ settings: res.settings, backgroundVersion: "" });
    document.documentElement.style.removeProperty("--pattern-image");
    if (errorBox) errorBox.hidden = true;
  } catch (err) {
    report(errorText(err));
  }
}

/**
 * A modal dialog renders in the browser's top layer, above the toasts, so a
 * failure while the dialog is open has to be shown inside it.
 */
function report(message) {
  if (dialog?.open) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    return;
  }
  toast(message, { error: true });
}
