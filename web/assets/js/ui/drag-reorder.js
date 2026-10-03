/**
 * @fileoverview Drag-and-drop reordering of a vertical list, based on pointer
 * events (mouse, pen and touch). The dragged element is moved in the DOM while
 * dragging; settle() compensates the resulting layout jump. When the drag ends,
 * the element goes back to where it was and the new order is reported: the list
 * is rendered by Vue, which moves the elements itself and must find them where
 * it left them. Its user keeps the list from changing during a drag. Near the
 * top or bottom of the window, the page scrolls along, so an entry can be
 * moved past the visible part of a long list.
 */

/** Minimum pointer movement in pixels before a press starts a drag. */
const THRESHOLD = 4;

/** Distance from the window's top or bottom edge, in px, that scrolls. */
const EDGE = 56;

/** Scroll per frame at the very edge, in px; less further in. */
const MAX_SCROLL = 14;

/**
 * A drag, from the press on a handle on. `startY` is where it started on the
 * page, `pointerY` where the pointer is in the window. `order`, `list` and
 * `anchor` are set once the pointer has moved far enough to start it; `frame`
 * is the request of the scrolling near the edges.
 * @typedef {{
 *   element: !HTMLElement,
 *   grip: !Element,
 *   pointerId: number,
 *   startY: number,
 *   pointerY: number,
 *   active: boolean,
 *   order?: !Array<!HTMLElement>,
 *   list?: !HTMLElement,
 *   anchor?: ?Node,
 *   frame?: number,
 * }}
 */
let Drag;

/**
 * Enables drag-and-drop reordering of the entries of `container` that match
 * the selector `item`, by their drag handles (the selector `handle`). `key`
 * names the dataset field holding an entry's ID. `onStart` is called when a
 * drag starts, `onDrop` with the new order if it changed, and `onCancel` if
 * the order did not change or the drag was aborted. Returns a function that
 * disables the reordering again, removing its listeners.
 * @param {{
 *   container: !HTMLElement,
 *   item: string,
 *   handle: string,
 *   key: string,
 *   onStart?: function(): void,
 *   onDrop: function(!Array<string>): void,
 *   onCancel?: function(): void,
 * }} options
 * @return {function(): void}
 */
