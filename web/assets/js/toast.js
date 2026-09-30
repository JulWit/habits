/**
 * @fileoverview Toasts at the bottom of the screen, and the messages of
 * errors in the UI language. Nothing here reaches the server, so every module
 * may report through it.
 */

import {errorTemplate, locale, t} from './i18n.js';
import {onBeforeUnmount, onMounted, reactive} from './vue.js';

/**
 * Returns the message of an error in the UI language. Problems from the server
 * are translated by their code; without a translation, the English message is
 * shown.
 * @param {*} err
 * @return {string}
 */
export function errorText(err) {
  if (!err?.message) return t('Unknown error');
  const template = err.code ? errorTemplate(err.code) : undefined;
  // The server's messages are error strings, which start in lower case.
  if (!template) return capitalize(String(err.message));
  const vars = {};
  for (const [name, value] of Object.entries(err.params ?? {})) {
    // Numbers are formatted for the locale, strings are translated.
    vars[name] = typeof value === 'number' ? value.toLocaleString(locale) :
                                             t(String(value));
  }
  return t(template, vars);
}

/**
 * Returns `text` with its first letter in upper case.
 * @param {string} text
 * @return {string}
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DEFAULT_TIMEOUT = 7000;

/**
 * A toast: its text, an optional action button, whether it reports an error,
 * and how long it stays.
 * @typedef {{
 *   id: number,
 *   text: string,
 *   actionLabel: (string|undefined),
 *   onAction: (function(): *|undefined),
 *   error: boolean,
 *   timeout: number,
 * }}
 */
let Toast;

/**
 * The toasts shown, oldest first.
 * @type {!Array<!Toast>}
 */
const toasts = reactive([]);

/** The ID of the last toast. */
let lastToast = 0;

/**
 * Removes a toast.
 * @param {number} id
 */
function dismiss(id) {
  const i = toasts.findIndex((item) => item.id === id);
  if (i !== -1) toasts.splice(i, 1);
}

/**
 * Shows a toast.
 * @param {string} text
 * @param {{
 *   actionLabel: (string|undefined),
 *   onAction: (function(): *|undefined),
 *   error: (boolean|undefined),
 *   timeout: (number|undefined),
 * }=} opts
 * @return {function(): void} a function that closes the toast
 */
export function toast(text, opts = {}) {
  const id = ++lastToast;
  toasts.push({
    id,
    text,
    actionLabel: opts.actionLabel && opts.onAction ? opts.actionLabel :
                                                     undefined,
    onAction: opts.onAction,
    error: opts.error ?? false,
    timeout: opts.timeout ?? DEFAULT_TIMEOUT,
  });
  return () => dismiss(id);
}

/**
 * A toast that closes itself after its timeout. The timeout pauses while the
 * toast is hovered or focused.
 */
const ToastListItem = {
  name: 'ToastListItem',
  props: {toast: {type: Object, required: true}},
  /**
   * @param {{toast: !Toast}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    let timer;
    let hovered = false;
    let focused = false;
    /** Closes the toast. */
    const close = () => dismiss(props.toast.id);
    /** Keeps the toast open while it is hovered or focused. */
    const hold = () => clearTimeout(timer);
    /** Closes the toast after its timeout, unless it is hovered or focused. */
    const resume = () => {
      if (hovered || focused) return;
      clearTimeout(timer);
      timer = setTimeout(close, props.toast.timeout);
    };
    onMounted(resume);
    onBeforeUnmount(hold);

    return {
      close,
      // The action handler shows its own toast.
      act: () => {
        close();
        props.toast.onAction();
      },
      onEnter: () => {
        hovered = true;
        hold();
      },
      onLeave: () => {
        hovered = false;
        resume();
      },
      onFocusIn: () => {
        focused = true;
        hold();
      },
      /**
       * Resumes the timeout once the focus has left the toast.
       * @param {!FocusEvent} event
       */
      onFocusOut: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focused = false;
        resume();
      },
    };
  },
  template: `
    <div
      class="toast-list-item"
      :class="{'is-error': toast.error}"
      @pointerenter="onEnter"
      @pointerleave="onLeave"
      @focusin="onFocusIn"
      @focusout="onFocusOut"
    >
      <span class="toast-list-item-text">{{ toast.text }}</span>
      <button
        v-if="toast.actionLabel"
        type="button"
        class="button"
        @click="act"
      >
        {{ toast.actionLabel }}
      </button>
      <button
        type="button"
        class="icon-button"
        :aria-label="t('Close')"
        @click="close"
      >×</button>
    </div>`,
};

/** The toasts, at the bottom of the screen. */
export const TheToastList = {
  name: 'TheToastList',
  components: {ToastListItem},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    return {toasts};
  },
  template: `
    <div
      class="toast-list"
      role="status"
      aria-live="polite"
    >
      <toast-list-item
        v-for="item in toasts"
        :key="item.id"
        :toast="item"
      />
    </div>`,
};
