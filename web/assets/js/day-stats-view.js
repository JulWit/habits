// Day statistics, opened from the day summary: perfect days, streaks of them,
// a year heatmap shaded by each day's share of completed habits, and the
// average share per weekday and per month. The server counts the days and
// computes the statistics (GET /api/days); this view only shows them.

import {api} from './api.js';
import {appBar} from './app-bar.js';
import {formatDayMonth, formatFull, MONTH_LONG, MONTH_SHORT, WEEKDAY_LONG, WEEKDAY_SHORT} from './dates.js';
import {el} from './dom.js';
import {t} from './i18n.js';
import {remote} from './remote-stats.js';
import {factItem, factsPanel, statRow} from './stat-panels.js';
import {state} from './state.js';
import {hideTooltip} from './tooltip.js';
import {centreToday, currentYear, initChartTooltips, sinceLabel, yearGrid} from './year-grid.js';

/** @type {!HTMLElement} */
let root;
/**
 * The handlers of app.js.
 * @type {!Object<string, !Function>}
 */
let actions;

/**
 * Initialises the day statistics view.
 * @param {!Object<string, !Function>} handlers the handlers of app.js
 */
export function initDays(handlers) {
  actions = handlers;
  root = document.getElementById('day-stats-view');
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target?.dataset.action === 'back') actions.closeDays();
  });
  initChartTooltips(root, '.heat[data-date], .day-bar[data-tip]');
}

/**
 * Renders the day statistics of the current year.
 */
export function renderDays() {
  // Nothing to count before the state is loaded.
  if (!root || !state.today) return;
  hideTooltip();
  const year = currentYear();
  const bar =
      appBar({title: t('Day statistics'), sub: year, edit: false, menu: []});
  const data = remote(`days|${year}`, () => api.days(year), () => {
    if (!root.hidden) renderDays();
  });
  // Until the first answer arrives.
  if (!data) {
    root.replaceChildren(bar);
    return;
  }
  const {stats} = data;
  root.replaceChildren(
      bar,
      statTiles(stats, `${year}-01-01`),
      highlights(stats),
      weekdays(stats),
      months(stats),
      heatmap(data.totals, year),
  );
  centreToday(root);
}

/**
 * Formats a rate as a percentage, or a dash for none.
 * @param {?number} rate
 * @return {string}
 */
const percent = (rate) => (rate === null ? '–' : `${Math.round(rate * 100)} %`);
/**
 * Formats a number of days.
 * @param {number} n
 * @return {string}
 */
const dayCount = (n) => (n === 1 ? t('1 day') : t('{n} days', {n}));

/**
 * Builds the stat tiles of the year.
 * @param {!Object} stats the server's day statistics
 * @param {string} from the first day counted
 * @return {!HTMLElement}
 */
function statTiles(stats, from) {
  return statRow([
    [
      t('Perfect days {since}', {since: sinceLabel(from)}),
      t('{n} of {total}', {n: stats.perfect, total: stats.counted}),
      'calendarCheck',
    ],
    [t('Current streak'), dayCount(stats.currentStreak), 'streak'],
    [t('Best streak'), dayCount(stats.bestStreak), 'trophy'],
    [t('Average per day'), percent(stats.average), 'percent'],
  ]);
}

// ---------- heatmap ----------

/**
 * Builds the heatmap of the year from the day totals.
 * @param {!Array<{date: string, due: number, done: number}>} totals
 * @param {string} year
 * @return {!HTMLElement}
 */
function heatmap(totals, year) {
  const byDate = new Map(totals.map((d) => [d.date, d]));
  return el(
      'section',
      {class: 'panel days-heatmap'},
      el('h3', {}, t('Year {year}', {year})),
      yearGrid(year, (iso) => heatCell(iso, byDate.get(iso))),
      legend(year),
  );
}

/**
 * Builds the square of a day from its total ({due, done}).
 * @param {string} iso
 * @param {{due: number, done: number}} total
 * @return {!HTMLElement}
 */
function heatCell(iso, {due, done}) {
  const ahead = iso > state.today;
  const counted = !ahead && due > 0;
  const status = heatStatus(due, done, ahead);
  const when = iso === state.today ?
      t('Today, {date}', {date: formatFull(iso)}) :
      formatFull(iso);

  return el('div', {
    class: [
      'heat',
      iso === state.today && 'is-today',
      ahead && 'is-future',
      !ahead && due === 0 && 'is-off',
      counted && done === due && 'is-perfect',
    ],
    // The shade grows with the share of completed habits.
    style: {'--rate': counted ? (done / due).toFixed(3) : undefined},
    data: {date: iso, status},
    role: 'img',
    'aria-label': `${when} — ${status}`,
  });
}

