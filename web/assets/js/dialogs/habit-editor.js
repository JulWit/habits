/**
 * @fileoverview Habit page for creating and editing. It saves the input
 * through actions.js and stays open with the error message if saving fails.
 */

import * as actions from '../data/actions.js';
import * as habitHelpers from '../data/habit-helpers.js';
import {categoryById, state} from '../data/state.js';
import {AppColorSwatches, AppIconChoices, colorValue} from '../ui/icons.js';
import {createPage} from '../ui/page-stack.js';
import {WEEKDAY_LONG, WEEKDAY_SHORT} from '../util/dates.js';
import {t} from '../util/i18n.js';
import {computed, reactive, ref, shallowRef, watch} from '../vue.js';

import {openCategoryPicker} from './category-picker.js';

/** @import {Frequency, Habit, HabitInput} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */

/**
 * A measured kind as the form shows it: its default target in input units,
 * the labels of its target as a target and as a limit, the label and
 * placeholder of its step, and the suffix of its fields' names.
 * @typedef {{
 *   target: number,
 *   targetLabels: !Array<string>,
 *   stepLabel: string,
 *   stepPlaceholder: string,
 *   name: string,
 * }}
 */
let MeasuredKind;

/**
 * The measured kinds. Each has its own target and step field, so switching
 * the kind keeps what was typed for the others; an empty step field means the
 * kind's default step.
 * @const {!Object<string, !MeasuredKind>}
 */
const MEASURED_KINDS = {
  count: {
    target: 8,
    targetLabels: [t('Daily target'), t('Daily limit')],
    stepLabel: t('Step'),
    stepPlaceholder: t('e.g. 1'),
    name: 'Count',
  },
  time: {
    target: 20,
    targetLabels: [t('Daily target in minutes'), t('Daily limit in minutes')],
    stepLabel: t('Step in minutes'),
    stepPlaceholder: t('e.g. 5'),
    name: 'Time',
  },
  distance: {
    target: 5,
    targetLabels: [t('Daily target in km'), t('Daily limit in km')],
    stepLabel: t('Step in km'),
    stepPlaceholder: t('e.g. 0.5'),
    name: 'Distance',
  },
};

/**
 * Returns the range of a target or step of `kind` in input units, from the
 * server's description of the kind (state.kinds): one stored unit up to the
 * kind's maximum. A limit may also be 0 ("none at all").
 * @param {string} kind
 * @return {{min: string, max: string}}
 */
function bounds(kind) {
  const {scale, max} = state.kinds[kind];
  return {min: String(1 / scale), max: String(max / scale)};
}

/**
 * The frequency of a new habit.
 * @const {!Frequency}
 */
const DAILY = {
  kind: 'daily',
  timesPerWeek: 0,
  timesPerMonth: 0,
  timesAtMost: false,
  weekdays: 0,
  intervalDays: 0,
  weekInterval: 0,
  weekOfMonth: 0,
  anchorDate: '',
};

/**
 * The frequencies to choose from.
 * @const {!Array<{value: string, label: string}>}
 */
const FREQUENCIES = [
  {value: 'daily', label: t('Daily')},
  {value: 'times_per_week', label: t('Times per week')},
  {value: 'times_per_month', label: t('Times per month')},
  {value: 'weekdays', label: t('Weekdays')},
  {value: 'custom_interval', label: t('Custom interval')},
];

/**
 * The kinds to choose from, with their icons.
 * @const {!Array<{value: string, label: string, icon: string}>}
 */
const KINDS = [
  {value: 'check', label: t('Check'), icon: 'check'},
  {value: 'count', label: t('Count'), icon: 'calculator'},
  {value: 'time', label: t('Time'), icon: 'clock'},
  {value: 'distance', label: t('Distance'), icon: 'navigation'},
];

/**
 * The input of the form as the fields hold it; numbers are kept as typed.
 * `targets` and `steps` hold a field per measured kind.
 * @const {{
 *   name: string,
 *   color: string,
 *   icon: string,
 *   categoryId: string,
 *   kind: string,
 *   targetType: string,
 *   targets: !Object<string, (number|string)>,
 *   steps: !Object<string, (number|string)>,
 *   unit: string,
 *   freq: string,
 *   timesPerWeek: (number|string),
 *   timesPerMonth: (number|string),
 *   timesAtMost: boolean,
 *   weekdays: !Array<boolean>,
 *   weekRepeat: string,
 *   weekInterval: (number|string),
 *   weekAnchorDate: string,
 *   weekOfMonth: string,
 *   intervalDays: (number|string),
 *   anchorDate: string,
 *   retroactive: boolean,
 * }}
 */
