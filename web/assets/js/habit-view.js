// Habit detail view: statistics, activity chart and calendar heatmap.

import {api} from './api.js';
import {appBar} from './app-bar.js';
import {addDays, dayOfMonth, formatDayMonth, formatFull, formatLong, MONTH_LONG, MONTH_SHORT, monthIndex} from './dates.js';
import {el, markup} from './dom.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue, habitIconBadge, icons} from './icons.js';
import {remote} from './remote-stats.js';
import {changedItem, createdItem, daysAgo, factItem, factsPanel, rateLabel, statRow} from './stat-panels.js';
import {habitById, state} from './state.js';
import {hideTooltip} from './tooltip.js';
import {centreToday, currentYear, initChartTooltips, yearGrid} from './year-grid.js';

/** @type {!HTMLElement} */
let root;
/**
 * The handlers of app.js.
 * @type {!Object<string, !Function>}
 */
let actions;

/**
 * Initialises the habit view.
 * @param {!Object<string, !Function>} handlers the handlers of app.js
 */
export function initDetail(handlers) {
  actions = handlers;
  root = document.getElementById('habit-view');
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const id = root.dataset.habit;
    switch (target.dataset.action) {
      case 'back':
        actions.closeHabit();
        break;
      case 'edit':
        actions.editHabit(id);
        break;
      case 'archive':
        actions.toggleArchive(id);
        break;
      case 'skip':
        actions.skipDays(id);
        break;
      case 'delete':
        actions.deleteHabit(id);
        break;
      case 'year-earlier':
        showYear(-1);
        break;
      case 'year-later':
        showYear(1);
        break;
    }
  });
  initChartTooltips(root, '.heat[data-date], .cum-col[data-tip]');
}

/**
 * The year the heatmap and the cumulative chart show, e.g. "2025", and the
 * habit it was chosen for. Another habit opens with the current year; the
 * choice is not kept beyond the session.
 * @type {?string}
 */
let shownYear = null;
/**
 * The ID of the habit `shownYear` was chosen for.
 * @type {?string}
 */
let shownFor = null;

/**
 * Returns the first and the last year of the habit's history, as numbers.
 * @param {!Habit} habit
 * @return {!Array<number>}
 */
function yearRange(habit) {
  const last = Number(currentYear());
  const first = Number(habit.historyStart?.slice(0, 4)) || last;
  return [Math.min(first, last), last];
}

/**
 * Shows the year before (-1) or after (+1) the one shown.
 * @param {number} delta
 */
function showYear(delta) {
  const habit = habitById(root.dataset.habit);
  if (!habit) return;
  const [first, last] = yearRange(habit);
  shownYear =
      String(Math.min(last, Math.max(first, Number(shownYear) + delta)));
  renderDetail(habit);
  // Keep the focus on the arrows, which the render replaced.
  const again = root.querySelector(
      `[data-action="${delta < 0 ? 'year-earlier' : 'year-later'}"]`);
  (again?.disabled ? root.querySelector('.year-nav button:not(:disabled)') :
                     again)
      ?.focus();
}

/**
 * Renders the habit view.
 * @param {!Habit} habit
 */
export function renderDetail(habit) {
  if (!root || !habit) return;
  // The tooltip's target is about to be replaced.
  hideTooltip();
  if (shownFor !== habit.id) {
    shownFor = habit.id;
    shownYear = currentYear();
  }
  root.dataset.habit = habit.id;
  root.style.setProperty('--habit-color', colorValue(habit.color));
  // How the habit is set up comes first, then its statistics and the year,
  // then its activity. The cumulative chart is only shown for countable
  // habits.
  const panels = [
    header(habit),
    details(habit),
    stats(habit),
    habitHelpers.isCountable(habit) ? cumulative(habit) : null,
    heatmap(habit),
    activity(habit),
  ];
  root.replaceChildren(...panels.filter(Boolean));
  showNewest(root);
  centreToday(root);
}

