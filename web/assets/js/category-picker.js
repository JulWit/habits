// Category picker, a page opened on top of the habit editor.

import {createCategory} from './actions.js';
import {t} from './i18n.js';
import {closePage, openPage} from './page-stack.js';
import {state} from './state.js';
import {errorText} from './undo.js';
import {computed, onMounted, ref} from './vue.js';

/**
 * The value of "no category".
 * @const {string}
 */
const NONE = '';

/** The ID of the selected category, NONE for none. */
const current = ref(NONE);

/** The name typed for a new category. */
const newName = ref('');

/** The message of a failed creation, or "". */
const error = ref('');

/**
 * Resolves the promise returned by openCategoryPicker.
 * @type {?function(?string): void}
 */
let settle = null;

/**
 * The page, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

/**
 * Opens the category picker.
 * @param {string} selected the current category ID, "" for none
 * @return {!Promise<?string>} the chosen ID, or null if cancelled
 */
export function openCategoryPicker(selected) {
  current.value = selected ?? NONE;
  error.value = '';
  newName.value = '';
  openPage(dialog);
  return new Promise((resolve) => {
    settle = resolve;
  });
}

/**
 * Resolves the open picker's promise, once.
 * @param {?string} value
 */
function finish(value) {
  const resolve = settle;
  settle = null;
  if (resolve) resolve(value);
}

/**
 * Chooses a category and closes the picker.
 * @param {string} value
 */
function choose(value) {
  finish(value);
  closePage(dialog);
}

/** The category picker (see openCategoryPicker). */
export const CategoryPicker = {
  name: 'CategoryPicker',
  setup() {
    const el = ref(null);
    const nameInput = ref(null);
    const creating = ref(false);

    onMounted(() => {
      dialog = el.value;
    });

    // "No category" first. A deleted category is still offered, so that
    // saving does not change the habit's category.
    const options = computed(() => {
      const all = [{id: NONE, name: t('No category')}, ...state.categories];
      if (current.value !== NONE &&
          !state.categories.some((c) => c.id === current.value)) {
        all.push({id: current.value, name: t('Deleted category'), stale: true});
      }
      return all;
    });

    /** Creates a category from the form and chooses it. */
    const create = async () => {
      const name = newName.value.trim();
      if (!name) {
        nameInput.value.focus();
        return;
      }
      creating.value = true;
      try {
        const created = await createCategory(name);
        // Select the newly created category.
        if (created) choose(created.id);
      } catch (err) {
        error.value = errorText(err);
      } finally {
        creating.value = false;
      }
    };

    return {
      el,
      nameInput,
      creating,
      current,
      newName,
      error,
      options,
      choose,
      create,
      finish
    };
  },
  // Leaving the page by its back button, Escape or the system back cancels.
  // The selection is shown by the accent fill, as in the dropdowns.
  template: `
    <dialog ref="el" id="category-picker" class="dialog page is-floating"
            aria-labelledby="category-picker-title" @close="finish(null)">
      <header class="page-head">
        <button type="button" class="icon-button" data-page-back
                :title="t('Back')" :aria-label="t('Back')"><app-icon name="arrowLeft"/></button>
        <h2 id="category-picker-title">{{ t('Category') }}</h2>
      </header>
      <div class="page-body">
        <div class="picker-list" role="listbox" :aria-label="t('Choose category')">
          <button v-for="option in options" :key="option.id" type="button"
                  class="picker-option" :class="{'is-stale': option.stale}"
                  role="option" :aria-selected="String(option.id === current)"
                  @click="choose(option.id)">
            <icon-badge class="habit-icon is-small" :icon="option.icon" :color="option.color || null"/>
            <span class="picker-option-name">{{ option.name }}</span>
          </button>
        </div>
        <form class="picker-create" @submit.prevent="create">
          <input ref="nameInput" v-model="newName" name="name" type="text" maxlength="60"
                 autocomplete="off" :placeholder="t('New category')"
                 :aria-label="t('Name of the new category')">
          <button type="submit" class="button" :disabled="creating">{{ t('Create') }}</button>
        </form>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </dialog>`,
};
