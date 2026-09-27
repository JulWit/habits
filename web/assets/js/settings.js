// Settings pages. Every change is saved immediately: the state is updated
// first and restored if the server rejects the change.

import { api } from "./api.js";
import { state, replaceState, subscribe } from "./state.js";
import { icons, colorLabel } from "./icons.js";
import { errorText, toast } from "./undo.js";
import { t, locale, userTimeZone } from "./i18n.js";
import { openPage, topPage } from "./pages.js";
import { factItem } from "./panels.js";

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
let archiveItem;
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
  themeInputs = [...document.querySelectorAll('input[name="settings-theme"]')];
  fontSelect = document.getElementById("settings-font");
  densityInputs = [...document.querySelectorAll('input[name="settings-density"]')];
  patternSelect = document.getElementById("settings-pattern");
  bandChoices = document.getElementById("band-choices");
  bandOpacity = document.getElementById("band-opacity");
  bandOpacityOut = document.getElementById("band-opacity-out");
  bandFillOpacity = document.getElementById("band-fill-opacity");
  bandFillOpacityOut = document.getElementById("band-fill-opacity-out");
  showBandInput = document.getElementById("settings-show-band");
  reorderInputs = [...document.querySelectorAll('input[name="settings-reorder"]')];
  reorderHint = document.getElementById("settings-reorder-hint");
  dayInputs = [...document.querySelectorAll('input[name="settings-days"]')];
  daysHint = document.getElementById("settings-days-hint");
  archivedInput = document.getElementById("settings-archived");
  alignInput = document.getElementById("settings-align-weeks");
  alignHint = document.getElementById("settings-align-hint");
  archiveItem = document.getElementById("settings-archive-item");
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
    openPage(dialog);
  });

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
  // The sliders preview their value while they move and save it on release.
  bindSlider(bandOpacity, bandOpacityOut, "bandOpacity", "--today-opacity");
  bindSlider(bandFillOpacity, bandFillOpacityOut, "bandFillOpacity", "--band-opacity");
  bindSlider(bgDim, bgDimOut, "backgroundDim", "--bg-dim");
  bindSlider(bgBlur, bgBlurOut, "backgroundBlur", "--bg-blur", blurLength);
  bindSlider(surfaceOpacity, surfaceOpacityOut, "surfaceOpacity", "--surface-opacity");
  bindSlider(surfaceBlur, surfaceBlurOut, "surfaceBlur", "--surface-blur", blurLength);
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
  // Before the state is loaded, there is nothing to show.
  if (!dialog || !state.user) return;
  const settings = state.settings;

  for (const input of themeInputs) input.checked = input.value === settings.theme;
  fontSelect.value = settings.font;
  for (const input of densityInputs) input.checked = input.value === settings.density;
  patternSelect.value = settings.pattern;
  paintBandChoices(settings.bandColor);
  bandOpacity.value = String(settings.bandOpacity);
  showKnob(bandOpacityOut, bandOpacity.value, "%");
  showBandInput.checked = settings.showBand;
  bandFillOpacity.value = String(settings.bandFillOpacity);
  showKnob(bandFillOpacityOut, bandFillOpacity.value, "%");
  // The slider is only shown while the band is on.
  bandFillOpacity.closest(".slider").hidden = !settings.showBand;
  for (const input of reorderInputs) input.checked = input.value === settings.reorderMode;
  reorderHint.textContent = settings.reorderMode === "drag"
    ? t("Categories and habits are moved by their handle.")
    : t("Categories and habits are moved with arrows — by keyboard too.");

  const days = settings.overviewDays;
  const shown = effectiveDays();
  for (const input of dayInputs) input.checked = Number(input.value) === days;
  if (days === 0) {
    daysHint.textContent = t("As many days are shown as fit in the window — currently {n}.", { n: shown });
  } else if (shown < days) {
    daysHint.textContent = t("Only {n} days fit in the window right now. In a wider window it will be {days}.",
      { n: shown, days });
  } else {
    daysHint.textContent = t("{n} days are shown right now.", { n: shown });
  }

  alignInput.checked = settings.alignWeeks;
  if (!settings.alignWeeks) {
    alignHint.textContent = t("The overview ends on today.");
  } else if (shown < 7) {
    // Week alignment requires at least seven columns.
    alignHint.textContent = t("Possible from 7 columns on — {n} fit right now.", { n: shown });
  } else {
    alignHint.textContent = t("The overview shows whole calendar weeks, including the remaining days of this week.");
  }

  paintBackground();
  paintRegion();
  paintAccount();
  paintVersion();

  const archived = state.archivedCount;
  archivedInput.checked = settings.showArchived;
  // Hidden if there are no archived habits and the switch is off.
  archiveItem.hidden = archived === 0 && !settings.showArchived;
  archiveHint.textContent = archived === 1
    ? t("1 habit is archived.")
    : t("{n} habits are archived.", { n: archived });
}

// ---------- account ----------

