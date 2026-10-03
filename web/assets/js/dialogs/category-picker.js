/**
 * @fileoverview Category picker, a page opened on top of the habit editor. It
 * can create a category, through actions.js, and choose it.
 */

import * as actions from '../data/actions.js';
import {state} from '../data/state.js';
import {createPage} from '../ui/page-stack.js';
import {errorText} from '../ui/toast.js';
import {t} from '../util/i18n.js';
import {computed, ref, shallowRef} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/**
 * The value of "no category".
 * @const {string}
 */
const NONE = '';

/** The ID of the selected category, NONE for none. */
const current = ref(NONE);

/** The name typed for a new category. */
const newName = ref('');

/** The page. */
const page = createPage();

/**
 * The field for a new category's name.
 * @type {!Ref<?HTMLInputElement>}
 */
const nameInput = shallowRef(null);

/**
 * Opens the category picker.
 * @param {string} selected the current category ID, "" for none
 * @return {!Promise<?string>} the chosen ID, or null if cancelled
 */
export function openCategoryPicker(selected) {
  current.value = selected ?? NONE;
  newName.value = '';
  return page.open();
}

/** The category picker (see openCategoryPicker). */
export const TheCategoryPicker = {
  name: 'TheCategoryPicker',
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const creating = ref(false);

    // "No category" first.
    const options = computed(
        () => [{id: NONE, name: t('No category')}, ...state.categories]);

    /**
     * Creates a category from the form and chooses it. The page covers the
     * toasts, so it shows why creating failed itself.
     */
    const create = async () => {
      const name = newName.value.trim();
      if (!name) {
        nameInput.value?.focus();
        return;
      }
      creating.value = true;
      try {
        const created = await actions.createCategory(name);
        // Select the newly created category.
        if (created) page.close(created.id);
      } catch (err) {
        page.error.value = errorText(err);
      } finally {
        creating.value = false;
      }
    };

    return {
      el: page.el,
      cancel: page.cancel,
      error: page.error,
      nameInput,
      creating,
      current,
      newName,
      options,
      /**
       * Chooses a category and closes the picker.
       * @param {string} id
       */
      choose: (id) => page.close(id),
      create,
    };
  },
  // Leaving the page by its back button, Escape or the system back cancels.
  // The selection is shown by the accent fill, as in the dropdowns.
  template: `
    <dialog
      id="category-picker"
      ref="el"
      class="dialog page is-floating"
      aria-labelledby="category-picker-title"
    >
      <header class="page-head">
        <button
          v-tooltip="t('Back')"
          type="button"
          class="icon-button"
          :aria-label="t('Back')"
          @click="cancel"
        >
          <app-icon name="arrowLeft"/>
        </button>
        <h2 id="category-picker-title">{{ t('Category') }}</h2>
      </header>
      <div class="page-body">
        <div
          class="category-picker-list"
          role="listbox"
          :aria-label="t('Choose category')"
        >
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            class="category-picker-option"
            role="option"
            :aria-selected="String(option.id === current)"
            @click="choose(option.id)"
          >
            <app-icon-badge
              class="habit-icon is-small"
              :icon="option.icon"
              :color="option.color || null"
            />
            <span class="category-picker-option-name">{{ option.name }}</span>
          </button>
        </div>
        <form
          class="category-picker-create"
          @submit.prevent="create"
        >
          <input
            ref="nameInput"
            v-model="newName"
            name="name"
            type="text"
            maxlength="60"
            autocomplete="off"
            :placeholder="t('New category')"
            :aria-label="t('Name of the new category')"
          >
          <button
            type="submit"
            class="button"
            :disabled="creating"
          >
            {{ t('Create') }}
          </button>
        </form>
        <p
          v-if="error"
          class="error"
        >
          {{ error }}
        </p>
      </div>
    </dialog>`,
};