/**
 * Describes a day of the heatmap.
 * @param {number} due
 * @param {number} done
 * @param {boolean} ahead whether the day is in the future
 * @return {string}
 */
function heatStatus(due, done, ahead) {
  if (due === 0) return t('Nothing due on this day');
  if (ahead) {
    return due === 1 ? t('1 habit due') : t('{n} habits due', {n: due});
  }
  return `${t('{done} of {due} done', {done, due})} · ${percent(done / due)}`;
}

/**
 * Builds the legend of the heatmap.
 * @param {string} year
 * @return {!HTMLElement}
 */
function legend(year) {
  const from = formatDayMonth(`${year}-01-01`);
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  return el(
      'div',
      {class: 'heatmap-legend'},
      el('span', {}, `${from} – ${to}`),
      el('span', {style: {flex: '1'}}),
      el('span', {}, '0 %'),
      ...[0, 0.25, 0.5, 0.75].map(
          (rate) =>
              el('span', {class: 'heat', style: {'--rate': String(rate)}})),
      el('span', {class: 'heat is-perfect', style: {'--rate': '1'}}),
      el('span', {}, '100 %'),
  );
}

// ---------- weekdays and months ----------

/**
 * Builds a panel of horizontal bars, one per group: the average share and
 * the number of perfect days. `groups` are { label, name, rate, perfect }.
 * @param {string} title
 * @param {!Array<{label: string, name: string, rate: ?number, perfect:
 *     number}>} groups
 * @return {!HTMLElement}
 */
function barPanel(title, groups) {
  return el(
      'section',
      {class: 'panel'},
      el('h3', {}, title),
      el('div', {class: 'day-bars'}, ...groups.map(bar)),
  );
}

/**
 * Builds the bar of a group: its average share, with the number of perfect
 * days in the tooltip.
 * @param {{label: string, name: string, rate: ?number, perfect: number}} group
 * @return {!HTMLElement}
 */
function bar({label, name, rate, perfect}) {
  const perfectDays = t('Perfect days: {n}', {n: perfect});
  const status =
      rate === null ? t('Nothing due') : `Ø ${percent(rate)} · ${perfectDays}`;
  const width = `${Math.round((rate ?? 0) * 100)}%`;
  return el(
      'div',
      {
        class: ['day-bar', rate === null && 'is-empty'],
        data: {tip: name, status},
      },
      el('span', {class: 'day-bar-label'}, label),
      el('span', {class: 'day-bar-track'},
         el('span', {class: 'day-bar-fill', style: {width}})),
      el('span', {class: 'day-bar-value'}, percent(rate)),
  );
}

/**
 * Builds the bars per weekday.
 * @param {!Object} stats
 * @return {!HTMLElement}
 */
function weekdays(stats) {
  const groups = stats.weekdays.map((group, i) => {
    return {label: WEEKDAY_SHORT[i], name: WEEKDAY_LONG[i], ...group};
  });
  return barPanel(t('By weekday'), groups);
}

/**
 * Builds the bars per month.
 * @param {!Object} stats
 * @return {!HTMLElement}
 */
function months(stats) {
  // The server's months run from the first with due habits; firstMonth is 1
  // for January.
  const groups = (stats.months ?? []).map((group, i) => {
    const month = stats.firstMonth - 1 + i;
    return {label: MONTH_SHORT[month], name: MONTH_LONG[month], ...group};
  });
  return barPanel(t('By month'), groups);
}

/**
 * Facts: completed habits, days without any, best weekday and month.
 * @param {!Object} stats
 * @return {!HTMLElement}
 */
function highlights(stats) {
  const items = [
    factItem(t('Habits completed'), String(stats.completed)),
    factItem(t('Days without progress'), dayCount(stats.emptyDays)),
  ];
  if (stats.bestWeekday >= 0) {
    const rate = stats.weekdays[stats.bestWeekday].rate;
    items.push(factItem(
        t('Best weekday'), WEEKDAY_LONG[stats.bestWeekday],
        `Ø ${percent(rate)}`));
  }
  if (stats.bestMonth > 0) {
    const rate = stats.months[stats.bestMonth - stats.firstMonth].rate;
    items.push(factItem(
        t('Best month'), MONTH_LONG[stats.bestMonth - 1],
        `Ø ${percent(rate)}`));
  }
  return factsPanel(t('Highlights'), items);
}
