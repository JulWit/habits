// Style guide at #/styleguide: all UI building blocks in both themes. It uses
// the same render functions as the overview.

import {dayCell, dayEntry, habitLabel} from './board-cells.js';
import {addDays, daysBetween, weekdayIndex} from './dates.js';
import {STREAK_LEVELS} from './habit-helpers.js';
import {colorValue, paintIcons} from './icons.js';
import {state} from './state.js';

/**
 * Returns the date `back` days before today.
 * @param {number} back
 * @return {string}
 */
const day = (back) => addDays(state.today, -back);

/**
 * Returns a sample habit with the statuses of its days from 400 days ago to
 * tomorrow, in the form the server sends them (domain.DayStatus): `isDue`
 * decides the due days, the entries whether they are done. The real ones come
 * from the server only.
 * @param {!Object} habit
 * @param {function(string): boolean=} isDue
 * @return {!Habit}
 */
function withDays(habit, isDue = () => true) {
  const from = day(400);
  let days = '';
  for (let iso = from; iso <= addDays(state.today, 1); iso = addDays(iso, 1)) {
    const value = habit.entries[iso] ?? 0;
    if (!isDue(iso)) {
      days += '-';
    } else {
      days += value >= habit.schedules[0].targetValue ? 'c' : 'o';
    }
  }
  return {...habit, daysFrom: from, days};
}

/**
 * Returns sample habits, one per kind and state.
 * @return {!Object<string, !Habit>}
 */
function samples() {
  // A single schedule since the first sample day.
  const schedules = (targetValue, frequency) => [{
    from: day(400),
    targetValue,
    frequency: {
      kind: 'daily',
      timesPerWeek: 0,
      weekdays: 0,
      intervalDays: 0,
      weekInterval: 0,
      weekOfMonth: 0,
      anchorDate: '',
      ...frequency,
    },
  }];
  const base = {
    unit: '',
    archivedAt: null,
    categoryId: '',
    stats: {
      currentStreak: 0,
      streakUnit: 'days',
      completionRate: 0,
      longestStreak: 0,
      total: 0,
    },
  };
  return {
    check: withDays({
      ...base,
      id: 'sg-check',
      name: 'Meditate',
      color: 'blue',
      kind: 'check',
      schedules: schedules(1),
      stats: {...base.stats, currentStreak: 6, streakUnit: 'days'},
      entries: {[day(1)]: 1, [day(2)]: 1, [day(0)]: 1},
    }),
    count: withDays({
      ...base,
      id: 'sg-count',
      name: 'Drink water',
      color: 'teal',
      kind: 'count',
      unit: 'glasses',
      schedules: schedules(80),
      entries: {[day(0)]: 80, [day(1)]: 30, [day(2)]: 65},
    }),
    time: withDays({
      ...base,
      id: 'sg-time',
      name: 'Reading',
      color: 'violet',
      kind: 'time',
      schedules: schedules(200, {kind: 'times_per_week', timesPerWeek: 4}),
      stats: {...base.stats, currentStreak: 1, streakUnit: 'weeks'},
      entries: {[day(0)]: 200, [day(1)]: 125, [day(2)]: 250},
    }),
    distance: withDays(
        {
          ...base,
          id: 'sg-distance',
          name: 'Running',
          color: 'orange',
          kind: 'distance',
          schedules: schedules(
              5000,
              {kind: 'custom_interval', intervalDays: 3, anchorDate: day(0)}),
          entries: {[day(0)]: 5200, [day(1)]: 2400, [day(2)]: 5000},
        },
        (iso) => {
          const n = daysBetween(day(0), iso);
          return n >= 0 && n % 3 === 0;
        }),
    // Scheduled on Mondays only.
    sparse: withDays(
        {
          ...base,
          id: 'sg-sparse',
          name: 'Laundry',
          color: 'slate',
          kind: 'check',
          schedules: schedules(1, {kind: 'weekdays', weekdays: 1}),
          entries: {},
        },
        (iso) => weekdayIndex(iso) === 0),
    archived: withDays({
      ...base,
      id: 'sg-archived',
      name: 'Old habit',
      color: 'pink',
      kind: 'check',
      schedules: schedules(1),
      entries: {},
      archivedAt: day(30),
    }),
  };
}