/**
 * The view's title bar: back, name, edit, and the overflow menu with archive
 * and delete. Frequency and target are in the details panel.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function header(habit) {
  const archived = habit.archivedAt != null;

  return appBar({
    title: habit.name,
    // Without an icon, a dot in the habit's colour.
    badge: habitIconBadge(habit, 'habit-icon') ?? el('span', {class: 'dot'}),
    menu: [
      {action: 'skip', label: t('Skip days…'), icon: 'skip'},
      archived ?
          {action: 'archive', label: t('Reactivate'), icon: 'unarchive'} :
          {
            action: 'archive',
            label: t('Archive', {context: 'verb'}),
            icon: 'archive',
          },
      {action: 'delete', label: t('Delete'), icon: 'trash', danger: true},
    ],
  });
}

/**
 * Formats a streak with its unit: "1 day", "6 days", "1 week", "2 months".
 * @param {number} count
 * @param {string} unit days, weeks or months
 * @return {string}
 */
function streakText(count, unit) {
  if (unit === 'months') {
    return count === 1 ? t('1 month') : t('{n} months', {n: count});
  }
  if (unit === 'weeks') {
    return count === 1 ? t('1 week') : t('{n} weeks', {n: count});
  }
  return count === 1 ? t('1 day') : t('{n} days', {n: count});
}

/**
 * Builds the stat tiles from the server's statistics of the habit.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function stats(habit) {
  const s = habit.stats;
  return statRow([
    [t('Current streak'), streakText(s.currentStreak, s.streakUnit), 'streak'],
    [t('Best streak'), streakText(s.bestStreak, s.streakUnit), 'trophy'],
    [rateLabel(), `${Math.round(s.completionRate * 100)} %`, 'percent'],
    [t('Total'), habitHelpers.formatTotal(habit, s.total), 'total'],
  ]);
}

/**
 * Shows how the habit is set up: frequency, daily target (not for check
 * habits), category and, if archived, its status.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function details(habit) {
  const all = habit.schedules;
  // With earlier schedules, the current one is dated.
  const since = all.length > 1 ?
      t('since {date}', {date: formatLong(all.at(-1).from)}) :
      '';
  const items = [factItem(
      t('Frequency'),
      habitHelpers.describeFrequency(
          habitHelpers.currentSchedule(habit).frequency),
      since)];
  const target = habitHelpers.describeTarget(habit);
  if (target) items.push(factItem(t('Daily target'), target, since));
  // Earlier schedules, newest first.
  for (let i = all.length - 2; i >= 0; i--) {
    const until = formatLong(addDays(all[i + 1].from, -1));
    items.push(factItem(
        t('Until {date}', {date: until}), describeSchedule(habit, all[i])));
  }
  const category = state.categories.find((c) => c.id === habit.categoryId);
  items.push(factItem(t('Category'), category?.name ?? t('No category')));
  if (habit.archivedAt) items.push(factItem(t('Status'), t('Archived')));
  return factsPanel(t('Details'), items);
}

/**
 * Describes a schedule of the habit: its frequency and, if any, its target.
 * @param {!Habit} habit
 * @param {!Schedule} schedule
 * @return {string}
 */
function describeSchedule(habit, schedule) {
  return [
    habitHelpers.describeFrequency(schedule.frequency),
    habitHelpers.describeTarget(habit, schedule),
  ].filter(Boolean)
      .join(' · ');
}

