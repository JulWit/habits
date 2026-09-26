// Full-screen pages, stacked like the screens of an Android app. Each page is
// a modal <dialog class="page">. Opening one adds a history entry, so the
// system back button or gesture closes the top page, as does its back button.
//
// A page with a guard (guardPage) asks before it closes with unsaved changes,
// however it is closed: its close button, Escape, the system back gesture or
// the browser's back button.

import { t } from "./i18n.js";

/** Open pages, bottom first. */
const stack = [];

/** History steps taken by closePage, which popstate must not handle again. */
let ownPops = 0;

/** Pages whose close event is watched. */
const watched = new WeakSet();

/** Guards by page: return true while the page has unsaved changes. */
const guards = new WeakMap();

/** Opens `dialog` as a page on top of the stack. */
export function openPage(dialog) {
  if (stack.includes(dialog)) return;
  if (!watched.has(dialog)) {
    watched.add(dialog);
    // Escape, or the browser's close watcher on Android (system back): ask
    // first if there are unsaved changes.
    dialog.addEventListener("cancel", (event) => {
      if (!isDirty(dialog)) return;
      event.preventDefault();
      askToDiscard(dialog);
    });
    // Closed another way: drop the page and its history entry too. The event
    // is queued, so the page may have been opened again meanwhile.
    dialog.addEventListener("close", () => {
      if (!dialog.open && stack.includes(dialog)) closePage(dialog, { force: true });
    });
  }
  stack.push(dialog);
  history.pushState({ pages: stack.length }, "");
  dialog.showModal();
}

/**
 * Registers `dirty`, which returns true while `dialog` has unsaved changes.
 * Closing the page then asks whether to discard them.
 */
export function guardPage(dialog, dirty) {
  guards.set(dialog, dirty);
}

/**
 * Closes `dialog` and every page above it. Asks first if one of them has
 * unsaved changes, unless `force` is set (e.g. after saving).
 */
export function closePage(dialog, { force = false } = {}) {
  const index = stack.indexOf(dialog);
  if (index < 0) {
    if (dialog.open) dialog.close();
    return;
  }
  const dirty = force ? null : stack.slice(index).find(isDirty);
  if (dirty) {
    askToDiscard(dialog);
    return;
  }
  const count = stack.length - index;
  drop(index);
  ownPops++;
  history.go(-count);
}

/** The topmost open page, or null. */
export function topPage() {
  return stack.at(-1) ?? null;
}

function isDirty(page) {
  return guards.get(page)?.() === true;
}

/** Asks whether to discard the changes; closes `page` if so. */
async function askToDiscard(page) {
  if (await confirmDiscard()) closePage(page, { force: true });
}

/** Resolves to true if the user chooses to discard the changes. */
function confirmDiscard() {
  const dialog = document.getElementById("discard-dialog");
  if (dialog.open) return Promise.resolve(false);
  document.getElementById("discard-title").textContent = t("Discard changes?");
  // Escape leaves the value empty, i.e. keeps editing.
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "discard"), { once: true });
  });
}

/** Closes the pages from `index` up, topmost first. */
function drop(index) {
  for (const page of stack.splice(index).reverse()) {
    if (page.open) page.close();
  }
}

// Registered before app.js's listener, so the route is left alone when only a
// page closes: the hash does not change.
window.addEventListener("popstate", (event) => {
  if (ownPops > 0) {
    ownPops--;
    event.stopImmediatePropagation();
    return;
  }
  const depth = history.state?.pages ?? 0;
  if (depth < stack.length) {
    event.stopImmediatePropagation();
    // The browser's back button: restore the history entries of a page with
    // unsaved changes and ask.
    if (stack.slice(depth).some(isDirty)) {
      for (let i = depth + 1; i <= stack.length; i++) history.pushState({ pages: i }, "");
      askToDiscard(stack[depth]);
      return;
    }
    drop(depth);
  }
});

// Back buttons in the page headers, and rows that open another page.
document.addEventListener("click", (event) => {
  const back = event.target.closest?.(".page [data-page-back]");
  if (back) {
    closePage(back.closest(".page"));
    return;
  }
  const link = event.target.closest?.("[data-open-page]");
  if (link) openPage(document.getElementById(link.dataset.openPage));
});