// ---------- small builders ----------

/**
 * Creates an element with a class and text. Simpler than el() in dom.js, as the
 * samples need no more.
 * @param {string} tag
 * @param {?string=} className
 * @param {string=} text
 * @return {!HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Creates an element from constant markup (never user input).
 * @param {string} tag
 * @param {string} className
 * @param {string} markup
 * @return {!HTMLElement}
 */
function html(tag, className, markup) {
  const node = el(tag, className);
  node.innerHTML = markup;
  return node;
}

/**
 * Builds a section with a title, an optional note and its specimens.
 * @param {string} title
 * @param {string} note
 * @param {...!Node} items
 * @return {!HTMLElement}
 */
function section(title, note, ...items) {
  const s = el('section', 'sg-section');
  s.append(el('h3', 'sg-title', title));
  if (note) s.append(el('p', 'sg-note', note));
  const row = el('div', 'sg-row');
  row.append(...items);
  s.append(row);
  return s;
}

/**
 * Returns a labelled specimen.
 * @param {string} label
 * @param {!Node} node
 * @return {!HTMLElement}
 */
function specimen(label, node) {
  const box = el('div', 'sg-specimen');
  box.append(node, el('span', 'sg-label', label));
  return box;
}

// ---------- the sections ----------

/**
 * Builds the section of the buttons.
 * @return {!HTMLElement}
 */
function buttons() {
  const b = (cls, text, over = {}) => {
    const node = el('button', cls, text);
    node.type = 'button';
    Object.assign(node, over);
    return node;
  };
  const icon = (name, label) => {
    const node =
        html('button', 'icon-button', `<span data-icon="${name}"></span>`);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  };
  return section(
      'Buttons',
      'Primary carries the single accent colour of the interface: ' +
          'dark grey on light, light on dark.',
      specimen('.button.primary', b('button primary', 'Create')),
      specimen('.button', b('button', 'Cancel')),
      specimen('.button.ghost', b('button ghost', 'Later')),
      specimen('.button.danger', b('button danger', 'Delete')),
      specimen(':disabled', b('button primary', 'Save', {disabled: true})),
      specimen('.button.round', b('button round', '+')),
      specimen('.icon-button', icon('edit', 'Edit')),
      specimen('.icon-button.is-back', (() => {
                 const node = icon('arrowLeft', 'Back');
                 node.classList.add('is-back');
                 return node;
               })()),
  );
}

/**
 * Builds the section of the form fields.
 * @return {!HTMLElement}
 */
function fields() {
  const field = (label, control, hint) => {
    const wrap = el('label', 'field');
    wrap.append(el('span', 'field-label', label), control);
    if (hint) wrap.append(el('p', 'field-hint', hint));
    return wrap;
  };
  const input = (over) => Object.assign(el('input'), {type: 'text', ...over});

  const segmented = html('div', 'segmented', `
    <label><input type="radio" name="sg-kind" value="check" checked>
      <span data-icon="check">Check</span></label>
    <label><input type="radio" name="sg-kind" value="count">
      <span data-icon="calculator">Count</span></label>
    <label><input type="radio" name="sg-kind" value="time">
      <span data-icon="clock">Time</span></label>
    <label><input type="radio" name="sg-kind" value="distance">
      <span data-icon="navigation">Distance</span></label>`);
  segmented.setAttribute('role', 'radiogroup');
  segmented.setAttribute('aria-label', 'Kind');

  const weekdays = el('div', 'weekdays');
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => {
    const w = el('button', 'weekday', d);
    w.type = 'button';
    w.setAttribute('aria-pressed', String(i === 0 || i === 2 || i === 4));
    weekdays.append(w);
  });

  const swatches = el('div', 'swatches');
  swatches.setAttribute('role', 'radiogroup');
  for (const color of state.colors) {
    const s = el('button', 'swatch');
    s.type = 'button';
    s.style.setProperty('--swatch', colorValue(color));
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', String(color === state.colors[0]));
    s.setAttribute('aria-label', color);
    swatches.append(s);
  }

  const stepper = el('div', 'stepper');
  const minus = el('button', 'button round', '−');
  const plus = el('button', 'button round', '+');
  minus.type = plus.type = 'button';
  stepper.append(
      minus, Object.assign(el('input'), {type: 'number', value: '20'}), plus);

  const toggle = el('label', 'switch');
  toggle.append(
      Object.assign(el('input'), {type: 'checkbox', checked: true}),
      el('span', null, 'Show archived habits'),
  );

  const picker =
      html('button', 'picker', '<span class="picker-value">Health</span>');
  picker.type = 'button';

  return section(
      'Form fields',
      'Everything the editor and the settings use.',
      field('Name', input({placeholder: 'e.g. drink water'})),
      field('With hint', input({value: '5000'}), 'Equals 5.0 km.'),
      field('Disabled', input({value: 'Locked', disabled: true})),
      specimen('.segmented', segmented),
      specimen('.weekdays', weekdays),
      specimen('.swatches', swatches),
      specimen('.stepper', stepper),
      specimen('.switch', toggle),
      specimen('.picker', picker),
      specimen(
          'p.error', el('p', 'error', 'Please select at least one weekday.')),
  );
}