/**
 * Shows when the habit was created, last completed and last changed (the
 * server's updatedAt).
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function activity(habit) {
  // The server leaves it empty if the habit was never done.
  const done = habit.stats?.lastDone || null;
  return factsPanel(
      t('Activity'),
      [
        createdItem(habit.createdAt),
        factItem(
            t('Last done'), done ? formatLong(done) : t('Not yet'),
            done ? daysAgo(done) : ''),
        changedItem(habit.updatedAt),
      ],
      'activity');
}

/**
 * Builds the heatmap of the year shown.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function heatmap(habit) {
  const year = shownYear;
  return el(
      'section',
      {class: 'panel'},
      el(
          'div',
          {class: 'year-head'},
          el('h3', {}, t('Year {year}', {year})),
          yearNav(habit),
          ),
      yearGrid(year, (iso) => heatCell(habit, iso)),
      legend(year),
  );
}

/**
 * Builds the arrows to the year before and after the one shown, from the
 * first year of the habit's history to the current one.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function yearNav(habit) {
  const [first, last] = yearRange(habit);
  const year = Number(shownYear);
  const arrow = (action, icon, label, disabled) =>
      el('button', {
        type: 'button',
        class: 'icon-button',
        data: {action},
        title: label,
        'aria-label': label,
        disabled,
      },
         markup(icon));
  return el(
      'div',
      {class: 'year-nav'},
      arrow(
          'year-earlier', icons.chevronLeft, t('Previous year'), year <= first),
      arrow('year-later', icons.chevronRight, t('Next year'), year >= last),
  );
}

/**
 * Builds the square of a day in the heatmap.
 * @param {!Habit} habit
 * @param {string} iso
 * @return {!HTMLElement}
 */
function heatCell(habit, iso) {
  const {value} = habitHelpers.entryOn(habit, iso);
  const ahead = iso > state.today;
  // Unscheduled days are marked in the future too, so the schedule stays
  // visible.
  const off = !habitHelpers.isScheduled(habit, iso) && value === 0;
  const skipped = !off && habitHelpers.isSkipped(habit, iso);
  const status = heatStatus(habit, iso, value);
  const when = iso === state.today ?
      t('Today, {date}', {date: formatFull(iso)}) :
      formatFull(iso);

  return el('div', {
    class: [
      'heat',
      // Used by centreToday().
      iso === state.today && 'is-today',
      ahead && 'is-future',
      off && 'is-off',
      skipped && 'is-skipped',
    ],
    data: {
      date: iso,
      status,
      level: off || skipped || ahead ?
          undefined :
          habitHelpers.heatLevel(habit, iso, value),
    },
    // Uses the chart tooltip instead of a title attribute; the aria-label holds
    // the same text.
    role: 'img',
    'aria-label': `${when} — ${status}`,
  });
}

/**
 * Describes a day of the heatmap. Future days only show planned values.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {number} value
 * @return {string}
 */
function heatStatus(habit, iso, value) {
  if (habitHelpers.isSkipped(habit, iso)) return t('skipped');
  const vars = {
    value: habitHelpers.formatValue(habit, value),
    target: habitHelpers.formatValue(habit, habitHelpers.target(habit, iso)),
  };
  if (iso > state.today) {
    if (value > 0) return t('{value} planned', vars);
    return habitHelpers.isScheduled(habit, iso) ? t('still ahead') :
                                                  t('not scheduled');
  }
  if (habitHelpers.isLimit(habit, iso) &&
      habitHelpers.isScheduled(habit, iso)) {
    if (value > 0) return t('{value} of at most {target}', vars);
    return habitHelpers.isDone(habit, iso) ? t('nothing, within the limit') :
                                             t('nothing recorded');
  }
  if (value > 0) return t('{value} of {target}', vars);
  return habitHelpers.isScheduled(habit, iso) ? t('nothing recorded') :
                                                t('not scheduled');
}

/**
 * Builds the legend of the heatmap.
 * @param {string} year
 * @return {!HTMLElement}
 */
function legend(year) {
  const from = formatDayMonth(`${year}-01-01`);
  // The grid covers the whole year.
  const to = `${formatDayMonth(`${year}-12-31`)} ${year}`;
  return el(
      'div',
      {class: 'heatmap-legend'},
      el('span', {}, `${from} – ${to}`),
      el('span', {style: {flex: '1'}}),
      el('span', {}, t('less')),
      ...[0, 1, 2, 3, 4].map(
          (level) => el('span', {class: 'heat', data: {level}})),
      el('span', {}, t('more')),
  );
}

