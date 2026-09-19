// Drag-to-reorder for a vertical list of blocks.
//
// Pointer events rather than the HTML5 drag-and-drop API: that API is desktop
// only in practice, its drag image cannot be styled, and it would not survive
// the board's horizontal scrolling. Everything here works the same with a
// mouse, a pen and a finger.
//
// The dragged element is moved in the DOM as the pointer crosses its
// neighbours, so the gap opens where the block will land and no placeholder is
// needed. The price is the correction in `settle()`: a DOM move jumps the
// element's layout position, and the visual offset has to be reduced by exactly
// that jump or the block would leap out from under the pointer.

/** How far the pointer must travel before a press counts as a drag. */
const THRESHOLD = 4;

/**
 * @param {object} options
 * @param {HTMLElement} options.container  the list
 * @param {string} options.item            selector for one entry
 * @param {string} options.handle          selector for the part that starts a drag
 * @param {() => void} options.onStart     called once a drag really begins
 * @param {string} options.key             dataset field holding an entry's id
 * @param {(ids: string[]) => void} options.onDrop  new order, only when it changed
 * @param {() => void} options.onCancel    dropped without a change, or aborted
 */
export function enableDragReorder({ container, item, handle, key, onStart, onDrop, onCancel }) {
  let drag = null;

  /**
   * The entries a drag may rearrange: the dragged element's own siblings.
   *
   * Not everything in the container that matches — habit rows live in one list
   * per category, and a row must not be able to leave its block. Asking the
   * parent keeps that rule without the caller having to state it.
   */
  const items = () => [...(drag?.element.parentElement ?? container).children]
    .filter((node) => node.matches(item));

  container.addEventListener("pointerdown", (event) => {
    // Left button or touch only; a right-click on a handle must stay a
    // right-click.
    if (event.button !== 0 || drag) return;
    const grip = event.target.closest(handle);
    const element = grip?.closest(item);
    if (!element) return;

    drag = { element, grip, pointerId: event.pointerId, startY: event.clientY, active: false };
    // Capture on the handle: the pointer leaves it within a few pixels, and
    // without capture the move events would go to whatever is underneath.
    // A pointer id that is no longer active throws, and losing the capture is
    // not worth losing the drag over — the listeners sit on the container, and
    // the pointer stays inside it for all but the wildest gestures.
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // no capture, still draggable
    }
  });

  container.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;

    if (!drag.active) {
      // Below the threshold this is still a click, and a click must not leave
      // the list rearranged.
      if (Math.abs(dy) < THRESHOLD) return;
      drag.active = true;
      drag.order = items();
      // The list being rearranged, which for a habit row is its own block and
      // for a block is the board.
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

  // Escape puts everything back, the way it does in every dialog in this app.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    restore();
    finish(false);
  });

  /** Moves the dragged element past any neighbour whose middle it has passed. */
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
    // The element now sits `jump` further down (or up) than a moment ago. Both
    // the offset and the origin the next move measures from are corrected by
    // that amount, so the block stays exactly where the pointer left it.
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

    // Read the result while the drag is still on record: items() asks the
    // dragged element for its list, and clearing it first would leave that
    // question unanswerable.
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
