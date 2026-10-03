/**
 * @fileoverview Page for skipping a range of days, e.g. a holiday: of one habit
 * or of all that are not archived. It skips them through actions.js and stays
 * open with the error message if skipping fails.
 */

import * as actions from '../data/actions.js';
import {state} from '../data/state.js';
import {createPage} from '../ui/page-stack.js';
import {addDays} from '../util/dates.js';
import {reactive, ref, shallowRef, watch} from '../vue.js';

/** @import {Habit} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */

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
 * @type {!Ref<?Habit>}
 */
const habit = shallowRef(null);

/** The page. */
const page = createPage();

/**
 * The first day's field, focused when the page opens.
 * @type {!Ref<?HTMLInputElement>}
 */
const fromInput = shallowRef(null);

/**
 * Opens the page for `target`, with the choice of all habits, or for all
 * habits if `target` is null, and skips the days it sends.
 * @param {?Habit} target
 * @return {!Promise<*>} resolves once the page is closed
 */
export function openSkipEditor(target) {
  habit.value = target;
  // A week from today, the usual holiday.
  form.from = state.today;
  form.to = addDays(state.today, 6);
  form.scope = 'one';
  return page.open(() => fromInput.value?.focus());
}

/**
 * Returns the input of the form.
 * @return {!SkipInput}
 */
function collect() {
  const one = habit.value !== null && form.scope === 'one';
  const habitIds = one && habit.value ? [habit.value.id] : [];
  return {from: form.from, to: form.to, habitIds};
}

/** The page for skipping days (see openSkipEditor). */
export const TheSkipEditor = {
  name: 'TheSkipEditor',
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!Ref<?HTMLFormElement>} */
    const formEl = ref(null);

    // Any change of the input hides the error message.
    watch(form, () => {
      page.error.value = '';
    });
    // The last day cannot lie before the first.
    watch(() => form.from, (from) => {
      if (form.to < from) form.to = from;
    });

    return {
      el: page.el,
      cancel: page.cancel,
      errorEl: page.errorEl,
      error: page.error,
      busy: page.busy,
      fromInput,
      formEl,
      form,
      habit,
      /**
       * Skips the days and closes the page, or shows why it failed. The page
       * stays open until the server accepts the input.
       */
      submit: () => {
        if (!formEl.value?.reportValidity()) return;
        const input = collect();
        page.run(() => actions.skipDays(input));
      },
    };
  },
  template: `
    <dialog
      id="skip-editor"
      ref="el"
      class="dialog page is-sheet is-floating"
      aria-labelledby="skip-editor-title"
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
            :aria-label="t('Close')"
            @click="cancel"
          >
            <app-icon name="close"/>
          </button>
          <h2 id="skip-editor-title">{{ t('Skip days') }}</h2>
          <button
            type="submit"
            class="button primary"
            :disabled="busy"
          >
            {{ t('Skip') }}
          </button>
        </header>
        <div class="page-body">
          <div class="field row">
            <label class="grow">
              <span class="field-label">{{ t('From') }}</span>
              <input
                ref="fromInput"
                v-model="form.from"
                name="from"
                type="date"
                required
              >
            </label>
            <label class="grow">
              <span class="field-label">{{ t('Until') }}</span>
              <input
                v-model="form.to"
                name="to"
                type="date"
                :min="form.from"
                required
              >
            </label>
          </div>
          <fieldset
            v-if="habit"
            class="field"
          >
            <legend class="field-label">{{ t('Habits') }}</legend>
            <div
              class="segmented"
              role="radiogroup"
              :aria-label="t('Habits')"
            >
              <label>
                <input
                  v-model="form.scope"
                  type="radio"
                  name="scope"
                  value="one"
                >
                <span>{{ habit.name }}</span>
              </label>
              <label>
                <input
                  v-model="form.scope"
                  type="radio"
                  name="scope"
                  value="all"
                >
                <span>{{ t('All habits') }}</span>
              </label>
            </div>
          </fieldset>
          <p class="field-hint">
            {{ t('Only due days without an entry are skipped; days with an entry keep it. Skipped days neither break nor extend a streak. Archived habits are left out.') }}
          </p>
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