/**
 * Chart granularities, each covering the year to date. `barMin` is the minimum
 * bar width before the chart scrolls; `every` is the label interval.
 * @const {!Object<string, {label: string, barMin: string, every: number}>}
 */
const GRAINS = {
  day: {label: t('Day'), barMin: '9px', every: 7},
  week: {label: t('Week'), barMin: '14px', every: 4},
  month: {label: t('Month'), barMin: '24px', every: 1},
};

/** The selected granularity, kept for the session only. */
let grain = 'month';

/**
 * Builds the cumulative chart: each bar is the running total at the end of its
 * day, week or month, with the period's own sum highlighted at the top. The
 * server sums the values (GET /api/habits/{id}/totals).
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function cumulative(habit) {
  return el(
      'section', {class: 'panel cum-panel'}, grainHead(habit),
      cumulativeBody(habit));
}

/**
 * Rebuilds the chart of the habit shown, e.g. once its totals have arrived,
 * keeping the heatmap's scroll position.
 * @param {string} id
 */
function redrawCumulative(id) {
  const panel = root.querySelector('.cum-panel');
  const habit = habitById(id);
  if (!panel || !habit || root.dataset.habit !== id) return;
  panel.replaceChild(cumulativeBody(habit), panel.lastElementChild);
  showNewest(panel);
}

/**
 * Scrolls a chart to its end (today). Must be called after the panel has been
 * inserted into the document.
 * @param {!Element} panel
 */
