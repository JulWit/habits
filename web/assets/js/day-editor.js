// Day dialog, opened by a long press or right-click on a day cell: the value
// (or for a check habit whether it is done) and whether the day is skipped.
// It passes only what changed to its caller.

import {formatRelative} from './dates.js';
import * as habitHelpers from './habit-helpers.js';
import {locale, t} from './i18n.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText, toast} from './undo.js';
import {computed, nextTick, onMounted, reactive, ref} from './vue.js';

/**
 * A change of a day's entry: the parts that differ.
 * @typedef {{value: (number|undefined), skipped: (boolean|undefined)}}
 */
let EntryChange;

/**
 * Quick buttons per kind, in input units. They are fixed values, independent
 * of the habit's step. KindCheck has none.
 * @const {!Object<string, !Array<number>>}
 */
const QUICK_JUMPS = {
  count: [5, 10],
  time: [5, 15],
  distance: [0.5, 1],
};

/**
 * The dialog's content: the habit and day as it opened, and the input.
 * `value` is in input units, as typed; `scale` is the number of stored units
 * per input unit (see scale in habit-helpers.js), `step` the habit's step and
 * `max` the kind's maximum, in input units.
 */
const day = reactive({
  habit: null,
  iso: '',
  before: {value: 0, skipped: false},
  value: '',
  done: false,
  skipped: false,
  scale: 1,
  step: 1,
  max: 1,
});

/**
 * Saves the change; set when the dialog opens.
 * @type {?function(!EntryChange): !Promise<void>}
 */
let onSave = null;

/**
 * The dialog, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

/**
 * Opens the day dialog. `handler` receives the change ({value?, skipped?})
 * with the parts that differ from the entry as it was.
 * @param {!Habit} habit
 * @param {string} iso
 * @param {function(!EntryChange): !Promise<void>} handler
 */
export async function openDayDialog(habit, iso, handler) {
  onSave = handler;
  const before = habitHelpers.entryOn(habit, iso);
  const scale = habitHelpers.scale(habit.kind);
  Object.assign(day, {
    habit,
    iso,
    before,
    scale,
    step: habitHelpers.step(habit) / scale,
    max: habitHelpers.maxValue(habit) / scale,
    value: String(before.value / scale),
    done: before.value > 0,
    skipped: before.skipped,
  });
  await nextTick();

  openPage(dialog);
  // The first control that can be used.
  if (before.skipped) {
    dialog.querySelector('input[name="skipped"]').focus();
  } else if (habit.kind === 'check') {
    dialog.querySelector('input[name="done"]').focus();
  } else {
    dialog.querySelector('input[name="value"]').select();
  }
}

/**
 * Returns the entry as entered.
 * @return {!Entry}
 */
function collect() {
  let value = day.habit.kind === 'check' ?
      (day.done ? 1 : 0) :
      Math.max(0, Math.round((Number(day.value) || 0) * day.scale));
  if (day.skipped) value = 0;
  return {value, skipped: day.skipped};
}

/**
 * Passes the parts of `entry` that differ from the entry as it was to the
 * handler, and closes the dialog. A value is only sent for a day that is not
 * skipped, as a skip clears it anyway.
 * @param {!Entry} entry
 * @return {!Promise<void>}
 */
async function submit(entry) {
  const change = {};
  if (entry.skipped !== day.before.skipped) change.skipped = entry.skipped;
  if (!entry.skipped && entry.value !== day.before.value) {
    change.value = entry.value;
  }

  const handler = onSave;
  closePage(dialog, {force: true});
  if (Object.keys(change).length === 0) return;
  try {
    await handler(change);
  } catch (err) {
    toast(errorText(err), {error: true});
  }
}

/**
 * Returns the hint below the stepper: the target of the day (or the limit),
 * and the step if not 1.
 * @return {string}
 */
function hint() {
  const {habit, iso, step} = day;
  const amount =
      habitHelpers.formatValue(habit, habitHelpers.target(habit, iso));
  const goal = habitHelpers.isLimit(habit, iso) ?
      t('Daily limit: {target}', {target: amount}) :
      t('Daily target: {target}', {target: amount});
  // A step of 1 is not shown for counts.
  if (habit.kind === 'count' && step === 1) return goal;

  // The step is shown in input units.
  const unit = {distance: ' km', time: ' min'}[habit.kind] ?? '';
  return t(
      '{goal} · step: {step}',
      {goal, step: `${step.toLocaleString(locale)}${unit}`});
}

