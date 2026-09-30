// Page for skipping a range of days, e.g. a holiday: of one habit or of all
// that are not archived. It passes the input to its caller and stays open with
// the error message if skipping fails.

import {addDays} from './dates.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText} from './undo.js';
import {nextTick, onMounted, reactive, ref, watch} from './vue.js';

/**
 * The range of days to skip and the habits; no habitIds means all habits.
 * @typedef {{from: string, to: string, habitIds: !Array<string>}}
 */
let SkipInput;

/**
 * The input of the form; `scope` is "one" for the habit the page was opened
 * for, or "all".
 */
const form = reactive({from: '', to: '', scope: 'one'});

/**
 * The habit the page was opened for, or null for all habits.
 * @type {!Object}
 */
const habit = ref(null);

/** The message of a failed skip, or "". */
const error = ref('');

/** Whether the days are being skipped. */
const busy = ref(false);

/**
 * Skips the days; set when the page opens.
 * @type {?function(!SkipInput): !Promise<void>}
 */
let onSubmit = null;

/**
 * The page, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

/**
 * Opens the page for `target`, with the choice of all habits, or for all
 * habits if `target` is null. `handler` receives {from, to, habitIds}; no
 * habitIds means all habits.
 * @param {?Habit} target
 * @param {function(!SkipInput): !Promise<void>} handler
 */
export async function openSkipDialog(target, handler) {
  habit.value = target;
  onSubmit = handler;
  // A week from today, the usual holiday.
  form.from = state.today;
  form.to = addDays(state.today, 6);
  form.scope = 'one';
  await nextTick();
  error.value = '';

  openPage(dialog);
  dialog.querySelector('input[name="from"]').focus();
}

/**
 * Returns the input of the form.
 * @return {!SkipInput}
 */
function collect() {
  const one = habit.value !== null && form.scope === 'one';
  return {from: form.from, to: form.to, habitIds: one ? [habit.value.id] : []};
}

/** The page for skipping days (see openSkipDialog). */
export const SkipEditor = {
  name: 'SkipEditor',
  setup() {
    const el = ref(null);
    const formEl = ref(null);
    onMounted(() => {
      dialog = el.value;
    });

    // Any change of the input hides the error message.
    watch(form, () => {
      error.value = '';
    });
    // The last day cannot lie before the first.
    watch(() => form.from, (from) => {
      if (form.to < from) form.to = from;
    });

    /**
     * Skips the days and closes the page, or shows why it failed. The page
     * stays open until the server accepts the input.
     */
    const submit = async () => {
      if (!formEl.value.reportValidity()) return;
      busy.value = true;
      try {
        await onSubmit(collect());
        closePage(dialog, {force: true});
      } catch (err) {
        error.value = errorText(err);
      } finally {
        busy.value = false;
      }
    };

    return {el, formEl, form, habit, error, busy, submit};
  },
  template: `
    <dialog ref="el" id="skip-editor" class="dialog page is-sheet is-floating"
            aria-labelledby="skip-editor-title">
      <form ref="formEl" method="dialog" @submit.prevent="submit">
        <header class="page-head">
          <button type="button" class="icon-button" data-page-back
                  :title="t('Close')" :aria-label="t('Close')"><app-icon name="close"/></button>
          <h2 id="skip-editor-title">{{ t('Skip days') }}</h2>
          <button type="submit" class="button primary" :disabled="busy">{{ t('Skip') }}</button>
        </header>

        <div class="page-body">
          <div class="field row">
            <label class="grow">
              <span class="field-label">{{ t('From') }}</span>
              <input name="from" v-model="form.from" type="date" required>
            </label>
            <label class="grow">
              <span class="field-label">{{ t('Until') }}</span>
              <input name="to" v-model="form.to" type="date" :min="form.from" required>
            </label>
          </div>

          <fieldset v-if="habit" class="field">
            <legend class="field-label">{{ t('Habits') }}</legend>
            <div class="segmented" role="radiogroup" :aria-label="t('Habits')">
              <label><input type="radio" name="scope" value="one" v-model="form.scope"><span>{{ habit.name }}</span></label>
              <label><input type="radio" name="scope" value="all" v-model="form.scope"><span>{{ t('All habits') }}</span></label>
            </div>
          </fieldset>

          <p class="field-hint">{{ t('Only due days without an entry are skipped; days with an entry keep it. Skipped days neither break nor extend a streak. Archived habits are left out.') }}</p>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
      </form>
    </dialog>`,
};