const form = reactive({
  name: '',
  color: '',
  icon: '',
  categoryId: '',
  kind: 'check',
  targetType: 'at_least',
  targets: {count: '', time: '', distance: ''},
  steps: {count: '', time: '', distance: ''},
  unit: '',
  freq: 'daily',
  timesPerWeek: 3,
  timesPerMonth: 2,
  timesAtMost: false,
  weekdays: [false, false, false, false, false, false, false],
  weekRepeat: 'weekly',
  weekInterval: 4,
  weekAnchorDate: '',
  weekOfMonth: '1',
  intervalDays: 3,
  anchorDate: '',
  retroactive: false,
});

/**
 * The habit being edited, or null when creating one.
 * @type {!Ref<?Habit>}
 */
const editing = shallowRef(null);

/** The input as opened, to detect unsaved changes. */
let initial = '';

/** Target and frequency as opened, to offer applying a change retroactively. */
let initialSchedule = '';

/** The page; it asks before closing with unsaved changes. */
const page = createPage({dirty: () => JSON.stringify(collect()) !== initial});

/**
 * The name field, focused when the page opens.
 * @type {!Ref<?HTMLInputElement>}
 */
const nameInput = shallowRef(null);

/**
 * Reports whether the target is a limit (at most) of a measured kind. A limit
 * needs fixed days, so the frequencies counting days per week or month are
 * off.
 * @return {boolean}
 */
function isLimit() {
  return form.kind !== 'check' && form.targetType === 'at_most';
}

/**
 * Reports whether a frequency counts days per week or month, which a limit
 * cannot use.
 * @param {string} freq
 * @return {boolean}
 */
function countsDays(freq) {
  return freq === 'times_per_week' || freq === 'times_per_month';
}

/**
 * Returns the input of the form, as the API takes it.
 * @return {!HabitInput}
 */
function collect() {
  const kind = form.kind;
  /** @type {!HabitInput} */
  const input = {
    name: form.name.trim(),
    color: form.color,
    icon: form.icon,
    kind,
    // A category deleted meanwhile, e.g. on another device, is left: the
    // server would reject it.
    categoryId: categoryById(form.categoryId) ? form.categoryId : '',
    unit: kind === 'count' ? form.unit.trim() : '',
    targetValue: 1,
    targetType: 'at_least',
    stepValue: undefined,
    frequency: {
      kind: form.freq,
      timesPerWeek: 0,
      timesPerMonth: 0,
      timesAtMost: false,
      weekdays: 0,
      intervalDays: 0,
      weekInterval: 0,
      weekOfMonth: 0,
      anchorDate: '',
    },
    retroactive: undefined,
  };

  // Typed values are converted to stored units. An empty step field sends 0,
  // i.e. the kind's default step.
  if (kind in MEASURED_KINDS) {
    const scale = habitHelpers.scale(kind);
    input.targetValue = Math.round(Number(form.targets[kind]) * scale);
    input.stepValue = Math.round(Number(form.steps[kind]) * scale);
    input.targetType = form.targetType;
  }

  const frequency = input.frequency;
  switch (frequency.kind) {
    case 'times_per_week':
      frequency.timesPerWeek = Number(form.timesPerWeek);
      frequency.timesAtMost = form.timesAtMost;
      break;
    case 'times_per_month':
      frequency.timesPerMonth = Number(form.timesPerMonth);
      frequency.timesAtMost = form.timesAtMost;
      break;
    case 'weekdays': {
      frequency.weekdays = form.weekdays.reduce(
          (mask, on, i) => (on ? mask | (1 << i) : mask), 0);
      const repeat = form.weekRepeat;
      frequency.weekInterval =
          repeat === 'interval' ? Number(form.weekInterval) : 1;
      frequency.weekOfMonth =
          repeat === 'monthly' ? Number(form.weekOfMonth) : 0;
      if (repeat === 'interval') {
        frequency.anchorDate = form.weekAnchorDate || state.today;
      }
      break;
    }
    case 'custom_interval':
      frequency.intervalDays = Number(form.intervalDays);
      frequency.anchorDate = form.anchorDate || state.today;
      break;
    // 'daily' needs no further fields.
    default:
      break;
  }

  // Only sent when the switch is offered, i.e. when editing a schedule.
  if (offersRetroactive(input)) input.retroactive = form.retroactive;
  return input;
}

