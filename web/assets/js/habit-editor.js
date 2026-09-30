/**
 * @fileoverview Habit page for creating and editing. It builds the request body
 * and passes it to its caller, and stays open with the error message if saving
 * fails.
 */

import {openCategoryPicker} from './category-picker.js';
import {WEEKDAY_LONG, WEEKDAY_SHORT} from './dates.js';
import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {AppColorSwatches, AppIconChoices, colorValue} from './icons.js';
import {closePage, guardPage, openPage} from './page-stack.js';
import {categoryById, state} from './state.js';
import {errorText} from './toast.js';
import {computed, nextTick, onMounted, reactive, ref, watch} from './vue.js';

/**
 * Each measured kind has its own target and step field, so switching the kind
 * keeps what was typed for the others. Targets are prefilled with a default;
 * an empty step field means the kind's default step. `min` is the smallest
 * target, except for a limit, which may be 0 ("none at all").
 * @const {!Object<string, {defaultTarget: number, min: string, max: string}>}
 */
const KIND_FIELDS = {
  count: {defaultTarget: 8, min: '0.1', max: '1000'},
  time: {defaultTarget: 20, min: '0.1', max: '1440'},
  distance: {defaultTarget: 5, min: '0.001', max: '200'},
};

/**
 * Labels of the target fields, as a target and as a limit.
 * @const {!Object<string, !Array<string>>}
 */
