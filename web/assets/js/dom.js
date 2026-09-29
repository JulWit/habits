// Helpers for building DOM elements.

/**
 * Creates an element with `props` and `children`.
 *
 * Props:
 * - `class`: a string, or an array whose empty and false entries are dropped,
 *   so conditional classes read `cond && "is-x"`.
 * - `data`: an object of data attributes.
 * - `style`: an object of style properties, e.g. custom properties.
 * - keys the element has as a property (`type`, `title`, `disabled`,
 *   `checked`) are set as properties, all others (`aria-label`, `for`) as
 *   attributes.
 * Props and data or style entries that are null or undefined are left out.
 *
 * Children are nodes or text; null, undefined, false and "" are left out, so
 * optional children can be passed as `cond && child`. Numbers, including 0,
 * are shown as text.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') {
      node.className =
          Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'data') {
      for (const [name, v] of defined(value)) {
        node.dataset[name] = v;
      }
    } else if (key === 'style') {
      for (const [name, v] of defined(value)) {
        node.style.setProperty(name, v);
      }
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  node.append(...children.filter((c) => c != null && c !== false && c !== ''));
  return node;
}

/**
 * Returns the entries of `object` whose value is neither null nor undefined.
 */
function defined(object) {
  return Object.entries(object).filter(([, v]) => v != null);
}

/**
 * Parses trusted markup, such as the icons in icons.js, into nodes that can be
 * passed as children to `el`. Never pass user input.
 */
export function markup(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}
