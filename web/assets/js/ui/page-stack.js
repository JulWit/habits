/**
 * @fileoverview Full-screen pages, stacked like the screens of an Android app.
 * Each page is a modal <dialog class="page">. Opening one adds a history entry,
 * so the system back button or gesture closes the top page, as does its back
 * button. Smaller modal dialogs (search, exact value) are opened the same way:
 * Firefox on Android has no close watcher, so without the entry the system back
 * would leave the view behind the dialog instead of closing it.
 *
 * A page with a guard asks before it closes with unsaved changes, however it
 * is closed: its close button, Escape, the system back gesture or the
 * browser's back button. The question is TheDiscardDialog.
 *
 * The pages are rendered by Vue; this module opens and closes them. A dialog
 * module keeps its page in a controller (createPage), which opens it, resolves
 * once it is closed and runs its saving. The history's steps back reach it
 * through handlePagePop, called by the app's one popstate listener.
 */

import {nextTick, ref, shallowRef} from '../vue.js';

import {errorText} from './toast.js';

/** @import {Ref} from '../vue.js' */

/**
 * Open pages, bottom first.
 * @type {!Array<!HTMLDialogElement>}
 */
const stack = [];

/**
 * History steps taken by closePage, which popstate must not handle again: the
 * function that resolves each one's promise.
 * @type {!Array<function(): void>}
 */
const ownPops = [];

/**
 * Pages whose close event is watched.
 * @type {!WeakSet<!HTMLDialogElement>}
 */
const watched = new WeakSet();

/**
 * Guards by page: return true while the page has unsaved changes.
 * @type {!WeakMap<!HTMLDialogElement, function(): boolean>}
 */
const guards = new WeakMap();

/**
 * Opens `dialog` as a page on top of the stack.
 * @param {!HTMLDialogElement} dialog
 */
export function openPage(dialog) {
  if (stack.includes(dialog)) return;
  if (!watched.has(dialog)) {
    watched.add(dialog);
    // Escape, or the browser's close watcher on Android (system back): ask
    // first if there are unsaved changes.
    dialog.addEventListener('cancel', (event) => {
      if (!isDirty(dialog)) return;
      event.preventDefault();
      askToDiscard(dialog);
    });
    // Closed another way: drop the page and its history entry too. The event
    // is queued, so the page may have been opened again meanwhile.
    dialog.addEventListener('close', () => {
      if (!dialog.open && stack.includes(dialog)) {
        closePage(dialog, {force: true});
      }
    });
  }
  stack.push(dialog);
  history.pushState({pages: stack.length}, '');
  dialog.showModal();
}

/**
 * Registers `dirty`, which returns true while `dialog` has unsaved changes.
 * Closing the page then asks whether to discard them.
 * @param {!HTMLDialogElement} dialog
 * @param {function(): boolean} dirty
 */
export function guardPage(dialog, dirty) {
  guards.set(dialog, dirty);
}

/**
 * Closes `dialog` and every page above it. Asks first if one of them has
 * unsaved changes, unless `force` is set (e.g. after saving). Resolves once
 * the history has gone back, so a view opened then is not removed by the step
 * back.
 * @param {!HTMLDialogElement} dialog
 * @param {{force?: boolean}=} options
 * @return {!Promise<void>}
 */
export function closePage(dialog, {force = false} = {}) {
  const index = stack.indexOf(dialog);
  if (index < 0) {
    if (dialog.open) dialog.close();
    return Promise.resolve();
  }
  const dirty = force ? null : stack.slice(index).find(isDirty);
  if (dirty) {
    askToDiscard(dialog);
    return Promise.resolve();
  }
  const count = stack.length - index;
  drop(index);
  /** @type {!Promise<void>} */
  const done = new Promise((resolve) => ownPops.push(resolve));
  history.go(-count);
  return done;
}

/**
 * The topmost open page, or null.
 * @return {?HTMLDialogElement}
 */
export function topPage() {
  return stack.at(-1) ?? null;
}

/**
 * Reports whether `page` has unsaved changes.
 * @param {!HTMLDialogElement} page
 * @return {boolean}
 */
function isDirty(page) {
  return guards.get(page)?.() === true;
}

/**
 * Asks whether to discard the changes; closes `page` if so.
 * @param {!HTMLDialogElement} page
 * @return {!Promise<void>}
 */
async function askToDiscard(page) {
  if (await confirmDiscard()) closePage(page, {force: true});
}

/**
 * Closes the pages from `index` up, topmost first.
 * @param {number} index
 */
function drop(index) {
  for (const page of stack.splice(index).reverse()) {
    if (page.open) page.close();
  }
}

/**
 * Handles a step back in the history (popstate) that belongs to the pages:
 * one taken by closePage, or the system or browser back closing the top
 * pages. Returns whether it did; otherwise the step changes the view, which
 * the caller shows (see initRouting in app.js).
 * @return {boolean}
 */
export function handlePagePop() {
  if (ownPops.length > 0) {
    ownPops.shift()?.();
    return true;
  }
  const depth = history.state?.pages ?? 0;
  if (depth >= stack.length) return false;
  // The browser's back button: restore the history entries of a page with
  // unsaved changes and ask.
  if (stack.slice(depth).some(isDirty)) {
    for (let i = depth + 1; i <= stack.length; i++) {
      history.pushState({pages: i}, '');
    }
    askToDiscard(stack[depth]);
    return true;
  }
  drop(depth);
  return true;
}

// ---------- the question before discarding ----------

/**
 * The dialog asking whether to discard unsaved changes, once mounted.
 * @type {?HTMLDialogElement}
 */
let discardDialog = null;

/**
 * Resolves to true if the user chooses to discard the changes.
 * @return {!Promise<boolean>}
 */
