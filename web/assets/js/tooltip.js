// Tooltips: one styled pane for the whole app, in place of the browser's own
// title tooltips. Shown when the mouse rests on an element (at once when it
// moves on from another tooltip) and on keyboard focus; hidden on leaving,
// clicking, Escape and scrolling. Touch shows none: a tap triggers the
// element, and a long press has its own meaning on the board.
//
// Elements keep using plain title attributes. When first pointed at or
// focused, the title moves to data-tooltip, so the browser does not show its
// own tooltip as well. The pane is a popover, so it is drawn above dialogs.

/** Rest time before the first tooltip appears, in ms. */
const DELAY = 450;

/** Time after hiding in which the next tooltip appears at once, in ms. */
const WARM = 600;

/** Distance from the element and from the window's edges, in px. */
const MARGIN = 8;

/**
 * The tooltip pane, created on first use.
 * @type {?HTMLElement}
 */
let pane = null;
/**
 * The element the shown or pending tooltip belongs to.
 * @type {?Element}
 */
let owner = null;
/**
 * The timer of a tooltip about to appear.
 * @type {number}
 */
let timer = 0;
/**
 * Until when the next tooltip appears at once, as performance.now().
 * @type {number}
 */
let warmUntil = 0;

/** Registers the listeners for title tooltips. */
export function initTooltips() {
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    const el = event.target.closest?.('[title], [data-tooltip]');
    if (!el || el === owner) return;
    const text = takeTitle(el);
    if (!text) return;
    hideTooltip();
    owner = el;
    /** Shows the tooltip of the element under the pointer. */
    const show = () => showTooltip(el, text);
    if (performance.now() < warmUntil) {
      show();
    } else {
      timer = setTimeout(show, DELAY);
    }
  });

  document.addEventListener('pointerout', (event) => {
    if (owner && event.target.closest?.('[data-tooltip]') === owner &&
        !owner.contains(event.relatedTarget)) {
      hideTooltip();
    }
  });

  document.addEventListener('focusin', (event) => {
    const el = event.target;
    if (!el.matches?.(':focus-visible')) return;
    const text =
        el.closest('[title], [data-tooltip]') === el ? takeTitle(el) : '';
    if (!text) return;
    // In the next task: the focus may come from a closing popover, which
    // returns it to its button, and no popover can open until that is done.
    setTimeout(() => {
      if (document.activeElement === el) showTooltip(el, text);
    });
  });

  document.addEventListener('focusout', hideTooltip);
  document.addEventListener('pointerdown', hideTooltip, true);
  document.addEventListener(
      'scroll', hideTooltip, {capture: true, passive: true});
  window.addEventListener('blur', hideTooltip);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
}

/**
 * Shows `content` (text, or nodes) next to `anchor`: centred above it, or
 * below if there is no room above.
 * @param {!Element} anchor
 * @param {string|!Array<!Node>} content
 */
export function showTooltip(anchor, content) {
  clearTimeout(timer);
  const tip = paneElement();
  if (typeof content === 'string') {
    tip.textContent = content;
  } else {
    tip.replaceChildren(...content);
  }
  // Reopened, so it lies above a dialog opened since.
  if (tip.matches(':popover-open')) tip.hidePopover();
  tip.showPopover();
  owner = anchor;

  // Measure after filling in the content.
  const at = anchor.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const left = Math.max(
      MARGIN,
      Math.min(
          at.left + at.width / 2 - box.width / 2, width - box.width - MARGIN));
  let top = at.top - box.height - MARGIN;
  if (top < MARGIN) top = at.bottom + MARGIN;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

/** Hides the tooltip, and cancels one that is about to appear. */
export function hideTooltip() {
  clearTimeout(timer);
  owner = null;
  if (pane?.matches(':popover-open')) {
    pane.hidePopover();
    warmUntil = performance.now() + WARM;
  }
}

/**
 * Returns the tooltip pane, creating it on first use.
 * @return {!HTMLElement}
 */
function paneElement() {
  if (!pane) {
    pane = document.createElement('div');
    pane.className = 'tooltip';
    pane.popover = 'manual';
    // The text is announced through the element's own label or description.
    pane.setAttribute('aria-hidden', 'true');
    document.body.append(pane);
  }
  return pane;
}

/**
 * Moves the title of `el` to data-tooltip and returns the tooltip text. A
 * title set again later (e.g. when a toggle changes) replaces the old text.
 * @param {!Element} el
 * @return {string}
 */
function takeTitle(el) {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.removeAttribute('title');
    el.dataset.tooltip = title;
    // Keep the text for screen readers if the title was the only source.
    const labelled =
        el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
    if (!labelled) el.setAttribute('aria-description', title);
  }
  return el.dataset.tooltip ?? '';
}
