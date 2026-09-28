// Building blocks shared by the habit and category views: a row of stat tiles,
// the label of the completion rate, a panel listing labelled facts, and the
// facts of when something was created and changed.

import { daysBetween, formatLong, localISO } from "./dates.js";
import { state } from "./state.js";
import { t, locale, userTimeZone } from "./i18n.js";
import { icons } from "./icons.js";

/**
 * Labels the completion rate with the window it covers, which the server
 * takes from the rateWindow setting.
 */
export function rateLabel() {
  const days = state.settings.rateWindow;
  return days === "all" ? t("Rate (all time)") : t("Rate ({n} days)", { n: days });
}

/**
 * Builds a row of stat tiles from [label, value, icon] triples; icon names
 * one of `icons`, shown in the tile's corner.
 */
export function statRow(stats) {
  const row = document.createElement("div");
  row.className = "stat-row";
  for (const [label, value, icon] of stats) {
    const tile = document.createElement("div");
    tile.className = "stat";
    // The icon's markup is constant (icons.js).
    tile.innerHTML =
      `<div class="value"></div><span class="stat-icon" aria-hidden="true">${icons[icon]}</span>` +
      `<div class="label"></div>`;
    tile.querySelector(".value").textContent = value;
    tile.querySelector(".label").textContent = label;
    row.append(tile);
  }
  return row;
}

/**
 * Builds a panel with a heading and a list of facts, each built by
 * factItem.
 */
export function factsPanel(title, items, className = "details") {
  const panel = document.createElement("section");
  panel.className = `panel ${className}`;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const list = document.createElement("dl");
  list.className = "activity-list";
  list.append(...items);

  panel.append(heading, list);
  return panel;
}

/** Builds a labelled fact, with an optional note after the value. */
export function factItem(label, value, note = "") {
  const item = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  if (note) {
    const small = document.createElement("span");
    small.className = "note";
    small.textContent = note;
    dd.append(small);
  }
  item.append(dt, dd);
  return item;
}

/** Builds the fact of when a habit or category was created (its createdAt). */
export function createdItem(stamp) {
  const day = localISO(stamp);
  return factItem(t("Created"), formatLong(day), daysAgo(day));
}

/** Builds the fact of when a habit or category was last changed (its updatedAt). */
export function changedItem(stamp) {
  return factItem(t("Last changed"), formatStamp(stamp), timeAgo(stamp));
}

/** Formats the distance to today: "today", "yesterday", "5 days ago". */
export function daysAgo(iso) {
  const n = daysBetween(iso, state.today);
  if (n === 0) return t("today");
  if (n === 1) return t("yesterday");
  return t("{n} days ago", { n });
}

/** Formats a timestamp as "Sat, 26 Sep 2026, 15:42" in the user's time zone. */
function formatStamp(stamp) {
  const at = new Date(stamp);
  const time = at.toLocaleTimeString(locale,
    { hour: "2-digit", minute: "2-digit", timeZone: userTimeZone() });
  return `${formatLong(localISO(stamp))}, ${time}`;
}

/** Formats a timestamp as "just now", "12 min ago", "3 h ago" or in days. */
function timeAgo(stamp) {
  const minutes = Math.floor((Date.now() - new Date(stamp).getTime()) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  if (minutes < 24 * 60) return t("{n} h ago", { n: Math.floor(minutes / 60) });
  return daysAgo(localISO(stamp));
}
