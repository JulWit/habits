// Settings dialog. Every change is saved immediately: the state is updated
// first and restored if the server rejects the change.

import { api } from "./api.js";
import { state, replaceState, subscribe } from "./state.js";
import { icons, colorLabel } from "./icons.js";
import { errorText, toast } from "./undo.js";
import { t, locale, userTimeZone } from "./i18n.js";

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
let languageSelect;
let timeZoneSelect;
let timeZoneHint;
let timeZoneDevice;

/** Returns the number of day columns actually shown. Set by app.js. */
let effectiveDays = () => 0;
/** Reloads the state from the server. Set by app.js. */
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
  languageSelect = document.getElementById("settings-language");
  timeZoneSelect = document.getElementById("settings-timezone");
  timeZoneHint = document.getElementById("settings-timezone-hint");
  timeZoneDevice = document.getElementById("settings-timezone-device");

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
    // Reset, so selecting the same file again triggers a change.
    bgFile.value = "";
    if (file) uploadBackground(file);
  });
  bgRemove.addEventListener("click", removeBackground);

  // Save while the slider moves, for live preview of the background.
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

  languageSelect.addEventListener("change", async () => {
    // Reload the page to apply the new language, once the server has it.
    if (await saveSetting({ language: languageSelect.value })) location.reload();
  });
  timeZoneSelect.addEventListener("change", () => saveTimeZone(timeZoneSelect.value));
  timeZoneDevice.addEventListener("click", () => saveTimeZone(deviceTimeZone()));

  archivedInput.addEventListener("change", async () => {
    await saveSetting({ showArchived: archivedInput.checked });
    // This setting changes which habits the server sends.
    await reload();
  });

  // Update the hint with the number of columns actually shown.
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
  // The slider is only shown while the band is on.
  bandFillOpacity.closest(".slider").hidden = !showBandInput.checked;
  for (const input of reorderInputs) input.checked = input.value === reorder;
  reorderHint.textContent = reorder === "drag"
    ? t("Categories and habits are moved by their handle.")
    : t("Categories and habits are moved with arrows — by keyboard too.");
  for (const input of dayInputs) input.checked = Number(input.value) === days;

  const shown = effectiveDays();
  daysHint.textContent = days === 0
    ? t("As many days are shown as fit in the window — currently {n}.", { n: shown })
    : shown < days
      ? t("Only {n} days fit in the window right now. In a wider window it will be {days}.",
        { n: shown, days })
      : t("{n} days are shown right now.", { n: shown });

  const aligned = state.settings?.alignWeeks ?? false;
  alignInput.checked = aligned;
  // Week alignment requires at least seven columns.
  alignHint.textContent = !aligned
    ? t("The overview ends on today.")
    : shown < 7
      ? t("Possible from 7 columns on — {n} fit right now.", { n: shown })
      : t("The overview shows whole calendar weeks, including the remaining days of this week.");

  paintBackground();
  paintRegion();

  const archived = state.archivedCount ?? 0;
  const on = state.settings?.showArchived ?? false;
  archivedInput.checked = on;
  // Hidden if there are no archived habits and the switch is off.
  archiveField.hidden = archived === 0 && !on;
  // Hide the tab if its section is hidden.
  const archiveTab = document.getElementById("tab-archive");
  archiveTab.hidden = archiveField.hidden;
  if (archiveField.hidden && openTab === "tab-archive") showTab("tab-look");
  archiveHint.textContent = archived === 1
    ? t("1 habit is archived.")
    : t("{n} habits are archived.", { n: archived });
}

// ---------- region & language ----------

/** Returns the browser's time zone, or "". */
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * Returns all time zones known to the browser, or a short fallback list for
 * browsers without Intl.supportedValuesOf.
 */
function knownTimeZones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/Berlin", "Europe/London", "America/New_York"];
  }
}

/**
 * Builds the time zone list, grouped by region, with the server's time zone
 * first. Built once.
 */
function buildTimeZoneOptions() {
  if (timeZoneSelect.options.length > 0) return;
  const server = document.createElement("option");
  server.value = "";
  timeZoneSelect.append(server);

  const groups = new Map();
  for (const zone of knownTimeZones()) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : t("Other");
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(zone);
  }
  for (const [region, zones] of groups) {
    const group = document.createElement("optgroup");
    group.label = region;
    for (const zone of zones) {
      const option = document.createElement("option");
      option.value = zone;
      // Without the region prefix and underscores.
      option.textContent = zone.slice(zone.indexOf("/") + 1).replaceAll("_", " ").replaceAll("/", " / ");
      group.append(option);
    }
    timeZoneSelect.append(group);
  }
}