/**
 * Returns the part of the input that makes up the schedule.
 * @param {!HabitInput} input
 * @return {string}
 */
function scheduleKey(input) {
  return JSON.stringify(
      [input.kind, input.targetValue, input.targetType, input.frequency]);
}

/**
 * Reports whether to offer applying the target and frequency to past days as
 * well: when they changed, or when an earlier change left past days with a
 * schedule of their own. Only when editing.
 * @param {!HabitInput} input
 * @return {boolean}
 */
function offersRetroactive(input) {
  const habit = editing.value;
  if (habit === null) return false;
  return scheduleKey(input) !== initialSchedule || habit.schedules.length > 1;
}

/**
 * Opens the habit page and saves what it sends: a change of `habit`, or a new
 * habit for null.
 * @param {?Habit} habit
 * @return {!Promise<*>} resolves once the page is closed
 */
export function openHabitEditor(habit) {
  editing.value = habit;
  const schedule = habit ? habitHelpers.currentSchedule(habit) : null;

  form.name = habit?.name ?? '';
  form.color = habit?.color ?? state.colors[0];
  form.icon = habit?.icon ?? '';
  form.categoryId = habit?.categoryId ?? '';
  form.kind = habit?.kind ?? 'check';
  form.targetType = schedule?.targetType === 'at_most' ? 'at_most' : 'at_least';
  for (const [kind, measured] of Object.entries(MEASURED_KINDS)) {
    const scale = habitHelpers.scale(kind);
    const own = habit?.kind === kind && schedule !== null;
    form.targets[kind] = own ? schedule.targetValue / scale : measured.target;
    form.steps[kind] = own && habit.stepValue ? habit.stepValue / scale : '';
  }
  form.unit = habit?.kind === 'count' ? habit.unit : '';

  const freq = schedule?.frequency ?? DAILY;
  form.freq = freq.kind;
  form.timesPerWeek = freq.timesPerWeek || 3;
  form.timesPerMonth = freq.timesPerMonth || 2;
  form.timesAtMost = freq.timesAtMost ?? false;
  form.intervalDays = freq.intervalDays || 3;
  form.anchorDate = freq.anchorDate || state.today;
  form.weekdays =
      form.weekdays.map((_, i) => ((freq.weekdays || 0) & (1 << i)) !== 0);

  // Weekday schedules repeat every week, every n-th week, or in one week of
  // the month.
  form.weekRepeat = 'weekly';
  form.weekInterval = 4;
  form.weekOfMonth = '1';
  form.weekAnchorDate = state.today;
  if (freq.kind === 'weekdays' && freq.weekOfMonth) {
    form.weekRepeat = 'monthly';
    form.weekOfMonth = String(freq.weekOfMonth);
  } else if (freq.kind === 'weekdays' && freq.weekInterval > 1) {
    form.weekRepeat = 'interval';
    form.weekInterval = freq.weekInterval;
    form.weekAnchorDate = freq.anchorDate || state.today;
  }
  form.retroactive = false;

  initialSchedule = scheduleKey(collect());
  initial = JSON.stringify(collect());
  return page.open(() => nameInput.value?.focus());
}