export function enableDragReorder(
    {container, item, handle, key, onStart, onDrop, onCancel}) {
  /**
   * The drag in progress, or null.
   * @type {?Drag}
   */
  let drag = null;

  /**
   * Returns the siblings of the dragged element, so that entries cannot be
   * moved between lists.
   * @return {!Array<!HTMLElement>}
   */
  const items = () => /** @type {!Array<!HTMLElement>} */ ([
    ...(drag?.element.parentElement ?? container).children,
  ].filter((node) => node.matches(item)));

  /**
   * Starts a drag on a press on a handle.
   * @param {!PointerEvent} event
   */
  const onPointerDown = (event) => {
    // Primary button or touch only.
    if (event.button !== 0 || drag) return;
    const grip = /** @type {!Element} */ (event.target).closest(handle);
    const element = grip?.closest(item);
    if (!grip || !(element instanceof HTMLElement)) return;

    drag = {
      element,
      grip,
      pointerId: event.pointerId,
      startY: event.clientY + window.scrollY,
      pointerY: event.clientY,
      active: false,
    };
    // Capture the pointer on the handle. Failing to capture is not fatal, as
    // the listeners are on the document.
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Continue without capture.
    }
  };

  /**
   * Starts the drag once the pointer has moved far enough, and moves the
   * dragged element with it.
   * @param {!PointerEvent} event
   */
  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.pointerY = event.clientY;

    if (!drag.active) {
      // Below the threshold, this is a click.
      if (Math.abs(offset(drag)) < THRESHOLD) return;
      // The list being reordered, and where the element goes back to.
      const list = drag.element.parentElement;
      if (!list) return;
      drag.active = true;
      drag.order = items();
      drag.list = list;
      drag.anchor = drag.element.nextSibling;
      drag.element.classList.add('is-dragging');
      list.classList.add('is-reordering');
      drag.frame = requestAnimationFrame(scrollAtEdges);
      onStart?.();
    }
    event.preventDefault();
    follow(drag);
  };

  /**
   * Returns how far the pointer has moved on the page since the drag started,
   * including what the page has scrolled meanwhile.
   * @param {!Drag} d the drag in progress
   * @return {number}
   */
  const offset = (d) => d.pointerY + window.scrollY - d.startY;

  /**
   * Moves the dragged element with the pointer, past the neighbours.
   * @param {!Drag} d the drag in progress
   */
  const follow = (d) => {
    const dy = offset(d);
    d.element.style.transform = `translatey(${dy}px)`;
    crossNeighbours(d, dy);
  };

  /**
   * Scrolls the page while the pointer is near the window's top or bottom
   * edge, the faster the closer, once per frame for as long as the drag lasts.
   */
  const scrollAtEdges = () => {
    if (!drag?.active) return;
    const y = drag.pointerY;
    const bottom = window.innerHeight - y;
    let speed = 0;
    if (y < EDGE) {
      speed = -MAX_SCROLL * (1 - Math.max(0, y) / EDGE);
    } else if (bottom < EDGE) {
      speed = MAX_SCROLL * (1 - Math.max(0, bottom) / EDGE);
    }
    const before = window.scrollY;
    if (speed !== 0) window.scrollBy(0, speed);
    if (window.scrollY !== before) follow(drag);
    drag.frame = requestAnimationFrame(scrollAtEdges);
  };

  /**
   * Ends the drag when the pointer is released (committed) or cancelled.
   * @param {!PointerEvent} event
   */
  const onPointerEnd = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finish(drag, event.type === 'pointerup');
  };

  /**
   * Escape cancels the drag.
   * @param {!KeyboardEvent} event
   */
  const onKeydown = (event) => {
    if (event.key !== 'Escape' || !drag?.active) return;
    event.preventDefault();
    finish(drag, false);
  };

  /**
   * Moves the dragged element past every neighbour whose middle it crossed.
   * @param {!Drag} d the drag in progress
   * @param {number} dy the pointer's distance from where the drag started
   */
  const crossNeighbours = (d, dy) => {
    const element = d.element;
    const middle = centre(element);
    for (const other of items()) {
      if (other === element) continue;
      const follows = element.compareDocumentPosition(other) &
          Node.DOCUMENT_POSITION_FOLLOWING;
      if (follows && middle > centre(other)) {
        return settle(d, other, 'after', dy);
      }
      if (!follows && middle < centre(other)) {
        return settle(d, other, 'before', dy);
      }
    }
  };

  /**
   * Moves the dragged element before or after `other`, keeping it under the
   * pointer.
   * @param {!Drag} d the drag in progress
   * @param {!Element} other
   * @param {string} where before or after
   * @param {number} dy
   */
  const settle = (d, other, where, dy) => {
    const element = d.element;
    const before = element.getBoundingClientRect().top;
    if (where === 'after') {
      other.after(element);
    } else {
      other.before(element);
    }
    const jump = element.getBoundingClientRect().top - before;
    // Compensate the layout jump caused by the DOM move.
    d.startY += jump;
    element.style.transform = `translatey(${dy - jump}px)`;
  };

  /**
   * Ends the drag; puts the element back and reports the new order if
   * `committed` and it changed.
   * @param {!Drag} d the drag in progress
   * @param {boolean} committed
   */
  const finish = (d, committed) => {
    const {element, grip, pointerId, active, order, list, anchor, frame} = d;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (grip.hasPointerCapture?.(pointerId)) {
      grip.releasePointerCapture(pointerId);
    }
    if (!active || !list || !order) {
      drag = null;
      return;
    }

    // Read the order before clearing the drag state, which items() needs.
    const now = items();
    drag = null;

    element.style.transform = '';
    element.classList.remove('is-dragging');
    list.classList.remove('is-reordering');
    list.insertBefore(element, anchor ?? null);
    const changed = committed && now.some((node, i) => node !== order[i]);
    if (changed) {
      onDrop(now.map((node) => node.dataset[key] ?? ''));
    } else {
      onCancel?.();
    }
  };

  // The moves and ends on the document, not the container: moving the
  // dragged element in the DOM (settle) releases the pointer capture, after
  // which the events go to whatever lies under the pointer, which may be
  // outside the container.
  container.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerEnd);
  document.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('keydown', onKeydown);
  return () => {
    if (drag) finish(drag, false);
    container.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerEnd);
    document.removeEventListener('pointercancel', onPointerEnd);
    document.removeEventListener('keydown', onKeydown);
  };
}

/**
 * Returns the vertical centre of an element on the screen.
 * @param {!Element} element
 * @return {number}
 */
const centre = (element) => {
  const box = element.getBoundingClientRect();
  return box.top + box.height / 2;
};
