// Building blocks shared by the habit and category views: a row of stat tiles,
// the label of the completion rate, a panel listing labelled facts, and the
// facts of when something was created and changed.

import {daysBetween, formatLong, localISO} from './dates.js';
import {el, markup} from './dom.js';
import {locale, t, userTimeZone} from './i18n.js';
import {icons} from './icons.js';
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
 * Builds a row of stat tiles from [label, value, icon] triples; icon names
 * one of `icons`, shown in the tile's corner.
 * @param {!Array<!Array<string>>} stats
 * @return {!HTMLElement}
 */
export function statRow(stats) {
  return el(
      'div', {class: 'stat-row'},
      ...stats.map(
          ([label, value, icon]) => el(
              'div',
              {class: 'stat'},
              el('div', {class: 'value'}, value),
              el('span', {class: 'stat-icon', 'aria-hidden': 'true'},
                 markup(icons[icon])),
              el('div', {class: 'label'}, label),
              )));
}

/**
 * Builds a panel with a heading and a list of facts, each built by
 * factItem.
 * @param {string} title
 * @param {!Array<!HTMLElement>} items
 * @param {string=} className
 * @return {!HTMLElement}
 */
export function factsPanel(title, items, className = 'details') {
  return el(
      'section',
      {class: ['panel', className]},
      el('h3', {}, title),
      el('dl', {class: 'activity-list'}, ...items),
  );
}

/**
 * Builds a labelled fact, with an optional note after the value.
 * @param {string} label
 * @param {string|!Node} value
 * @param {string=} note
 * @return {!HTMLElement}
 */
export function factItem(label, value, note = '') {
  return el(
      'div',
      {},
      el('dt', {}, label),
      el('dd', {}, value, note && el('span', {class: 'note'}, note)),
  );
}

/**
 * Builds the fact of when a habit or category was created (its createdAt).
 * @param {string} stamp
 * @return {!HTMLElement}
 */
export function createdItem(stamp) {
  const day = localISO(stamp);
  return factItem(t('Created'), formatLong(day), daysAgo(day));
}

/**
 * Builds the fact of when a habit or category was last changed (its
 * updatedAt).
 * @param {string} stamp
 * @return {!HTMLElement}
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
