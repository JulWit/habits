/**
 * @fileoverview Tooltips: one styled pane for the whole app, in place of the
 * browser's own title tooltips. Shown when the mouse rests on an element (at
 * once when it moves on from another tooltip) and on keyboard focus; hidden on
 * leaving, clicking, Escape and scrolling. Touch shows none: a tap triggers the
 * element, and a long press has its own meaning on the board.
 *
 * Templates give an element its tooltip with the directive v-tooltip, which
 * keeps the text in data-tooltip; there are no title attributes, so the
 * browser shows no tooltip of its own. The pane is a popover, so it is drawn
 * above dialogs.
 */

/** @import {Directive} from '../vue.js' */

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
 * @type {ReturnType<typeof setTimeout>|undefined}
 */
let timer;
/**
 * Until when the next tooltip appears at once, as performance.now().
 * @type {number}
 */
let warmUntil = 0;

/**
 * Gives an element the tooltip `value`; an empty value gives it none. An
 * element without an accessible name of its own (aria-label or
 * aria-labelledby) gets the text as its description, for screen readers. A
 * tooltip shown takes a new text at once, e.g. a day cell's new value.
 * @type {!Directive<!HTMLElement, (string|undefined)>}
 */
export const vTooltip = {
  mounted: (el, {value}) => setTooltip(el, value),
  updated: (el, {value, oldValue}) => {
    if (value !== oldValue) setTooltip(el, value);
  },
  unmounted: (el) => {
    if (el === owner) hideTooltip();
  },
};

/**
 * Sets the tooltip text of `el` (see vTooltip).
 * @param {!HTMLElement} el
 * @param {string|undefined} text
 */
function setTooltip(el, text) {
  const labelled =
      el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
  if (text) {
    el.dataset.tooltip = text;
    if (!labelled) el.setAttribute('aria-description', text);
  } else {
    delete el.dataset.tooltip;
    if (!labelled) el.removeAttribute('aria-description');
  }
  if (el !== owner || !pane?.matches(':popover-open')) return;
  if (text) {
    showTooltip(el, text);
  } else {
    hideTooltip();
  }
}

/**
 * Returns the element with a tooltip that `target` lies in, or null.
 * @param {?EventTarget} target
 * @return {?HTMLElement}
 */
function tooltipOwner(target) {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-tooltip]');
  return el instanceof HTMLElement ? el : null;
}

/** Registers the listeners for the tooltips of v-tooltip. */
export function initTooltips() {
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    const el = tooltipOwner(event.target);
    if (!el || el === owner) return;
    hideTooltip();
    owner = el;
    /** Shows the tooltip of the element under the pointer. */
    const show = () => showOwn(el);
    if (performance.now() < warmUntil) {
      show();
    } else {
      timer = setTimeout(show, DELAY);
    }
  });

  document.addEventListener('pointerout', (event) => {
    if (owner && tooltipOwner(event.target) === owner &&
        !(event.relatedTarget instanceof Node &&
          owner.contains(event.relatedTarget))) {
      hideTooltip();
    }
  });

  document.addEventListener('focusin', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.matches(':focus-visible')) return;
    if (tooltipOwner(el) !== el) return;
    // In the next task: the focus may come from a closing popover, which
    // returns it to its button, and no popover can open until that is done.
    setTimeout(() => {
      if (document.activeElement === el) showOwn(el);
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
 * Shows the tooltip of `el`, with the text it has now.
 * @param {!HTMLElement} el
 */
function showOwn(el) {
  const text = el.dataset.tooltip;
  if (text) showTooltip(el, text);
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
