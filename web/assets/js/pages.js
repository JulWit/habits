// Full-screen pages, stacked like the screens of an Android app. Each page is
// a modal <dialog class="page">. Opening one adds a history entry, so the
// system back button or gesture closes the top page, as does its back button.

/** Open pages, bottom first. */
const stack = [];

/** History steps taken by closePage, which popstate must not handle again. */
let ownPops = 0;

/** Pages whose close event is watched. */
const watched = new WeakSet();

/** Opens `dialog` as a page on top of the stack. */
export function openPage(dialog) {
  if (stack.includes(dialog)) return;
  if (!watched.has(dialog)) {
    watched.add(dialog);
    // Closed another way (Escape, or the browser's close watcher on Android):
    // drop the page and its history entry too.
    dialog.addEventListener("close", () => {
      if (stack.includes(dialog)) closePage(dialog);
    });
  }
  stack.push(dialog);
  history.pushState({ pages: stack.length }, "");
  dialog.showModal();
}

/** Closes `dialog` and every page above it. */
export function closePage(dialog) {
  const index = stack.indexOf(dialog);
  if (index < 0) {
    if (dialog.open) dialog.close();
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
    drop(depth);
    event.stopImmediatePropagation();
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
