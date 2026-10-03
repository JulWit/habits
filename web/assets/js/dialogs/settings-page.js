/**
 * @fileoverview What the settings pages share: the frame of a page with its
 * error, a segmented choice, and saving a setting. Every change is saved
 * immediately: the state is updated first and restored if the server rejects
 * the change.
 */

import {api} from '../data/api.js';
import {replaceState, state} from '../data/state.js';
import {closePage, topPage} from '../ui/page-stack.js';
import {errorText, toast} from '../ui/toast.js';
import {reactive, shallowRef} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/**
 * A choice of an enumerated setting, as the server offers it (state.options),
 * or as a page lists it.
 * @typedef {{value: (string|number), label: string, icon?: string,
 *     lang?: string}}
 */
export let SettingOption;

/**
 * The last error and the page it belongs to; shown in the open settings page,
 * since pages cover the toasts.
 */
const error = reactive({page: '', message: ''});

/**
 * Shows an error in the open settings page, or as a toast outside of them.
 * @param {string} message
 */
export function reportError(message) {
  const page = topPage();
  if (page?.id.startsWith('settings-')) {
    error.page = page.id;
    error.message = message;
    return;
  }
  toast(message, {error: true});
}

/** Hides the error of the settings pages. */
export function clearError() {
  error.message = '';
}

/**
 * Returns the choices the server offers for the setting `key`.
 * @param {string} key
 * @return {!Array<!SettingOption>}
 */
export function options(key) {
  return /** @type {!Array<!SettingOption>} */ (state.options?.[key] ?? []);
}

/**
 * The last save of settings, which the next one waits for, so the server
 * applies them in the order they were made.
 * @type {!Promise<*>}
 */
let lastSave = Promise.resolve();

/** Counts the saves of settings, so only the last one takes over the answer. */
let saves = 0;

/**
 * Saves settings. The state is updated immediately and the changed settings
 * restored if the server rejects the change, unless a later change has
 * changed them again meanwhile. Saves run one after another; each answers
 * with all settings, so only the answer of the last one is taken over, as an
 * earlier one lacks the changes made since. Resolves to whether the change
 * was saved.
 * @param {!Object<string, *>} patch
 * @return {!Promise<boolean>}
 */
export async function saveSetting(patch) {
  const before = {...state.settings};
  // Apply immediately; restored on failure.
  replaceState({settings: {...state.settings, ...patch}});
  const save = ++saves;
  const request = lastSave.then(() => api.saveSettings(patch));
  lastSave = request.catch(() => {});
  try {
    const saved = await request;
    if (save === saves) replaceState({settings: saved});
    clearError();
    return true;
  } catch (err) {
    const restored = {};
    for (const [key, value] of Object.entries(patch)) {
      if (state.settings[key] === value) restored[key] = before[key];
    }
    replaceState({settings: {...state.settings, ...restored}});
    reportError(errorText(err));
    return false;
  }
}

/**
 * sessionStorage key of the settings page to show again after the reload a
 * new language needs.
 */
const REOPEN_KEY = 'habits.reopenSettings';

/**
 * Reloads the page, e.g. for a new language, and asks to show the settings
 * page `pageId` again afterwards (see reopenPage).
 * @param {string} pageId
 */
export function reloadInto(pageId) {
  try {
    sessionStorage.setItem(REOPEN_KEY, pageId);
  } catch {
    // The reload then shows the overview.
  }
  location.reload();
}

/**
 * Returns the ID of the settings page to show again after a reload, once, or
 * null.
 * @return {?string}
 */
export function pageToReopen() {
  try {
    const page = sessionStorage.getItem(REOPEN_KEY);
    sessionStorage.removeItem(REOPEN_KEY);
    return page;
  } catch {
    return null;
  }
}

/**
 * A settings page: a full-screen dialog with a back button, its content and
 * the error of the last change made on it.
 */
export const SettingsPage = {
  name: 'SettingsPage',
  props: {
    id: {type: String, required: true},
    title: {type: String, required: true},
  },
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!Ref<?HTMLDialogElement>} */
    const el = shallowRef(null);
    return {
      el,
      error,
      /** Closes the page, as the system back does. */
      back: () => el.value && closePage(el.value),
    };
  },
  template: `
    <dialog
      ref="el"
      :id="id"
      class="dialog page"
      :aria-labelledby="id + '-title'"
    >
      <header class="page-head">
        <button
          v-tooltip="t('Back')"
          type="button"
          class="icon-button"
          :aria-label="t('Back')"
          @click="back"
        >
          <app-icon name="arrowLeft"/>
        </button>
        <h2 :id="id + '-title'">{{ title }}</h2>
      </header>
      <div class="page-body">
        <slot/>
        <p
          v-if="error.message && error.page === id"
          class="error"
        >
          {{ error.message }}
        </p>
      </div>
    </dialog>`,
};

/**
 * A segmented choice of `options`, saved on change: `name` names its radio
 * buttons, `label` the group, `modelValue` is the chosen value. An option's
 * label is translated; it may have an icon.
 */
export const SettingsSegmented = {
  name: 'SettingsSegmented',
  props: {
    name: {type: String, required: true},
    label: {type: String, required: true},
    options: {type: Array, required: true},
    modelValue: {type: [String, Number], default: ''},
    wrap: Boolean,
  },
  emits: ['update:modelValue'],
  template: `
    <div
      class="segmented"
      :class="{wrap}"
      role="radiogroup"
      :aria-label="label"
    >
      <label
        v-for="o in options"
        :key="o.value"
      >
        <input
          type="radio"
          :name="name"
          :value="o.value"
          autocomplete="off"
          :checked="modelValue === o.value"
          @change="$emit('update:modelValue', o.value)"
        >
        <span>
          <app-icon
            v-if="o.icon"
            :name="o.icon"
          />{{ t(o.label) }}
        </span>
      </label>
    </div>`,
};
