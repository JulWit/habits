/**
 * @fileoverview Toasts at the bottom of the screen, and the messages of
 * errors in the UI language. Nothing here reaches the server, so every module
 * may report through it.
 */

import {errorTemplate, locale, t} from '../util/i18n.js';
import {onBeforeUnmount, onMounted, reactive} from '../vue.js';

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

/** How long a toast stays without a timeout of its own, in milliseconds. */
const DEFAULT_TIMEOUT = 7000;

/** How many toasts are shown at most; a new one closes the oldest. */
const MAX_TOASTS = 4;

/**
 * A toast: its text, an optional action button, whether it reports an error,
 * and how long it stays.
 * @typedef {{
 *   id: number,
 *   text: string,
 *   actionLabel?: string,
 *   onAction?: function(): *,
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
 * The texts the live regions announce: `status` politely, `alert` (errors)
 * at once.
 */
const live = reactive({status: '', alert: ''});

/**
 * The timers that fill in the live regions, by region.
 * @type {!Object<string, (ReturnType<typeof setTimeout>|undefined)>}
 */
const liveTimers = {};

/**
 * Announces `text` in a live region. The region is cleared first, so a
 * repeated text is announced again.
 * @param {string} region status or alert
 * @param {string} text
 */
function announce(region, text) {
  clearTimeout(liveTimers[region]);
  live[region] = '';
  liveTimers[region] = setTimeout(() => {
    live[region] = text;
  }, 50);
}

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
 *   actionLabel?: string,
 *   onAction?: function(): *,
 *   error?: boolean,
 *   timeout?: number,
 * }=} opts
 * @return {function(): void} a function that closes the toast
 */
export function toast(text, opts = {}) {
  const id = ++lastToast;
  const error = opts.error ?? false;
  toasts.push({
    id,
    text,
    actionLabel: opts.actionLabel && opts.onAction ? opts.actionLabel :
                                                     undefined,
    onAction: opts.onAction,
    error,
    timeout: opts.timeout ?? DEFAULT_TIMEOUT,
  });
  if (toasts.length > MAX_TOASTS) toasts.splice(0, toasts.length - MAX_TOASTS);
  // Errors interrupt, everything else waits for a pause.
  announce(error ? 'alert' : 'status', text);
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
        props.toast.onAction?.();
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
        const item = /** @type {!Element} */ (event.currentTarget);
        if (item.contains(/** @type {?Node} */ (event.relatedTarget))) return;
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

/**
 * The toasts, at the bottom of the screen, and the live regions that announce
 * them: errors at once (role alert), other messages politely.
 */
export const TheToastList = {
  name: 'TheToastList',
  components: {ToastListItem},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    return {toasts, live};
  },
  template: `
    <div class="toast-list">
      <toast-list-item
        v-for="item in toasts"
        :key="item.id"
        :toast="item"
      />
    </div>
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ live.status }}
    </div>
    <div
      class="sr-only"
      role="alert"
    >
      {{ live.alert }}
    </div>`,
};