/**
 * Builds the section of the board's building blocks.
 * @param {!Object<string, !Habit>} s the sample habits
 * @return {!HTMLElement}
 */
function board(s) {
  // Uses the overview's render functions.
  const cells = (habit, dates) => {
    const row = el('div', 'sg-cells');
    for (const iso of dates) {
      row.append(dayEntry(habit, iso));
    }
    return row;
  };
  const dates = [day(2), day(1), day(0), addDays(state.today, 1)];

  const header = el('div', 'sg-cells');
  // Today and another day.
  header.append(dayCell(day(0)), dayCell(day(1)));

  return section(
      'Board',
      'Built with the same functions as the overview — ' +
          'dayCell(), habitLabel(), dayEntry().',
      specimen('dayCell: today / normal', header),
      specimen('habitLabel()', habitLabel(s.time)),
      specimen('habitLabel(): archived', habitLabel(s.archived)),
      specimen('Check', cells(s.check, dates)),
      specimen('Count', cells(s.count, dates)),
      specimen('Time', cells(s.time, dates)),
      specimen('Distance', cells(s.distance, dates)),
      specimen('not scheduled', cells(s.sparse, dates)),
      specimen('streak levels: none, 1 week … 1 year', streakScale(s.check)),
      specimen('.month-label', el('div', 'month-label', 'September')),
  );
}

/**
 * Returns one completed cell per streak level, each with a run of matching
 * length.
 * @param {!Habit} habit
 * @return {!HTMLElement}
 */
function streakScale(habit) {
  const row = el('div', 'sg-cells');
  [0, ...STREAK_LEVELS].forEach((length, i) => {
    const iso = day(i);
    row.append(dayEntry(
        withDays({
          ...habit,
          entries: {[iso]: 1},
          streakRuns: length ? [{from: addDays(iso, -(length - 1)), to: iso}] :
                               [],
        }),
        iso));
  });
  return row;
}

/**
 * Builds the section of the heatmap levels.
 * @return {!HTMLElement}
 */
function heatmap() {
  const row = el('div', 'heatmap-sample');
  for (const level of [0, 1, 2, 3, 4]) {
    const cell = el('div', 'heat');
    cell.dataset.level = String(level);
    row.append(cell);
  }
  for (const mod of ['is-off', 'is-future']) {
    const cell = el('div', `heat ${mod}`);
    row.append(cell);
  }
  return section(
      'Heatmap',
      'Levels 0–4, then "not scheduled" and the future.',
      specimen('data-level 0 … 4 · is-off · is-future', row),
  );
}

/**
 * Builds the section of the toasts and messages.
 * @return {!HTMLElement}
 */
function feedback() {
  const toast = (cls, text, withAction) => {
    const node = el('div', cls);
    node.append(el('span', 'text', text));
    if (withAction) {
      const action = el('button', 'button', 'Undo');
      action.type = 'button';
      node.append(action);
    }
    const close = html('button', 'icon-button', '&times;');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    node.append(close);
    return node;
  };
  return section(
      'Messages',
      'In the running app toasts sit at the bottom right; ' +
          'here they stand in the flow.',
      specimen('.toast', toast('toast', 'Habit deleted.', true)),
      specimen(
          '.toast.is-error',
          toast('toast is-error', 'No connection to the server.', false)),
  );
}

