// Building blocks shared by the statistics views: a row of stat tiles, the
// label of the completion rate, a panel listing labelled facts, and the facts
// of when something was created and changed.

import {daysBetween, formatLong, localISO} from './dates.js';
import {locale, t, userTimeZone} from './i18n.js';
import {state} from './state.js';

/**
 * Labels the completion rate with the window it covers, which the server
 * takes from the rateWindow setting.
 * @return {string}
 */
export function rateLabel() {
  const days = state.settings.rateWindow;
  return days === 'all' ? t('Rate (all time)') :
                          t('Rate ({n} days)', {n: days});
}

/**
 * A row of stat tiles from [label, value, icon] triples; icon names one of
 * `icons`, shown in the tile's corner.
 */
export const StatRow = {
  name: 'StatRow',
  props: {stats: {type: Array, required: true}},
  template: `
    <div class="stat-row">
      <div v-for="[label, value, icon] in stats" :key="label" class="stat">
        <div class="value">{{ value }}</div>
        <span class="stat-icon" aria-hidden="true"><app-icon :name="icon"/></span>
        <div class="label">{{ label }}</div>
      </div>
    </div>`,
};

/**
 * A labelled fact, with an optional note after the value.
 * @typedef {{label: string, value: string, note: string}}
 */
let Fact;

/**
 * Returns a fact for FactsPanel.
 * @param {string} label
 * @param {string} value
 * @param {string=} note
 * @return {!Fact}
 */
export function factItem(label, value, note = '') {
  return {label, value, note};
}

/** A panel with a heading and a list of facts (factItem). */
export const FactsPanel = {
  name: 'FactsPanel',
  props: {
    title: {type: String, required: true},
    items: {type: Array, required: true},
  },
  template: `
    <section class="panel">
      <h3>{{ title }}</h3>
      <dl class="activity-list">
        <div v-for="item in items" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}<span v-if="item.note" class="note">{{ item.note }}</span></dd>
        </div>
      </dl>
    </section>`,
};

/**
 * Returns the fact of when a habit or category was created (its createdAt).
 * @param {string} stamp
 * @return {!Fact}
 */
export function createdItem(stamp) {
  const day = localISO(stamp);
  return factItem(t('Created'), formatLong(day), daysAgo(day));
}

/**
 * Returns the fact of when a habit or category was last changed (its
 * updatedAt).
 * @param {string} stamp
 * @return {!Fact}
 */
export function changedItem(stamp) {
  return factItem(t('Last changed'), formatStamp(stamp), timeAgo(stamp));
}

/**
 * Formats the distance to today: "today", "yesterday", "5 days ago".
 * @param {string} iso
 * @return {string}
 */
export function daysAgo(iso) {
  const n = daysBetween(iso, state.today);
  if (n === 0) return t('today');
  if (n === 1) return t('yesterday');
  return t('{n} days ago', {n});
}

/**
 * Formats a timestamp as "Sat, 26 Sep 2026, 15:42" in the user's time zone.
 * @param {string} stamp
 * @return {string}
 */
function formatStamp(stamp) {
  const at = new Date(stamp);
  const time = at.toLocaleTimeString(
      locale, {hour: '2-digit', minute: '2-digit', timeZone: userTimeZone()});
  return `${formatLong(localISO(stamp))}, ${time}`;
}

/**
 * Formats a timestamp as "just now", "12 min ago", "3 h ago" or in days.
 * @param {string} stamp
 * @return {string}
 */
function timeAgo(stamp) {
  const minutes = Math.floor((Date.now() - new Date(stamp).getTime()) / 60000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', {n: minutes});
  if (minutes < 24 * 60) return t('{n} h ago', {n: Math.floor(minutes / 60)});
  return daysAgo(localISO(stamp));
}