/** Fills the card of the signed-in user from state.user. */
function paintAccount() {
  const user = state.user;
  // Without a display name (e.g. single-user mode), the ID stands in.
  const name = user.name || user.id || t("Unknown");
  // The ID is only worth a line if the name does not show it already.
  const detail = user.email || (user.id !== name ? user.id : "");
  const groups = user.groups ?? [];

  document.getElementById("account-avatar").textContent = initials(name);
  document.getElementById("account-name").textContent = name;
  const detailEl = document.getElementById("account-detail");
  detailEl.textContent = detail;
  detailEl.hidden = !detail;
  const groupsEl = document.getElementById("account-groups");
  groupsEl.textContent = t("Groups: {list}", { list: groups.join(", ") });
  groupsEl.hidden = groups.length === 0;
}

/** Up to two initials: first and last word, or the first letter alone. */
function initials(name) {
  const words = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1);
  return letters.map((w) => [...w][0].toUpperCase()).join("");
}

// ---------- version ----------

/** Fills the version page and the version row's hint from state.build. */
function paintVersion() {
  const build = state.build;
  const version = build.version || t("Development build");
  // Twelve characters identify a commit well enough.
  const revision = build.revision
    ? build.revision.slice(0, 12) + (build.modified ? ` (${t("modified")})` : "")
    : t("Unknown");

  document.getElementById("settings-version-hint").textContent = version;

  const facts = [
    [t("Version"), version],
    [t("Commit"), revision],
    [t("Built"), formatBuildTime(build.time)],
    [t("Go version"), build.goVersion || t("Unknown")],
  ];
  document.getElementById("version-facts")
    .replaceChildren(...facts.map(([label, value]) => factItem(label, value)));
}

/** Formats the RFC 3339 build time in the user's language, or "Unknown". */
function formatBuildTime(time) {
  const date = time ? new Date(time) : null;
  if (!date || Number.isNaN(date.getTime())) return t("Unknown");
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
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
  languageSelect.value = state.settings.language;

  buildTimeZoneOptions();
  const server = state.serverTimeZone;
  // "Local" is a server zone without a name.
  timeZoneSelect.options[0].textContent = server && server !== "Local"
    ? t("Server default ({zone})", { zone: server })
    : t("Server default");

  const chosen = state.settings.timeZone;
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

/** Band colour for a grey today band, as store.NeutralBand. */
const NEUTRAL_BAND = "neutral";

/** Builds the band colour choices: neutral, followed by the habit palette. */
function paintBandChoices(chosen) {
  const wanted = [NEUTRAL_BAND, ...state.colors];
  if (bandChoices.childElementCount !== wanted.length) {
    bandChoices.replaceChildren(...wanted.map((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = color;
      b.setAttribute("role", "radio");
      if (color === NEUTRAL_BAND) {
        b.style.setProperty("--swatch", "var(--today-neutral)");
        b.setAttribute("aria-label", t("Neutral"));
        b.title = t("Neutral");
      } else {
        b.style.setProperty("--swatch", color);
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
    errorBox.hidden = true;
    return true;
  } catch (err) {
    replaceState({ settings: before });
    report(errorText(err));
    return false;
  }
}

/** Updates the background section: preview, buttons and sliders. */
function paintBackground() {
  const version = state.backgroundVersion;
  const has = version !== "";

  patternImageOption.disabled = !has;
  bgRemove.hidden = !has;
  bgKnobs.hidden = !has;
  // The version in the URL bypasses the browser cache after an upload.
  bgPreview.style.backgroundImage = has ? `url("/api/background?v=${version}")` : "";
  bgPreview.classList.toggle("is-empty", !has);

  bgDim.value = String(state.settings.backgroundDim);
  bgBlur.value = String(state.settings.backgroundBlur);
  surfaceOpacity.value = String(state.settings.surfaceOpacity);
  surfaceBlur.value = String(state.settings.surfaceBlur);
  showKnob(bgDimOut, bgDim.value, "%");
  showKnob(bgBlurOut, bgBlur.value, "%");
  showKnob(surfaceOpacityOut, surfaceOpacity.value, "%");
  showKnob(surfaceBlurOut, surfaceBlur.value, "%");
}

function showKnob(out, value, unit) {
  out.textContent = `${value}${unit}`;
}

/**
 * Wires a percent slider: while it moves, it shows its value in `out` and
 * previews it through the custom property `cssVar`; on release, it saves the
 * value as the setting `key`. `toCss` converts the percentage for the
 * property.
 */
function bindSlider(slider, out, key, cssVar, toCss = (percent) => `${percent}%`) {
  slider.addEventListener("input", () => {
    showKnob(out, slider.value, "%");
    document.documentElement.style.setProperty(cssVar, toCss(slider.value));
  });
  slider.addEventListener("change", () => saveSetting({ [key]: Number(slider.value) }));
}

/**
 * Converts a blur percentage to a CSS length, using state.blurAtFull from the
 * server.
 */
export function blurLength(percent) {
  return `${(Number(percent) * state.blurAtFull) / 100}px`;
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
    errorBox.hidden = true;
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
    errorBox.hidden = true;
  } catch (err) {
    report(errorText(err));
  }
}

/** Shows an error in the open settings page, since pages cover the toasts. */
function report(message) {
  const page = topPage();
  if (page?.id.startsWith("settings-")) {
    page.querySelector(".page-body").append(errorBox);
    errorBox.textContent = message;
    errorBox.hidden = false;
    return;
  }
  toast(message, { error: true });
}