/** The day dialog (see openDayDialog). */
export const DayEditor = {
  name: 'DayEditor',
  setup() {
    const el = ref(null);
    const input = ref(null);
    onMounted(() => {
      dialog = el.value;
    });

    /**
     * Sets the value, clamped to the kind's range and rounded to stored-unit
     * precision to avoid floating-point artefacts.
     * @param {number} next in input units
     */
    const setValue = (next) => {
      const inRange = Math.min(day.max, Math.max(0, next));
      day.value = String(Math.round(inRange * day.scale) / day.scale);
      input.value.focus();
    };

    const check = computed(() => day.habit?.kind === 'check');
    const unit = computed(
        () => day.habit?.kind === 'distance' ?
            'km' :
            habitHelpers.unitLabel(day.habit));

    return {
      el,
      input,
      day,
      check,
      title: computed(
          () => day.habit ?
              `${day.habit.name} — ${formatRelative(day.iso, state.today)}` :
              ''),
      hint: computed(() => (day.habit ? hint() : '')),
      // The value's accessible name names its unit.
      valueLabel: computed(
          () => day.habit && habitHelpers.unitLabel(day.habit) ?
              t('Value in {unit}', {unit: unit.value}) :
              t('Value')),
      // Offsets of the quick buttons; they add their exact value.
      quick: computed(() => {
        const jumps = QUICK_JUMPS[day.habit?.kind];
        return jumps ? [-jumps[1], -jumps[0], jumps[0], jumps[1]] : [];
      }),
      quickLabel: (offset) =>
          (offset < 0 ? '−' : '+') + Math.abs(offset).toLocaleString(locale),
      /**
       * Moves the value by `direction` steps, to a multiple of the step.
       * @param {number} direction
       */
      stepBy: (direction) => {
        const next = (Number(day.value) || 0) + direction * day.step;
        setValue(Math.round(next / day.step) * day.step);
      },
      jump: (offset) => setValue((Number(day.value) || 0) + offset),
      save: () => submit(collect()),
      clear: () => submit({value: 0, skipped: false}),
      /**
       * A tap on the backdrop cancels, as in the search: without a keyboard
       * there is no Escape.
       * @param {!MouseEvent} event
       */
      onBackdrop: (event) => {
        if (event.target === el.value) closePage(el.value);
      },
    };
  },
  // A skipped day has no value, so the value controls are off while
  // skipping. Any value is allowed, not only multiples of the step.
  template: `
    <dialog ref="el" id="day-editor" class="dialog compact"
            aria-labelledby="day-editor-title" @click="onBackdrop">
      <form method="dialog" @submit.prevent="save">
        <h2 id="day-editor-title" class="dialog-head">{{ title }}</h2>
        <fieldset class="day-value" :disabled="day.skipped">
          <legend class="sr-only">{{ t('Value') }}</legend>
          <div v-show="!check">
            <div class="stepper">
              <button type="button" class="button round" :aria-label="t('Less')" @click="stepBy(-1)">−</button>
              <input ref="input" name="value" v-model="day.value" type="number" min="0"
                     :max="day.max" :step="day.scale === 1 ? '1' : 'any'"
                     :inputmode="day.scale === 1 ? 'numeric' : 'decimal'"
                     :disabled="check" :aria-label="valueLabel">
              <button type="button" class="button round" :aria-label="t('More')" @click="stepBy(1)">+</button>
            </div>
            <div v-if="quick.length > 0" class="quick-steps">
              <button v-for="offset in quick" :key="offset" type="button" class="button"
                      @click="jump(offset)">{{ quickLabel(offset) }}</button>
            </div>
            <p id="day-editor-hint" class="field-hint">{{ hint }}</p>
          </div>
          <label v-show="check" class="switch">
            <input type="checkbox" name="done" v-model="day.done" autocomplete="off">
            <span>{{ t('Completed') }}</span>
          </label>
        </fieldset>
        <div class="day-skip">
          <label class="switch">
            <input type="checkbox" name="skipped" v-model="day.skipped" autocomplete="off">
            <span>{{ t('Skip this day') }}</span>
          </label>
        </div>
        <footer class="dialog-foot">
          <button type="button" class="button ghost" @click="clear">{{ t('Clear') }}</button>
          <button type="submit" class="button primary">{{ t('Save') }}</button>
        </footer>
      </form>
    </dialog>`,
};
