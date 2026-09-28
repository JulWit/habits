// Drag-and-drop reordering of a vertical list, based on pointer events (mouse,
// pen and touch). The dragged element is moved in the DOM while dragging;
// settle() compensates the resulting layout jump.

/** Minimum pointer movement in pixels before a press starts a drag. */
const THRESHOLD = 4;

/**
 * Enables drag-and-drop reordering.
 * @param {object} options
 * @param {HTMLElement} options.container  the list
 * @param {string} options.item            selector of an entry
 * @param {string} options.handle          selector of the drag handle
 * @param {() => void} options.onStart     called when a drag starts
 * @param {string} options.key             dataset field holding an entry's ID
 * @param {(ids: string[]) => void} options.onDrop  called with the new order if it changed
 * @param {() => void} options.onCancel    called if the order did not change or the drag was aborted
 */
export function enableDragReorder({ container, item, handle, key, onStart, onDrop, onCancel }) {
  let drag = null;

  /**
   * Returns the siblings of the dragged element, so that entries cannot be
   * moved between lists.
   */
  const items = () => [...(drag?.element.parentElement ?? container).children]
    .filter((node) => node.matches(item));

  container.addEventListener("pointerdown", (event) => {
    // Primary button or touch only.
    if (event.button !== 0 || drag) return;
    const grip = event.target.closest(handle);
    const element = grip?.closest(item);
    if (!element) return;

    drag = { element, grip, pointerId: event.pointerId, startY: event.clientY, active: false };
    // Capture the pointer on the handle. Failing to capture is not fatal, as
    // the listeners are on the container.
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Continue without capture.
    }
  });

  container.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;

    if (!drag.active) {
      // Below the threshold, this is a click.
      if (Math.abs(dy) < THRESHOLD) return;
      drag.active = true;
      drag.order = items();
      // The list being reordered.
      drag.list = drag.element.parentElement;
      drag.element.classList.add("is-dragging");
      drag.list.classList.add("is-reordering");
      onStart?.();
    }
    event.preventDefault();
    drag.element.style.transform = `translateY(${dy}px)`;
    crossNeighbours(dy);
  });

  for (const type of ["pointerup", "pointercancel"]) {
    container.addEventListener(type, (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      finish(type === "pointerup");
    });
  }

  // Escape cancels the drag.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    restore();
    finish(false);
  });

  /** Moves the dragged element past every neighbour whose middle it crossed. */
  function crossNeighbours(dy) {
    const element = drag.element;
    const middle = centre(element);
    for (const other of items()) {
      if (other === element) continue;
      const follows = element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (follows && middle > centre(other)) return settle(other, "after", dy);
      if (!follows && middle < centre(other)) return settle(other, "before", dy);
    }
  }

  function settle(other, where, dy) {
    const element = drag.element;
    const before = element.getBoundingClientRect().top;
    if (where === "after") other.after(element);
    else other.before(element);
    const jump = element.getBoundingClientRect().top - before;
    // Compensate the layout jump caused by the DOM move.
    drag.startY += jump;
    element.style.transform = `translateY(${dy - jump}px)`;
  }

  function restore() {
    for (const element of drag.order) drag.list.append(element);
  }

  function finish(committed) {
    const { element, grip, pointerId, active, order, list } = drag;
    if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
    if (!active) {
      drag = null;
      return;
    }

    // Read the order before clearing the drag state, which items() needs.
    const now = items();
    drag = null;

    element.style.transform = "";
    element.classList.remove("is-dragging");
    list.classList.remove("is-reordering");
    const changed = committed && now.some((node, i) => node !== order[i]);
    if (changed) onDrop(now.map((node) => node.dataset[key]));
    else onCancel?.();
  }
}

const centre = (element) => {
  const box = element.getBoundingClientRect();
  return box.top + box.height / 2;
};
