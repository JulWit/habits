// Category edit page. It passes the input to its caller and stays open with
// the error message if saving fails.

import {ColorSwatches, colorValue, IconChoices} from './icons.js';
import {closePage, guardPage, openPage} from './page-stack.js';
import {categoryById, state} from './state.js';
import {errorText} from './undo.js';
import {nextTick, onMounted, reactive, ref, watch} from './vue.js';

/**
 * What the editor sends.
 * @typedef {{name: string, color: string, icon: string, showProgress: boolean}}
 */
let CategoryInput;

/**
 * The input of the form.
 * @type {!CategoryInput}
 */
const form = reactive({name: '', color: '', icon: '', showProgress: false});

/** The message of a failed save, or "". */
const error = ref('');

/** Whether the input is being saved. */
const busy = ref(false);

/**
 * Saves the input; set when the editor opens.
 * @type {?function(!CategoryInput): !Promise<void>}
 */
let onSubmit = null;

/** The input as opened, to detect unsaved changes. */
let initial = '';

/**
 * The page, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

/**
 * Returns the input of the form.
 * @return {!CategoryInput}
 */
function collect() {
  return {
    name: form.name.trim(),
    color: form.color,
    icon: form.icon,
    showProgress: form.showProgress,
  };
}

/**
 * Opens the editor for a category.
 * @param {string} id the category to edit
 * @param {function(!CategoryInput): !Promise<void>} handler saves the input
 */
export async function openCategoryEditor(id, handler) {
  const category = categoryById(id);
  if (!category) return;
  onSubmit = handler;
  form.name = category.name;
  form.color = category.color ?? '';
  form.icon = category.icon ?? '';
  // A missing value means off.
  form.showProgress = category.showProgress === true;
  initial = JSON.stringify(collect());
  await nextTick();
  error.value = '';

  openPage(dialog);
  const name = dialog.querySelector('input[name="name"]');
  name.focus();
  name.select();
}

/** The category page (see openCategoryEditor). */
export const CategoryEditor = {
  name: 'CategoryEditor',
  components: {ColorSwatches, IconChoices},
  setup() {
    const el = ref(null);
    const formEl = ref(null);
    const errorEl = ref(null);

    onMounted(() => {
      dialog = el.value;
      guardPage(dialog, () => JSON.stringify(collect()) !== initial);
    });
    // Any change of the input hides the error message.
    watch(form, () => {
      error.value = '';
    });

    /**
     * Saves the input and closes the editor, or shows why it failed. The page
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
        // The error message may be outside the visible area.
        await nextTick();
        errorEl.value?.scrollIntoView({block: 'nearest'});
      } finally {
        busy.value = false;
      }
    };

    return {el, formEl, errorEl, form, state, error, busy, colorValue, submit};
  },
  // The colours start with "no colour"; the icons are drawn in the chosen
  // colour, or neutral without one.
  template: `
    <dialog ref="el" id="category-editor" class="dialog page is-sheet is-floating"
            aria-labelledby="category-editor-title">
      <form ref="formEl" method="dialog" @submit.prevent="submit">
        <header class="page-head">
          <button type="button" class="icon-button" data-page-back
                  :title="t('Close')" :aria-label="t('Close')"><app-icon name="close"/></button>
          <h2 id="category-editor-title">{{ t('Edit category') }}</h2>
          <button type="submit" class="button primary" :disabled="busy">{{ t('Save') }}</button>
        </header>

        <div class="page-body">
          <label class="field">
            <span class="field-label">{{ t('Name') }}</span>
            <input name="name" v-model="form.name" type="text" maxlength="60" required autocomplete="off">
          </label>

          <fieldset class="field">
            <legend class="field-label">{{ t('Colour') }}</legend>
            <color-swatches :colors="['', ...state.colors]" v-model="form.color"/>
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">{{ t('Icon') }}</legend>
            <icon-choices :names="state.icons" v-model="form.icon"
                          :class="{'is-neutral': !form.color}"
                          :style="form.color ? {'--habit-color': colorValue(form.color)} : null"/>
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">{{ t('Progress') }}</legend>
            <label class="switch">
              <input type="checkbox" name="showProgress" v-model="form.showProgress" autocomplete="off">
              <span>{{ t("Show today's progress") }}</span>
            </label>
            <p class="field-hint">{{ t('The bar and the count beside the name on the board.') }}</p>
          </fieldset>

          <p v-if="error" ref="errorEl" class="error" role="alert">{{ error }}</p>
        </div>
      </form>
    </dialog>`,
};