/**
 * Builds the section of the text styles.
 * @return {!HTMLElement}
 */
function typography() {
  return section(
      'Text',
      'The type sizes that appear outside the building blocks.',
      specimen('h2', el('h2', null, 'Heading')),
      specimen('.block-title', el('h2', 'block-title', 'Category')),
      specimen('p', el('p', null, 'Body text, as it appears in empty states.')),
      specimen('.habit-meta', el('span', 'habit-meta', '20 min · daily')),
      specimen('.field-hint', el('p', 'field-hint', 'A hint below a field.')),
  );
}

/**
 * Returns the names of the design tokens declared for the light theme.
 * @return {!Array<string>}
 */
function tokenNames() {
  const names = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // Reading cssRules of a cross-origin stylesheet throws.
      continue;
    }
    for (const rule of rules) {
      if (!rule.selectorText || !/:root/.test(rule.selectorText)) continue;
      for (const prop of rule.style) {
        if (prop.startsWith('--') && !names.includes(prop)) names.push(prop);
      }
    }
  }
  return names;
}

/**
 * Builds the section listing the design tokens; their values are filled in
 * later.
 * @param {!Array<string>} names
 * @return {!HTMLElement}
 */
function tokens(names) {
  const list = el('div', 'sg-tokens');
  for (const name of names) {
    const row = el('div', 'sg-token');
    const chip = el('span', 'sg-chip');
    // Resolved per panel, so each theme shows its own colour.
    chip.style.background = `var(${name})`;
    row.append(
        chip, el('code', 'sg-token-name', name), el('span', 'sg-token-value'));
    list.append(row);
  }
  const s = section(
      'Tokens', 'Read straight from the stylesheet, not maintained here.',
      list);
  s.querySelector('.sg-row').classList.add('is-block');
  return s;
}

/**
 * Fills in the resolved token values of a panel.
 * @param {!HTMLElement} panel
 * @param {!Array<string>} names
 */
function fillTokenValues(panel, names) {
  const styles = getComputedStyle(panel);
  const rows = panel.querySelectorAll('.sg-token');
  rows.forEach((row, i) => {
    // Collapse multi-line values.
    const value = styles.getPropertyValue(names[i]).trim().replace(/\s+/g, ' ');
    row.querySelector('.sg-token-value').textContent = value;
    // Hide the swatch for non-colours, keeping the grid cell.
    if (!/^(#|rgb|hsl|color|oklch)/i.test(value)) {
      row.querySelector('.sg-chip').classList.add('is-empty');
    }
  });
}

// ---------- assembly ----------

/**
 * Builds every section in one theme.
 * @param {string} theme light or dark
 * @param {!Array<string>} names the design tokens
 * @return {!HTMLElement}
 */
function panel(theme, names) {
  const wrap = el('div', 'sg-theme');
  wrap.dataset.theme = theme;
  wrap.append(el('h2', 'sg-theme-title', theme === 'dark' ? 'Dark' : 'Light'));

  const s = samples();
  wrap.append(
      tokens(names), buttons(), fields(), board(s), heatmap(), feedback(),
      typography());
  return wrap;
}

/**
 * Renders the style guide into `root`, both themes side by side.
 * @param {!HTMLElement} root
 */
export function renderStyleguide(root) {
  const names = tokenNames();

  const head = el('header', 'sg-head');
  head.append(el('h1', null, 'Building blocks'));
  head.append(el(
      'p', 'sg-note',
      'Every building block of the application, in both themes side by side. ' +
          'Not linked — reachable at #/styleguide.'));

  const both = el('div', 'sg-themes');
  const light = panel('light', names);
  const dark = panel('dark', names);
  both.append(light, dark);

  root.replaceChildren(head, both);
  // Values only resolve once the panels are in the document.
  fillTokenValues(light, names);
  fillTokenValues(dark, names);
  paintIcons(root);
}
