/**
 * @fileoverview Category edit page. It saves the input through actions.js and
 * stays open with the error message if saving fails.
 */

import * as actions from '../data/actions.js';
import {categoryById, state} from '../data/state.js';
import {AppColorSwatches, AppIconChoices, colorValue} from '../ui/icons.js';
import {createPage} from '../ui/page-stack.js';
import {computed, reactive, ref, shallowRef, watch} from '../vue.js';

/** @import {CategoryInput} from '../data/state.js' */
/** @import {Ref} from '../vue.js' */

/**
 * The input of the form.
 * @type {!CategoryInput}
 */
const form = reactive({name: '', color: '', icon: '', showProgress: false});

/** The ID of the category being edited. */
let editingId = '';

/** The input as opened, to detect unsaved changes. */
let initial = '';

/** The page; it asks before closing with unsaved changes. */
const page = createPage({dirty: () => JSON.stringify(collect()) !== initial});

/**
 * The name field, selected when the page opens.
 * @type {!Ref<?HTMLInputElement>}
 */
const nameInput = shallowRef(null);

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
 * Opens the editor for a category and saves what it sends.
 * @param {string} id the category to edit
 * @return {!Promise<*>} resolves once the page is closed
 */
export async function openCategoryEditor(id) {
  const category = categoryById(id);
  if (!category) return null;
  editingId = id;
  form.name = category.name;
  form.color = category.color ?? '';
  form.icon = category.icon ?? '';
  // A missing value means off.
  form.showProgress = category.showProgress === true;
  initial = JSON.stringify(collect());
  return page.open(() => {
    nameInput.value.focus();
    nameInput.value.select();
  });
}

/** The category page (see openCategoryEditor). */
export const TheCategoryEditor = {
  name: 'TheCategoryEditor',
  components: {AppColorSwatches, AppIconChoices},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const formEl = ref(null);

    // Any change of the input hides the error message.
    watch(form, () => {
      page.error.value = '';
    });

    /**
     * Saves the input and closes the editor, or shows why it failed. The page
     * stays open until the server accepts the input.
     */
    const submit = () => {
      if (!formEl.value.reportValidity()) return;
      const input = collect();
      page.run(() => actions.updateCategory(editingId, input));
    };

    return {
      el: page.el,
      errorEl: page.errorEl,
      error: page.error,
      busy: page.busy,
      nameInput,
      formEl,
      form,
      state,
      // Without a colour, the icons keep the neutral colour of the
      // stylesheet.
      iconStyle: computed(
          () => form.color ? {'--habit-color': colorValue(form.color)} : null),
      submit,
    };
  },
  // The colours start with "no colour"; the icons are drawn in the chosen
  // colour, or neutral without one.
  template: `
    <dialog
      id="category-editor"
      ref="el"
      class="dialog page is-sheet is-floating"
      aria-labelledby="category-editor-title"
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
          <h2 id="category-editor-title">{{ t('Edit category') }}</h2>
          <button
            type="submit"
            class="button primary"
            :disabled="busy"
          >
            {{ t('Save') }}
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
              maxlength="60"
              required
              autocomplete="off"
            >
          </label>
          <fieldset class="field">
            <legend class="field-label">{{ t('Colour') }}</legend>
            <app-color-swatches
              v-model="form.color"
              :colors="['', ...state.colors]"
            />
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">{{ t('Icon') }}</legend>
            <app-icon-choices
              v-model="form.icon"
              :names="state.icons"
              :class="{'is-neutral': !form.color}"
              :style="iconStyle"
            />
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">{{ t('Progress') }}</legend>
            <label class="switch">
              <input
                v-model="form.showProgress"
                type="checkbox"
                name="showProgress"
                autocomplete="off"
              >
              <span>{{ t("Show today's progress") }}</span>
            </label>
            <p class="field-hint">
              {{ t('The bar and the count beside the name on the board.') }}
            </p>
          </fieldset>
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