function paintRegion() {
  languageSelect.value = state.settings?.language ?? "system";

  buildTimeZoneOptions();
  const server = state.serverTimeZone ?? "";
  // "Local" is a server zone without a name.
  timeZoneSelect.options[0].textContent = server && server !== "Local"
    ? t("Server default ({zone})", { zone: server })
    : t("Server default");

  const chosen = state.settings?.timeZone ?? "";
  // Add the chosen zone if the browser does not list it.
  if (chosen && ![...timeZoneSelect.options].some((o) => o.value === chosen)) {
    const option = document.createElement("option");
    option.value = chosen;
    option.textContent = chosen;
    timeZoneSelect.append(option);
  }
  timeZoneSelect.value = chosen;

  timeZoneHint.textContent = timeZoneText();

  // Only offered if the device is in a different time zone.
  const device = deviceTimeZone();
  const inForce = chosen || server;
  timeZoneDevice.hidden = !device || device === inForce;
  timeZoneDevice.textContent = t("Use this device's time zone ({zone})", { zone: device });
}

/** Returns the time zone hint, including the current time there. */
function timeZoneText() {
  let now = "";
  try {
    now = new Date().toLocaleTimeString(locale,
      { hour: "2-digit", minute: "2-digit", timeZone: userTimeZone() });
  } catch {
    // Omit the time if the browser cannot format the zone.
  }
  const lead = t("Decides when a new day begins on the board.");
  return now ? `${lead} ${t("It is {time} there now.", { time: now })}` : lead;
}

/** Saves the time zone and reloads the state, as it changes "today". */
async function saveTimeZone(zone) {
  if (await saveSetting({ timeZone: zone })) await reload();
}

/** The open settings tab, kept until the page is reloaded. */
let openTab = "tab-look";

function initTabs() {
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];

  const show = (id) => {
    openTab = id;
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute("aria-selected", String(selected));
      // Only the selected tab is focusable; arrow keys switch tabs.
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    }
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => show(tab.id));
    tab.addEventListener("keydown", (event) => {
      // Both arrow directions work in both layouts.
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

/** Opens a tab. Set by initTabs. */
let showTab = () => {};

/** Band colour for a grey today band, as store.NeutralBand. */
const NEUTRAL_BAND = "neutral";

/** Builds the band colour choices: neutral, followed by the habit palette. */
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
        b.setAttribute("aria-label", t("Neutral"));
        b.title = t("Neutral");
      } else {
        b.style.background = color;
        b.setAttribute("aria-label", t("Colour {color}", { color: colorLabel(color) }));
        b.title = colorLabel(color);
      }
      return b;
    }));
  }
  for (const el of bandChoices.children) {
    el.setAttribute("aria-checked", String(el.dataset.color === chosen));
  }
}

/**
 * Saves settings. The state is updated immediately via replaceState and
 * restored if the server rejects the change. Resolves to whether the change
 * was saved.
 */
async function saveSetting(patch) {
  const before = { ...state.settings };
  // Apply immediately; restored on failure.
  replaceState({ settings: { ...state.settings, ...patch } });
  try {
    replaceState({ settings: await api.saveSettings(patch) });
    if (errorBox) errorBox.hidden = true;
    return true;
  } catch (err) {
    replaceState({ settings: before });
    report(errorText(err));
    return false;
  }
}

/** Updates the background section: preview, buttons and sliders. */
function paintBackground() {
  const version = state.backgroundVersion ?? "";
  const has = version !== "";

  patternImageOption.disabled = !has;
  bgRemove.hidden = !has;
  bgKnobs.hidden = !has;
  // The version in the URL bypasses the browser cache after an upload.
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
 * Converts a blur percentage to a CSS length, using state.blurAtFull from the
 * server.
 */
export function blurLength(percent) {
  const atFull = state.blurAtFull ?? 40;
  return `${((Number(percent) || 0) * atFull) / 100}px`;
}

async function uploadBackground(file) {
  // Check the size before uploading; the server checks everything else.
  if (file.size > 12 * 1024 * 1024) {
    report(t("The image may be at most 12 MB."));
    return;
  }
  bgFile.disabled = true;
  try {
    const res = await api.uploadBackground(file);
    replaceState({ settings: res.settings, backgroundVersion: res.version });
    // The new version bypasses the cached image.
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

/** Shows an error inside the dialog, since modal dialogs cover the toasts. */
function report(message) {
  if (dialog?.open) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    return;
  }
  toast(message, { error: true });
}