function confirmDiscard() {
  const dialog = discardDialog;
  if (!dialog || dialog.open) return Promise.resolve(false);
  // Escape leaves the value empty, i.e. keeps editing.
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
        'close', () => resolve(dialog.returnValue === 'discard'), {once: true});
  });
}

/**
 * Asks before a page with unsaved changes closes. The first button, keeping
 * the changes, gets the focus.
 */
export const TheDiscardDialog = {
  name: 'TheDiscardDialog',
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    return {
      /**
       * Keeps the element, which confirmDiscard opens.
       * @param {?Element} el
       */
      setDialog: (el) => {
        discardDialog = /** @type {?HTMLDialogElement} */ (el);
      },
    };
  },
  template: `
    <dialog
      id="discard-dialog"
      :ref="setDialog"
      class="dialog compact"
      aria-labelledby="discard-title"
    >
      <form method="dialog">
        <h2
          id="discard-title"
          class="dialog-head"
        >
          {{ t('Discard changes?') }}
        </h2>
        <footer class="dialog-foot">
          <button
            type="submit"
            class="button ghost"
            value="keep"
          >
            {{ t('Keep editing') }}
          </button>
          <button
            type="submit"
            class="button primary"
            value="discard"
          >
            {{ t('Discard') }}
          </button>
        </footer>
      </form>
    </dialog>`,
};

// ---------- the controller of a page ----------

/**
 * What a page was closed with, e.g. the chosen category's ID; null if it
 * was cancelled.
 * @typedef {?(string|boolean)}
 */
export let PageResult;

/**
 * What a page does once it is open, e.g. focus a field.
 * @typedef {function(): void}
 */
export let AfterOpen;

/**
 * A page as its dialog module keeps it (see createPage). `el` and `errorEl`
 * are bound as template refs: the dialog and the error message.
 * @typedef {{
 *   el: !Ref<?HTMLDialogElement>,
 *   errorEl: !Ref<?HTMLElement>,
 *   error: !Ref<string>,
 *   busy: !Ref<boolean>,
 *   open: function(AfterOpen=): !Promise<*>,
 *   close: function(PageResult=): !Promise<void>,
 *   cancel: function(): !Promise<void>,
 *   fail: function(string): !Promise<void>,
 *   run: function(function(): !Promise<*>): !Promise<void>,
 * }}
 */
export let Page;

/**
 * Creates the controller of a page: it opens the page and resolves with the
 * result it was closed with, null if it was cancelled (back button, Escape,
 * system back); it runs the page's saving, which closes it on success and
 * shows the error otherwise. `dirty`, if given, guards the page against
 * closing with unsaved changes.
 * @param {{dirty?: function(): boolean}=} options
 * @return {!Page}
 */
export function createPage({dirty} = {}) {
  /** @type {!Ref<?HTMLDialogElement>} */
  const el = shallowRef(null);
  /** @type {!Ref<?HTMLElement>} */
  const errorEl = shallowRef(null);
  const error = ref('');
  const busy = ref(false);
  /** @type {?function(*): void} */
  let settle = null;
  /** @type {*} */
  let result = null;
  /** @type {?HTMLDialogElement} */
  let prepared = null;

  /**
   * Watches the dialog's closing, once: the open promise resolves then.
   * @param {!HTMLDialogElement} dialog
   */
  const prepare = (dialog) => {
    if (prepared === dialog) return;
    prepared = dialog;
    if (dirty) guardPage(dialog, dirty);
    dialog.addEventListener('close', () => {
      // The event is queued, so the page may have been opened again.
      if (dialog.open) return;
      const resolve = settle;
      settle = null;
      resolve?.(result);
    });
  };

  /**
   * Opens the page once the module's state is rendered, then calls
   * `afterOpen`, e.g. to focus a field. Resolves once the page is closed.
   * @param {!AfterOpen=} afterOpen
   * @return {!Promise<*>} what the page was closed with, null if cancelled
   */
  const open = async (afterOpen = undefined) => {
    await nextTick();
    const dialog = el.value;
    // Not mounted: nothing to open.
    if (!dialog) return null;
    prepare(dialog);
    error.value = '';
    result = null;
    const closed = new Promise((resolve) => {
      settle = resolve;
    });
    openPage(dialog);
    afterOpen?.();
    return closed;
  };

  /**
   * Closes the page, without asking, and resolves the open promise with
   * `value`.
   * @param {!PageResult=} value
   * @return {!Promise<void>}
   */
  const close = (value = null) => {
    result = value;
    return el.value ? closePage(el.value, {force: true}) : Promise.resolve();
  };

  /**
   * Closes the page as its back button does: asks first if it has unsaved
   * changes.
   * @return {!Promise<void>}
   */
  const cancel = () => el.value ? closePage(el.value) : Promise.resolve();

  /**
   * Shows `message` as the page's error, scrolled into view, as it may lie
   * outside the visible area.
   * @param {string} message
   * @return {!Promise<void>}
   */
  const fail = async (message) => {
    error.value = message;
    await nextTick();
    errorEl.value?.scrollIntoView({block: 'nearest'});
  };

  /**
   * Runs `task`, e.g. saving the input. Closes the page with its result if it
   * succeeds; otherwise the page stays open and shows the error.
   * @param {function(): !Promise<*>} task
   * @return {!Promise<void>}
   */
  const run = async (task) => {
    if (busy.value) return;
    busy.value = true;
    try {
      const value = await task();
      await close(value ?? true);
    } catch (err) {
      await fail(errorText(err));
    } finally {
      busy.value = false;
    }
  };

  return {el, errorEl, error, busy, open, close, cancel, fail, run};
}