function showNewest(panel) {
  const scroller = panel.querySelector('.cum-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

/**
 * Builds the chart heading with the day/week/month switch.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function grainHead(habit) {
  const choices = Object.entries(GRAINS).map(([key, {label}]) => {
    const input = el(
        'input',
        {type: 'radio', name: 'cum-grain', value: key, checked: key === grain});
    input.addEventListener('change', () => {
      grain = key;
      redrawCumulative(habit.id);
    });
    return el('label', {}, input, el('span', {}, label));
  });
  return el(
      'div',
      {class: 'cum-head'},
      el('h3', {}, t('Cumulative')),
      el('div', {
        class: 'segmented cum-grain',
        role: 'radiogroup',
        'aria-label': t('Period'),
      },
         ...choices),
  );
}

/**
 * Builds the chart's content from the loaded totals; empty until they have
 * arrived.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function cumulativeBody(habit) {
  // The year shown, to today in the current year.
  const year = shownYear;
  const current = year === currentYear();
  const summary = remote(
      `totals|${habit.id}|${year}|${grain}`,
      () => api.habitTotals(habit.id, year, grain),
      () => redrawCumulative(habit.id),
  );
  // Until the first answer arrives.
  if (!summary) return el('div', {class: 'cum-loading'});

  if (summary.total === 0) {
    return el(
        'div',
        {},
        el('p', {class: 'cum-empty'},
           current ? t('No entries in {year} yet.', {year}) :
                     t('No entries in {year}.', {year})),
    );
  }

  return el(
      'div',
      {},
      cumulativeSummary(habit, summary, t('in {year}', {year})),
      cumulativeChart(habit, summary),
  );
}

/**
 * Builds the line above the chart: the total, the average per active day and
 * the best day.
 * @param {!Habit} habit
 * @param {{buckets: !Array<{start: string, sum: number, cumulative: number}>,
 *     total: number, best: number, activeDays: number}} summary
 * @param {string} scopeIn the time the total covers, e.g. "in 2026"
 * @return {!HTMLElement}
 */
function cumulativeSummary(habit, {total, best, activeDays}, scopeIn) {
  // Average per day with an entry.
  const average = Math.round(total / activeDays);
  return el(
      'p',
      {class: 'cum-summary'},
      el('strong', {}, habitHelpers.formatTotal(habit, total)),
      t(' {scope} · avg ', {scope: scopeIn}),
      el('strong', {}, habitHelpers.formatTotal(habit, average)),
      activeDays === 1 ? t(' on 1 active day · best day ') :
                         t(' on {n} active days · best day ', {n: activeDays}),
      el('strong', {}, habitHelpers.formatTotal(habit, best)),
  );
}

/**
 * Builds the bars of the chart with their labels.
 * @param {!Habit} habit
 * @param {{buckets: !Array<{start: string, sum: number, cumulative: number}>,
 *     total: number, best: number, activeDays: number}} summary
 * @return {!HTMLElement}
 */
function cumulativeChart(habit, {buckets, total}) {
  return el(
      'div',
      {
        class: ['cum-chart', grain !== 'month' && 'is-fine'],
        style: {
          '--cols': String(buckets.length),
          '--bar-min': GRAINS[grain].barMin,
        },
      },
      // The scale line marks the year's total, outside the scrolling area.
      el('div', {class: 'cum-scale'}, habitHelpers.formatTotal(habit, total)),
      // Bars and labels scroll together.
      el(
          'div',
          {class: 'cum-scroll'},
          el(
              'div',
              {class: 'cum-track'},
              el('div', {class: 'cum-bars'},
                 ...buckets.map(
                     (bucket) => cumulativeColumn(habit, bucket, total))),
              bucketLabels(buckets),
              ),
          ),
  );
}

/**
 * Builds the bar of a bucket: its height is the running total, the period's
 * own sum is highlighted at its top.
 * @param {!Habit} habit
 * @param {{start: string, sum: number, cumulative: number}} bucket
 * @param {number} total
 * @return {!HTMLElement}
 */
function cumulativeColumn(habit, {start, sum, cumulative: running}, total) {
  // Shown by the shared tooltip.
  const tip = bucketName(start);
  const runningTotal = habitHelpers.formatTotal(habit, running);
  const status = sum > 0 ?
      t('{total} · of that +{sum}',
        {total: runningTotal, sum: habitHelpers.formatTotal(habit, sum)}) :
      t('{total} · nothing added', {total: runningTotal});

  return el(
      'div',
      {
        class: 'cum-col',
        data: {tip, status},
        // Accessible name, as the tooltip requires a pointer.
        role: 'img',
        'aria-label': `${tip}: ${status}`,
      },
      el(
          'div',
          {
            // Hide bars before the first entry.
            class: ['cum-bar', running === 0 && 'is-zero'],
            style: {height: `${(running / total) * 100}%`},
          },
          sum > 0 && running > 0 && el('div', {
            class: 'cum-gain',
            style: {height: `${(sum / running) * 100}%`},
          }),
          ),
  );
}

/**
 * Returns the tooltip label of a bucket.
 * @param {string} start
 * @return {string}
 */
function bucketName(start) {
  if (grain === 'month') {
    return t('End of {month}', {month: MONTH_LONG[monthIndex(start)]});
  }
  if (grain === 'week') {
    return t('Week from {date}', {date: formatDayMonth(start)});
  }
  return formatFull(start);
}

/**
 * Builds the labels below the bars. For fine granularities only every n-th
 * bucket is labelled.
 * @param {!Array<{start: string}>} buckets
 * @return {!HTMLElement}
 */
function bucketLabels(buckets) {
  const {every} = GRAINS[grain];
  return el('div', {class: 'cum-months'}, ...buckets.map(({start}, i) => {
    // Counted from the end, so the latest bucket is always labelled.
    const labelled = (buckets.length - 1 - i) % every === 0;
    return el(
        'span', {},
        labelled &&
            el('i', {},
               grain === 'month' ?
                   MONTH_SHORT[monthIndex(start)] :
                   `${dayOfMonth(start)}.${monthIndex(start) + 1}.`));
  }));
}
