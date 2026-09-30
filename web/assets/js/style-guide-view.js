// Style guide at #/styleguide: all UI building blocks in both themes. It uses
// the same components as the overview. Its texts are not translated.

import {BoardDayCell, BoardHabitLabel, BoardHeadDay} from './board-cells.js';
import {addDays, daysBetween, weekdayIndex} from './dates.js';
import {STREAK_LEVELS} from './habit-helpers.js';
import {colorValue} from './icons.js';
import {state} from './state.js';
import {computed, onMounted, ref} from './vue.js';

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
  /**
   * Returns a single schedule since the first sample day.
   * @param {number} targetValue
   * @param {!Object=} frequency fields that differ from a daily frequency
   * @return {!Array<!Object>}
   */
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

/**
 * Returns one completed sample per streak level, each with a run of matching
 * length: [{habit, iso}].
 * @param {!Habit} habit
 * @return {!Array<{habit: !Habit, iso: string}>}
 */
function streakScale(habit) {
  return [0, ...STREAK_LEVELS].map((length, i) => {
    const iso = day(i);
    return {
      iso,
      habit: withDays({
        ...habit,
        entries: {[iso]: 1},
        streakRuns: length ? [{from: addDays(iso, -(length - 1)), to: iso}] :
                             [],
      }),
    };
  });
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

/** A section with a title, an optional note and its specimens. */
const StyleGuideSection = {
  name: 'StyleGuideSection',
  props: {title: String, note: String, block: Boolean},
  template: `
    <section class="style-guide-section">
      <h3 class="style-guide-section-title">{{ title }}</h3>
      <p
        v-if="note"
        class="style-guide-section-note"
      >
        {{ note }}
      </p>
      <div
        class="style-guide-section-row"
        :class="{'is-block': block}"
      >
        <slot/>
      </div>
    </section>`,
};

/** A labelled specimen. */
const StyleGuideSpecimen = {
  name: 'StyleGuideSpecimen',
  props: {label: String},
  template: `
    <div class="style-guide-specimen"><slot/>
      <span class="style-guide-specimen-label">{{ label }}</span>
    </div>`,
};

/**
 * Every section in one theme. The token values are read once the panel is in
 * the document, so each theme shows its own.
 */
const StyleGuidePanel = {
  name: 'StyleGuidePanel',
  components: {
    BoardDayCell,
    StyleGuideSection,
    StyleGuideSpecimen,
    BoardHabitLabel,
    BoardHeadDay,
  },
  props: {
    theme: {type: String, required: true},
    names: {type: Array, required: true},
  },
  setup(props) {
    const root = ref(null);
    const values = ref([]);
    onMounted(() => {
      const styles = getComputedStyle(root.value);
      // Collapsed to one line.
      values.value = props.names.map(
          (name) => styles.getPropertyValue(name).trim().replace(/\s+/g, ' '));
    });
    const s = samples();
    return {
      root,
      values,
      s,
      state,
      colorValue,
      dates: [day(2), day(1), day(0), addDays(state.today, 1)],
      today: day(0),
      yesterday: day(1),
      streaks: streakScale(s.check),
      // Monday, Wednesday and Friday are picked.
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
          (name, i) => ({name, picked: i === 0 || i === 2 || i === 4})),
      // A sample per kind, and one that is not due on the shown days.
      rows: [
        ['Check', s.check],
        ['Count', s.count],
        ['Time', s.time],
        ['Distance', s.distance],
        ['not scheduled', s.sparse],
      ],
      // Non-colours get no swatch, keeping the grid cell.
      isColor: (value) => /^(#|rgb|hsl|color|oklch)/i.test(value ?? ''),
    };
  },
  template: `
    <div
      ref="root"
      class="style-guide-panel"
      :data-theme="theme"
    >
      <h2 class="style-guide-panel-title">
        {{ theme === 'dark' ? 'Dark' : 'Light' }}
      </h2>
      <style-guide-section
        title="Tokens"
        note="Read straight from the stylesheet, not maintained here."
        block
      >
        <div class="style-guide-panel-tokens">
          <div
            v-for="(name, i) in names"
            :key="name"
            class="style-guide-panel-token"
          >
            <span
              class="style-guide-panel-chip"
              :class="{'is-empty': values.length && !isColor(values[i])}"
              :style="{background: 'var(' + name + ')'}"
            ></span>
            <code class="style-guide-panel-token-name">{{ name }}</code>
            <span class="style-guide-panel-token-value">{{ values[i] }}</span>
          </div>
        </div>
      </style-guide-section>
      <style-guide-section
        title="Buttons"
        note="Primary carries the single accent colour of the interface: dark grey on light, light on dark."
      >
        <style-guide-specimen label=".button.primary">
          <button
            type="button"
            class="button primary"
          >Create</button>
        </style-guide-specimen>
        <style-guide-specimen label=".button">
          <button
            type="button"
            class="button"
          >Cancel</button>
        </style-guide-specimen>
        <style-guide-specimen label=".button.ghost">
          <button
            type="button"
            class="button ghost"
          >Later</button>
        </style-guide-specimen>
        <style-guide-specimen label=".button.danger">
          <button
            type="button"
            class="button danger"
          >Delete</button>
        </style-guide-specimen>
        <style-guide-specimen label=":disabled">
          <button
            type="button"
            class="button primary"
            disabled
          >Save</button>
        </style-guide-specimen>
        <style-guide-specimen label=".button.round">
          <button
            type="button"
            class="button round"
          >+</button>
        </style-guide-specimen>
        <style-guide-specimen label=".icon-button">
          <button
            type="button"
            class="icon-button"
            aria-label="Edit"
          >
            <app-icon name="edit"/>
          </button>
        </style-guide-specimen>
        <style-guide-specimen label=".icon-button.is-back">
          <button
            type="button"
            class="icon-button is-back"
            aria-label="Back"
          >
            <app-icon name="arrowLeft"/>
          </button>
        </style-guide-specimen>
      </style-guide-section>
      <style-guide-section
        title="Form fields"
        note="Everything the editor and the settings use."
      >
        <label class="field"><span class="field-label">Name</span>
          <input
            type="text"
            placeholder="e.g. drink water"
          >
        </label>
        <label class="field"><span class="field-label">With hint</span>
          <input
            type="text"
            value="5000"
          >
          <p class="field-hint">Equals 5.0 km.</p>
        </label>
        <label class="field"><span class="field-label">Disabled</span>
          <input
            type="text"
            value="Locked"
            disabled
          >
        </label>
        <style-guide-specimen label=".segmented">
          <div
            class="segmented"
            role="radiogroup"
            aria-label="Kind"
          >
            <label>
              <input
                type="radio"
                :name="'sg-kind-' + theme"
                value="check"
                checked
              >
              <span><app-icon name="check"/>Check</span>
            </label>
            <label>
              <input
                type="radio"
                :name="'sg-kind-' + theme"
                value="count"
              >
              <span><app-icon name="calculator"/>Count</span>
            </label>
            <label>
              <input
                type="radio"
                :name="'sg-kind-' + theme"
                value="time"
              >
              <span><app-icon name="clock"/>Time</span>
            </label>
            <label>
              <input
                type="radio"
                :name="'sg-kind-' + theme"
                value="distance"
              >
              <span><app-icon name="navigation"/>Distance</span>
            </label>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".weekdays">
          <div class="weekdays">
            <button
              v-for="d in weekdays"
              :key="d.name"
              type="button"
              class="weekday"
              :aria-pressed="String(d.picked)"
            >
              {{ d.name }}
            </button>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".app-color-swatches">
          <div
            class="app-color-swatches"
            role="radiogroup"
          >
            <button
              v-for="color in state.colors"
              :key="color"
              type="button"
              class="app-color-swatches-item"
              :style="{'--swatch': colorValue(color)}"
              role="radio"
              :aria-checked="String(color === state.colors[0])"
              :aria-label="color"
            ></button>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".stepper">
          <div class="stepper">
            <button
              type="button"
              class="button round"
            >−</button>
            <input
              type="number"
              value="20"
            >
            <button
              type="button"
              class="button round"
            >+</button>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".switch">
          <label class="switch">
            <input
              type="checkbox"
              checked
            >
            <span>Show archived habits</span>
          </label>
        </style-guide-specimen>
        <style-guide-specimen label=".picker">
          <button
            type="button"
            class="picker"
          >
            <span class="picker-value">Health</span>
          </button>
        </style-guide-specimen>
        <style-guide-specimen label="p.error">
          <p class="error">Please select at least one weekday.</p>
        </style-guide-specimen>
      </style-guide-section>
      <style-guide-section
        title="Board"
        note="Built with the same components as the overview — BoardHeadDay, BoardHabitLabel, BoardDayCell."
      >
        <style-guide-specimen label="BoardHeadDay: today / normal">
          <div class="style-guide-panel-cells"><board-head-day :iso="today"/>
            <board-head-day :iso="yesterday"/>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label="BoardHabitLabel">
          <board-habit-label :habit="s.time"/>
        </style-guide-specimen>
        <style-guide-specimen label="BoardHabitLabel: archived">
          <board-habit-label :habit="s.archived"/>
        </style-guide-specimen>
        <style-guide-specimen
          v-for="[label, habit] in rows"
          :key="label"
          :label="label"
        >
          <div class="style-guide-panel-cells">
            <board-day-cell
              v-for="iso in dates"
              :key="iso"
              :habit="habit"
              :iso="iso"
            />
          </div>
        </style-guide-specimen>
        <style-guide-specimen label="streak levels: none, 1 week … 1 year">
          <div class="style-guide-panel-cells">
            <board-day-cell
              v-for="sample in streaks"
              :key="sample.iso"
              :habit="sample.habit"
              :iso="sample.iso"
            />
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".board-view-month-label">
          <div class="board-view-month-label">September</div>
        </style-guide-specimen>
      </style-guide-section>
      <style-guide-section
        title="Heatmap"
        note="Levels 0–4, then &quot;not scheduled&quot; and the future."
      >
        <style-guide-specimen label="data-level 0 … 4 · is-off · is-future">
          <div class="style-guide-panel-heatmap">
            <div
              v-for="level in [0, 1, 2, 3, 4]"
              :key="level"
              class="heatmap-day"
              :data-level="level"
            ></div>
            <div class="heatmap-day is-off"></div>
            <div class="heatmap-day is-future"></div>
          </div>
        </style-guide-specimen>
      </style-guide-section>
      <style-guide-section
        title="Messages"
        note="In the running app toasts sit at the bottom right; here they stand in the flow."
      >
        <style-guide-specimen label=".toast-list-item">
          <div class="toast-list-item">
            <span class="toast-list-item-text">Habit deleted.</span>
            <button
              type="button"
              class="button"
            >Undo</button>
            <button
              type="button"
              class="icon-button"
              aria-label="Close"
            >&times;</button>
          </div>
        </style-guide-specimen>
        <style-guide-specimen label=".toast-list-item.is-error">
          <div class="toast-list-item is-error">
            <span class="toast-list-item-text">No connection to the
              server.</span>
            <button
              type="button"
              class="icon-button"
              aria-label="Close"
            >&times;</button>
          </div>
        </style-guide-specimen>
      </style-guide-section>
      <style-guide-section
        title="Text"
        note="The type sizes that appear outside the building blocks."
      >
        <style-guide-specimen label="h2"><h2>Heading</h2></style-guide-specimen>
        <style-guide-specimen label=".board-block-title">
          <h2 class="board-block-title">Category</h2>
        </style-guide-specimen>
        <style-guide-specimen label="p">
          <p>Body text, as it appears in empty states.</p>
        </style-guide-specimen>
        <style-guide-specimen label=".habit-meta">
          <span class="habit-meta">20 min · daily</span>
        </style-guide-specimen>
        <style-guide-specimen label=".field-hint">
          <p class="field-hint">A hint below a field.</p>
        </style-guide-specimen>
      </style-guide-section>
    </div>`,
};

/** The style guide: both themes side by side. */
export const TheStyleGuideView = {
  name: 'TheStyleGuideView',
  components: {StyleGuidePanel},
  setup() {
    return {
      names: tokenNames(),
      // The samples are dated relative to today.
      ready: computed(() => Boolean(state.today)),
    };
  },
  template: `
    <header class="style-guide-view-head">
      <h1>Building blocks</h1>
      <p class="style-guide-view-note">Every building block of the application,
        in both themes
        side by side. Not linked — reachable at #/styleguide.</p>
    </header>
    <div
      v-if="ready"
      class="style-guide-view-themes"
    >
      <style-guide-panel
        theme="light"
        :names="names"
      />
      <style-guide-panel
        theme="dark"
        :names="names"
      />
    </div>`,
};
