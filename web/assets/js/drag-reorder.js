// Drag-and-drop reordering of a vertical list, based on pointer events (mouse,
// pen and touch). The dragged element is moved in the DOM while dragging;
// settle() compensates the resulting layout jump. When the drag ends, the
// element goes back to where it was and the new order is reported: the list
// is rendered by Vue, which moves the elements itself and must find them
// where it left them. Its user keeps the list from changing during a drag.

/** Minimum pointer movement in pixels before a press starts a drag. */
const THRESHOLD = 4;

/**
 * Enables drag-and-drop reordering of the entries of `container` that match
 * the selector `item`, by their drag handles (the selector `handle`). `key`
 * names the dataset field holding an entry's ID. `onStart` is called when a
 * drag starts, `onDrop` with the new order if it changed, and `onCancel` if
 * the order did not change or the drag was aborted.
 * @param {{
 *   container: !HTMLElement,
 *   item: string,
 *   handle: string,
 *   key: string,
 *   onStart: (function(): void|undefined),
 *   onDrop: function(!Array<string>): void,
 *   onCancel: (function(): void|undefined),
 * }} options
 */
export function enableDragReorder(
    {container, item, handle, key, onStart, onDrop, onCancel}) {
  /**
   * The drag in progress, from the press on a handle on. `order`, `list` and
   * `anchor` are set once the pointer has moved far enough to start it.
   * @type {?{
   *   element: !HTMLElement,
   *   grip: !Element,
   *   pointerId: number,
   *   startY: number,
   *   active: boolean,
   *   order: (!Array<!HTMLElement>|undefined),
   *   list: (!HTMLElement|undefined),
   *   anchor: (?Node|undefined),
   * }}
   */
  let drag = null;

  /**
   * Returns the siblings of the dragged element, so that entries cannot be
   * moved between lists.
   * @return {!Array<!HTMLElement>}
   */
  const items =
      () => [...(drag?.element.parentElement ?? container).children].filter(
          (node) => node.matches(item));

  container.addEventListener('pointerdown', (event) => {
    // Primary button or touch only.
    if (event.button !== 0 || drag) return;
    const grip = event.target.closest(handle);
    const element = grip?.closest(item);
    if (!element) return;

    drag = {
      element,
      grip,
      pointerId: event.pointerId,
      startY: event.clientY,
      active: false,
    };
    // Capture the pointer on the handle. Failing to capture is not fatal, as
    // the listeners are on the container.
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Continue without capture.
    }
  });

  container.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;

    if (!drag.active) {
      // Below the threshold, this is a click.
      if (Math.abs(dy) < THRESHOLD) return;
      drag.active = true;
      drag.order = items();
      // The list being reordered, and where the element goes back to.
      drag.list = drag.element.parentElement;
      drag.anchor = drag.element.nextSibling;
      drag.element.classList.add('is-dragging');
      drag.list.classList.add('is-reordering');
      onStart?.();
    }
    event.preventDefault();
    drag.element.style.transform = `translateY(${dy}px)`;
    crossNeighbours(dy);
  });

  for (const type of ['pointerup', 'pointercancel']) {
    container.addEventListener(type, (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      finish(type === 'pointerup');
    });
  }

  // Escape cancels the drag.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !drag?.active) return;
    event.preventDefault();
    finish(false);
  });

  /**
   * Moves the dragged element past every neighbour whose middle it crossed.
   * @param {number} dy the pointer's distance from where the drag started
   */
  const crossNeighbours = (dy) => {
    const element = drag.element;
    const middle = centre(element);
    for (const other of items()) {
      if (other === element) continue;
      const follows = element.compareDocumentPosition(other) &
          Node.DOCUMENT_POSITION_FOLLOWING;
      if (follows && middle > centre(other)) return settle(other, 'after', dy);
      if (!follows && middle < centre(other)) {
        return settle(other, 'before', dy);
      }
    }
  };

  /**
   * Moves the dragged element before or after `other`, keeping it under the
   * pointer.
   * @param {!Element} other
   * @param {string} where before or after
   * @param {number} dy
   */
  const settle = (other, where, dy) => {
    const element = drag.element;
    const before = element.getBoundingClientRect().top;
    if (where === 'after') {
      other.after(element);
    } else {
      other.before(element);
    }
    const jump = element.getBoundingClientRect().top - before;
    // Compensate the layout jump caused by the DOM move.
    drag.startY += jump;
    element.style.transform = `translateY(${dy - jump}px)`;
  };

  /**
   * Ends the drag; puts the element back and reports the new order if
   * `committed` and it changed.
   * @param {boolean} committed
   */
  const finish = (committed) => {
    const {element, grip, pointerId, active, order, list, anchor} = drag;
    if (grip.hasPointerCapture?.(pointerId)) {
      grip.releasePointerCapture(pointerId);
    }
    if (!active) {
      drag = null;
      return;
    }

    // Read the order before clearing the drag state, which items() needs.
    const now = items();
    drag = null;

    element.style.transform = '';
    element.classList.remove('is-dragging');
    list.classList.remove('is-reordering');
    list.insertBefore(element, anchor);
    const changed = committed && now.some((node, i) => node !== order[i]);
    if (changed) {
      onDrop(now.map((node) => node.dataset[key]));
    } else {
      onCancel?.();
    }
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