/** The habit page (see openHabitEditor). */
export const TheHabitEditor = {
  name: 'TheHabitEditor',
  components: {AppColorSwatches, AppIconChoices},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!Ref<?HTMLFormElement>} */
    const formEl = ref(null);

    const limit = computed(isLimit);
    // A limit leaves the frequencies with fixed days.
    watch(limit, (on) => {
      if (on && countsDays(form.freq)) form.freq = 'daily';
    });
    const retroactive = computed(() => offersRetroactive(collect()));
    watch(retroactive, (offered) => {
      if (!offered) form.retroactive = false;
    });
    // Any change of the input hides the error message.
    watch(form, () => {
      page.error.value = '';
    }, {deep: true});

    /**
     * Saves the input and closes the editor, or shows why it failed. The page
     * stays open until the server accepts the input.
     */
    const submit = () => {
      if (!formEl.value?.reportValidity()) return;
      const input = collect();
      if (input.frequency.kind === 'weekdays' &&
          input.frequency.weekdays === 0) {
        page.fail(t('Please select at least one weekday.'));
        return;
      }
      const habit = editing.value;
      page.run(
          () => habit ? actions.updateHabit(habit.id, input) :
                        actions.createHabit(input));
    };

    /** Lets the user choose the category on the picker page. */
    const chooseCategory = async () => {
      // null means the picker was cancelled.
      const chosen = await openCategoryPicker(form.categoryId);
      if (chosen !== null) form.categoryId = chosen;
    };

    const category = computed(() => categoryById(form.categoryId));
    // The fields of the chosen measured kind, null for a check.
    const measured = computed(() => MEASURED_KINDS[form.kind] ?? null);

    return {
      el: page.el,
      errorEl: page.errorEl,
      error: page.error,
      busy: page.busy,
      nameInput,
      formEl,
      form,
      state,
      editing,
      limit,
      retroactive,
      category,
      categoryName: computed(() => category.value?.name ?? t('No category')),
      measured,
      // The range of the chosen kind's target and step, in input units.
      range: computed(() => (measured.value ? bounds(form.kind) : null)),
      targetLabel: computed(
          () => measured.value?.targetLabels[limit.value ? 1 : 0] ?? ''),
      countsDays,
      KINDS,
      FREQUENCIES,
      WEEKDAY_SHORT,
      WEEKDAY_LONG,
      colorValue,
      submit,
      chooseCategory,
    };
  },
  // On wide screens the page floats as a dialog (is-floating). Only the
  // fields of the chosen kind and frequency are shown. The icons are drawn in
  // the chosen colour. A count has a unit beside its target and its step
  // below; time and distance have their step beside the target.
  template: `
    <dialog
      id="habit-editor"
      ref="el"
      class="dialog page is-sheet is-floating"
      aria-labelledby="habit-editor-title"
    >
      <form
        ref="formEl"
        method="dialog"
        @submit.prevent="submit"
      >
        <header class="page-head">
          <button
            v-tooltip="t('Close')"
            type="button"
            class="icon-button"
            data-page-back
            :aria-label="t('Close')"
          >
            <app-icon name="close"/>
          </button>
          <h2 id="habit-editor-title">
            {{ editing ? t('Edit habit') : t('New habit') }}
          </h2>
          <button
            type="submit"
            class="button primary"
            :disabled="busy"
          >
            {{ editing ? t('Save') : t('Create') }}
          </button>
        </header>
        <div class="page-body">
          <label class="field">
            <span class="field-label">{{ t('Name') }}</span>
            <input
              ref="nameInput"
              v-model="form.name"
              name="name"
              type="text"
              maxlength="80"
              required
              autocomplete="off"
              :placeholder="t('e.g. drink water')"
            >
          </label>
          <fieldset class="field">
            <legend class="field-label">{{ t('Colour') }}</legend>
            <app-color-swatches
              v-model="form.color"
              :colors="state.colors"
            />
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">{{ t('Icon') }}</legend>
            <app-icon-choices
              v-model="form.icon"
              :names="state.icons"
              :style="{'--habit-color': colorValue(form.color)}"
            />
          </fieldset>
          <div class="field">
            <span
              id="habit-editor-category-label"
              class="field-label"
            >
              {{ t('Category') }}
            </span>
            <!-- Labelled by the field label and its own text. -->
            <button
              id="habit-editor-category"
              type="button"
              class="picker"
              aria-haspopup="dialog"
              aria-labelledby="habit-editor-category-label
                habit-editor-category"
              @click="chooseCategory"
            >
              <app-icon-badge
                v-if="category"
                class="habit-icon is-small"
                :icon="category.icon"
                :color="category.color || null"
              />
              <span
                class="picker-value"
                :class="{'is-empty': !category}"
              >
                {{ categoryName }}
              </span>
              <span class="picker-caret"><app-icon name="chevron"/></span>
            </button>
          </div>
          <!-- The kind is chosen once, when the habit is created. -->
          <fieldset
            v-if="!editing"
            class="field"
          >
            <legend class="field-label">{{ t('Kind') }}</legend>
            <div
              class="segmented"
              role="radiogroup"
              :aria-label="t('Kind')"
            >
              <label
                v-for="kind in KINDS"
                :key="kind.value"
              >
                <input
                  v-model="form.kind"
                  type="radio"
                  name="kind"
                  :value="kind.value"
                >
                <span><app-icon :name="kind.icon"/>{{ kind.label }}</span>
              </label>
            </div>
          </fieldset>
          <template v-if="measured">
            <!-- A target to reach or a limit to stay within. -->
            <fieldset class="field">
              <legend class="field-label">{{ t('Goal') }}</legend>
              <div
                class="segmented"
                role="radiogroup"
                :aria-label="t('Goal')"
              >
                <label>
                  <input
                    v-model="form.targetType"
                    type="radio"
                    name="targetType"
                    value="at_least"
                  >
                  <span>{{ t('At least') }}</span>
                </label>
                <label>
                  <input
                    v-model="form.targetType"
                    type="radio"
                    name="targetType"
                    value="at_most"
                  >
                  <span>{{ t('At most') }}</span>
                </label>
              </div>
            </fieldset>
            <!-- step="any" allows any decimal value. -->
            <div
              :key="form.kind"
              class="field row"
            >
              <label class="grow">
                <span class="field-label">{{ targetLabel }}</span>
                <input
                  v-model="form.targets[form.kind]"
                  :name="'target' + measured.name"
                  type="number"
                  :min="limit ? '0' : range.min"
                  :max="range.max"
                  step="any"
                  inputmode="decimal"
                >
              </label>
              <label
                v-if="form.kind === 'count'"
                class="grow"
              >
                <span class="field-label">{{ t('Unit') }}</span>
                <input
                  v-model="form.unit"
                  name="unit"
                  type="text"
                  maxlength="16"
                  :placeholder="t('e.g. glasses')"
                  autocomplete="off"
                >
              </label>
              <label
                v-else
                class="grow"
              >
                <span class="field-label">{{ measured.stepLabel }}</span>
                <input
                  v-model="form.steps[form.kind]"
                  :name="'step' + measured.name"
                  type="number"
                  :min="range.min"
                  :max="range.max"
                  step="any"
                  :placeholder="measured.stepPlaceholder"
                  inputmode="decimal"
                >
              </label>
            </div>
            <div
              v-if="form.kind === 'count'"
              class="field"
            >
              <label>
                <span class="field-label">{{ measured.stepLabel }}</span>
                <input
                  v-model="form.steps.count"
                  name="stepCount"
                  type="number"
                  :min="range.min"
                  :max="range.max"
                  step="any"
                  :placeholder="measured.stepPlaceholder"
                  inputmode="decimal"
                >
              </label>
            </div>
          </template>
          <fieldset class="field">
            <legend class="field-label">{{ t('Frequency') }}</legend>
            <div
              class="segmented wrap"
              role="radiogroup"
              :aria-label="t('Frequency')"
            >
              <label
                v-for="freq in FREQUENCIES"
                :key="freq.value"
              >
                <input
                  v-model="form.freq"
                  type="radio"
                  name="freq"
                  :value="freq.value"
                  :disabled="limit && countsDays(freq.value)"
                >
                <span>{{ freq.label }}</span>
              </label>
            </div>
          </fieldset>
          <!-- The number of days per week or month as a minimum, with further
               days as a bonus, or exactly that many. -->
          <fieldset
            v-if="countsDays(form.freq)"
            class="field"
          >
            <legend class="field-label">{{ t('Number of days') }}</legend>
            <div
              class="segmented"
              role="radiogroup"
              :aria-label="t('Number of days')"
            >
              <label>
                <input
                  v-model="form.timesAtMost"
                  type="radio"
                  name="timesAtMost"
                  :value="false"
                >
                <span>{{ t('At least') }}</span>
              </label>
              <label>
                <input
                  v-model="form.timesAtMost"
                  type="radio"
                  name="timesAtMost"
                  :value="true"
                >
                <span>{{ t('Exactly') }}</span>
              </label>
            </div>
          </fieldset>
          <div
            v-if="form.freq === 'times_per_week'"
            class="field"
          >
            <label>
              <span class="field-label">{{ t('How many times per week') }}
              </span>
              <input
                v-model="form.timesPerWeek"
                name="timesPerWeek"
                type="number"
                min="1"
                max="7"
                step="1"
                inputmode="numeric"
              >
            </label>
          </div>
          <div
            v-if="form.freq === 'times_per_month'"
            class="field"
          >
            <label>
              <span class="field-label">{{ t('How many times per month') }}
              </span>
              <input
                v-model="form.timesPerMonth"
                name="timesPerMonth"
                type="number"
                min="1"
                max="28"
                step="1"
                inputmode="numeric"
              >
            </label>
          </div>
          <template v-if="form.freq === 'weekdays'">
            <div class="field">
              <span
                id="habit-editor-weekdays-label"
                class="field-label"
              >
                {{ t('On these days') }}
              </span>
              <div
                class="weekdays"
                role="group"
                aria-labelledby="habit-editor-weekdays-label"
              >
                <button
                  v-for="(label, i) in WEEKDAY_SHORT"
                  :key="i"
                  type="button"
                  class="weekday"
                  :aria-pressed="String(form.weekdays[i])"
                  :aria-label="WEEKDAY_LONG[i]"
                  @click="form.weekdays[i] = !form.weekdays[i]"
                >
                  {{ label }}
                </button>
              </div>
            </div>
            <div class="field">
              <label>
                <span class="field-label">{{ t('Repeat') }}</span>
                <select
                  v-model="form.weekRepeat"
                  name="weekRepeat"
                  class="select"
                  autocomplete="off"
                >
                  <option value="weekly">{{ t('Every week') }}</option>
                  <option value="interval">{{ t('Every few weeks') }}</option>
                  <option value="monthly">{{ t('Once a month') }}</option>
                </select>
              </label>
            </div>
            <div
              v-if="form.weekRepeat === 'interval'"
              class="field row"
            >
              <label class="grow">
                <span class="field-label">{{ t('Every … weeks') }}</span>
                <input
                  v-model="form.weekInterval"
                  name="weekInterval"
                  type="number"
                  min="2"
                  max="52"
                  step="1"
                  inputmode="numeric"
                >
              </label>
              <label class="grow">
                <span class="field-label">{{ t('Starting on') }}</span>
                <input
                  v-model="form.weekAnchorDate"
                  name="weekAnchorDate"
                  type="date"
                >
              </label>
            </div>
            <div
              v-if="form.weekRepeat === 'monthly'"
              class="field"
            >
              <label>
                <span class="field-label">{{ t('Which one in the month') }}
                </span>
                <select
                  v-model="form.weekOfMonth"
                  name="weekOfMonth"
                  class="select"
                  autocomplete="off"
                >
                  <option value="1">{{ t('First') }}</option>
                  <option value="2">{{ t('Second') }}</option>
                  <option value="3">{{ t('Third') }}</option>
                  <option value="4">{{ t('Fourth') }}</option>
                  <option value="-1">{{ t('Last') }}</option>
                </select>
              </label>
              <p class="field-hint">
                {{ t('First and Monday means the first Monday of every month.') }}
              </p>
            </div>
          </template>
          <div
            v-if="form.freq === 'custom_interval'"
            class="field row"
          >
            <label class="grow">
              <span class="field-label">{{ t('Every … days') }}</span>
              <input
                v-model="form.intervalDays"
                name="intervalDays"
                type="number"
                min="1"
                max="365"
                step="1"
                inputmode="numeric"
              >
            </label>
            <label class="grow">
              <span class="field-label">{{ t('Starting on') }}</span>
              <input
                v-model="form.anchorDate"
                name="anchorDate"
                type="date"
              >
            </label>
          </div>
          <div
            v-if="retroactive"
            class="field"
          >
            <label class="switch">
              <input
                v-model="form.retroactive"
                type="checkbox"
                name="retroactive"
                autocomplete="off"
              >
              <span>{{ t('Apply to past days as well') }}</span>
            </label>
          </div>
          <p
            v-if="error"
            ref="errorEl"
            class="error"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
      </form>
    </dialog>`,
};