const TARGET_LABELS = {
  count: [t('Daily target'), t('Daily limit')],
  time: [t('Daily target in minutes'), t('Daily limit in minutes')],
  distance: [t('Daily target in km'), t('Daily limit in km')],
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
 * @type {{value: ?Habit}}
 */
const editing = ref(null);

/** The message of a failed save, or "". */
const error = ref('');

/** Whether the input is being saved. */
const busy = ref(false);

/**
 * Saves the input; set when the editor opens.
 * @type {?function(!HabitInput): !Promise<void>}
 */
let onSubmit = null;

/**
 * Creates a category for the category picker; set when the editor opens.
 * @type {?function(string): !Promise<(!Category|undefined)>}
 */
let onCreateCategory = null;

/** The input as opened, to detect unsaved changes. */
let initial = '';

/** Target and frequency as opened, to offer applying a change retroactively. */
let initialSchedule = '';

/**
 * The page, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

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
  const input = {
    name: form.name.trim(),
    color: form.color,
    icon: form.icon,
    kind,
    categoryId: form.categoryId,
    unit: kind === 'count' ? form.unit.trim() : '',
    targetValue: 1,
    targetType: 'at_least',
    frequency: {
      kind: form.freq,
      timesPerWeek: 0,
      timesPerMonth: 0,
      weekdays: 0,
      intervalDays: 0,
      weekInterval: 0,
      weekOfMonth: 0,
      anchorDate: '',
    },
  };

  // Typed values are converted to stored units. An empty step field sends 0,
  // i.e. the kind's default step.
  if (KIND_FIELDS[kind]) {
    const scale = habitHelpers.scale(kind);
    input.targetValue = Math.round(Number(form.targets[kind]) * scale);
    input.stepValue = Math.round(Number(form.steps[kind]) * scale);
    input.targetType = form.targetType;
  }

  const frequency = input.frequency;
  switch (frequency.kind) {
    case 'times_per_week':
      frequency.timesPerWeek = Number(form.timesPerWeek);
      break;
    case 'times_per_month':
      frequency.timesPerMonth = Number(form.timesPerMonth);
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
 * Reports whether to offer applying a changed target or frequency to past
 * days as well. Only when editing, and not when the kind changes, which
 * converts the history anyway.
 * @param {!HabitInput} input
 * @return {boolean}
 */
function offersRetroactive(input) {
  return editing.value !== null && input.kind === editing.value.kind &&
      scheduleKey(input) !== initialSchedule;
}

/**
 * Explains what happens to the recorded days when the kind of a habit with
 * entries changes (domain.ConvertKind), or returns "".
 * @return {string}
 */
function kindHint() {
  const habit = editing.value;
  const kind = form.kind;
  const recorded = habit !== null &&
      (Object.keys(habit.entries ?? {}).length > 0 ||
       (habit.stats?.total ?? 0) > 0);
  if (!recorded || kind === habit.kind) return '';
  if (kind === 'check') {
    return t(
        'Days that reached their target stay ticked; the others are cleared. The recorded values are not kept.');
  }
  if (habit.kind === 'check') return t('Ticked days get the new daily target.');
  return t(
      'Recorded values keep their number in the new unit, e.g. 5 becomes 5 {unit}.',
      {unit: t({time: 'minutes', distance: 'km'}[kind] ?? 'times')});
}

/**
 * Opens the habit page.
 * @param {?Habit} habit the habit to edit, or null to create one
 * @param {function(!HabitInput): !Promise<void>} handler saves the input
 * @param {function(string): !Promise<(!Category|undefined)>} createCategory
 *     creates a category in the category picker
 */
export async function openEditor(habit, handler, createCategory) {
  onSubmit = handler;
  onCreateCategory = createCategory;
  editing.value = habit;
  const schedule = habit ? habitHelpers.currentSchedule(habit) : null;

  form.name = habit?.name ?? '';
  form.color = habit?.color ?? state.colors[0];
  form.icon = habit?.icon ?? '';
  form.categoryId = habit?.categoryId ?? '';
  form.kind = habit?.kind ?? 'check';
  form.targetType = schedule?.targetType === 'at_most' ? 'at_most' : 'at_least';
  for (const [kind, fields] of Object.entries(KIND_FIELDS)) {
    const scale = habitHelpers.scale(kind);
    const own = habit?.kind === kind;
    form.targets[kind] =
        own ? schedule.targetValue / scale : fields.defaultTarget;
    form.steps[kind] = own && habit.stepValue ? habit.stepValue / scale : '';
  }
  form.unit = habit?.kind === 'count' ? habit.unit : '';

  const freq = schedule?.frequency ?? {kind: 'daily'};
  form.freq = freq.kind;
  form.timesPerWeek = freq.timesPerWeek || 3;
  form.timesPerMonth = freq.timesPerMonth || 2;
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
  await nextTick();
  error.value = '';
  openPage(dialog);
  dialog.querySelector('input[name="name"]').focus();
}

/** The habit page (see openEditor). */
export const TheHabitEditor = {
  name: 'TheHabitEditor',
  components: {AppColorSwatches, AppIconChoices},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const el = ref(null);
    const formEl = ref(null);
    const errorEl = ref(null);

    onMounted(() => {
      dialog = el.value;
      guardPage(dialog, () => JSON.stringify(collect()) !== initial);
    });

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
      error.value = '';
    }, {deep: true});

    /**
     * Shows an error message; it may be outside the visible area.
     * @param {string} message
     */
    const showError = async (message) => {
      error.value = message;
      await nextTick();
      errorEl.value?.scrollIntoView({block: 'nearest'});
    };

    /**
     * Saves the input and closes the editor, or shows why it failed. The page
     * stays open until the server accepts the input.
     */
    const submit = async () => {
      if (!formEl.value.reportValidity()) return;
      const input = collect();
      if (input.frequency.kind === 'weekdays' &&
          input.frequency.weekdays === 0) {
        showError(t('Please select at least one weekday.'));
        return;
      }
      busy.value = true;
      try {
        await onSubmit(input);
        closePage(dialog, {force: true});
      } catch (err) {
        showError(errorText(err));
      } finally {
        busy.value = false;
      }
    };

    /** Lets the user choose the category on the picker page. */
    const chooseCategory = async () => {
      // null means the picker was cancelled.
      const chosen =
          await openCategoryPicker(form.categoryId, onCreateCategory);
      if (chosen !== null) form.categoryId = chosen;
    };

    const category =
        computed(() => form.categoryId ? categoryById(form.categoryId) : null);
    // A deleted category is shown as such.
    const categoryName = computed(() => {
      if (!form.categoryId) return t('No category');
      return category.value?.name ?? t('Deleted category');
    });

    return {
      el,
      formEl,
      errorEl,
      form,
      state,
      editing,
      error,
      busy,
      limit,
      retroactive,
      kindHint: computed(kindHint),
      category,
      categoryName,
      countsDays,
      KINDS,
      FREQUENCIES,
      KIND_FIELDS,
      WEEKDAY_SHORT,
      WEEKDAY_LONG,
      colorValue,
      targetLabel: (kind) => TARGET_LABELS[kind][limit.value ? 1 : 0],
      submit,
      chooseCategory,
    };
  },
  // On wide screens the page floats as a dialog (is-floating). Only the
  // fields of the chosen kind and frequency are shown. The icons are drawn in
  // the chosen colour.
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
            type="button"
            class="icon-button"
            data-page-back
            :title="t('Close')"
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
                :class="{'is-empty': !form.categoryId}"
              >
                {{ categoryName }}
              </span>
              <span class="picker-caret"><app-icon name="chevron"/></span>
            </button>
          </div>
          <fieldset class="field">
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
            <p
              v-if="kindHint"
              class="field-hint"
            >
              {{ kindHint }}
            </p>
          </fieldset>
          <!-- A target to reach or a limit to stay within, for measured
               kinds. -->
          <fieldset
            v-if="form.kind !== 'check'"
            class="field"
          >
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
            <p
              v-if="limit"
              class="field-hint"
            >
              {{ t('A limit is kept on every due day that stays within it, days without an entry included. It needs fixed days, not a number per week or month.') }}
            </p>
          </fieldset>
          <div
            v-if="form.kind === 'count'"
            class="field row"
          >
            <label class="grow">
              <span class="field-label">{{ targetLabel('count') }}</span>
              <input
                v-model="form.targets.count"
                name="targetCount"
                type="number"
                :min="limit ? '0' : KIND_FIELDS.count.min"
                max="1000"
                step="any"
                inputmode="decimal"
              >
            </label>
            <label class="grow">
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
          </div>
          <div
            v-if="form.kind === 'count'"
            class="field"
          >
            <label>
              <span class="field-label">{{ t('Step') }}</span>
              <input
                v-model="form.steps.count"
                name="stepCount"
                type="number"
                min="0.1"
                max="1000"
                step="any"
                :placeholder="t('e.g. 1')"
                inputmode="decimal"
              >
            </label>
            <p class="field-hint">
              {{ t('A click on a day changes the entry by this much.') }}
            </p>
          </div>
          <div
            v-if="form.kind === 'time'"
            class="field"
          >
            <div class="field-row">
              <label class="grow">
                <span class="field-label">{{ targetLabel('time') }}</span>
                <input
                  v-model="form.targets.time"
                  name="targetTime"
                  type="number"
                  :min="limit ? '0' : KIND_FIELDS.time.min"
                  max="1440"
                  step="any"
                  inputmode="decimal"
                >
              </label>
              <label class="grow">
                <span class="field-label">{{ t('Step in minutes') }}</span>
                <input
                  v-model="form.steps.time"
                  name="stepTime"
                  type="number"
                  min="0.1"
                  max="1440"
                  step="any"
                  :placeholder="t('e.g. 5')"
                  inputmode="decimal"
                >
              </label>
            </div>
            <p class="field-hint">
              {{ t('A click on a day changes the entry by this much.') }}
            </p>
          </div>
          <div
            v-if="form.kind === 'distance'"
            class="field"
          >
            <!-- step="any" allows any decimal value. -->
            <div class="field-row">
              <label class="grow">
                <span class="field-label">{{ targetLabel('distance') }}</span>
                <input
                  v-model="form.targets.distance"
                  name="targetDistance"
                  type="number"
                  :min="limit ? '0' : KIND_FIELDS.distance.min"
                  max="200"
                  step="any"
                  inputmode="decimal"
                >
              </label>
              <label class="grow">
                <span class="field-label">{{ t('Step in km') }}</span>
                <input
                  v-model="form.steps.distance"
                  name="stepDistance"
                  type="number"
                  min="0.001"
                  max="200"
                  step="any"
                  :placeholder="t('e.g. 0.5')"
                  inputmode="decimal"
                >
              </label>
            </div>
            <p class="field-hint">
              {{ t('A click on a day changes the entry by this much.') }}
            </p>
          </div>
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
            <p class="field-hint">
              {{ t('The week starts on Monday. Which days you pick is up to you.') }}
            </p>
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
            <p class="field-hint">
              {{ t('Counted per calendar month. Which days you pick is up to you.') }}
            </p>
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
            <p class="field-hint">
              {{ t('Off, the new target and frequency apply from today on. Past days keep the ones they had.') }}
            </p>
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
