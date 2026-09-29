// Title bar of the habit and category views, as Material's top app bar: back,
// title, edit, and an overflow menu (⋮) for rare and destructive actions. The
// app's own title bar is hidden on these views (see base.css).
//
// The buttons carry data-action ("back", "edit" and the menu's actions); the
// view handles their clicks.

import {el, markup} from './dom.js';
import {t} from './i18n.js';
import {icons} from './icons.js';

/**
 * An item of the overflow menu.
 * @typedef {{action: string, label: string, icon: string, danger: boolean}}
 */
let MenuItem;

/**
 * Builds the title bar: `title` is the name of the habit or category, `sub` a
 * detail shown after it, set off by a dot, and `badge` is shown before it.
 * `edit` adds an edit button, and `menu` holds the overflow menu's items; an
 * empty list omits the menu.
 * @param {{
 *   title: string,
 *   sub: (string|undefined),
 *   badge: (?Node|undefined),
 *   edit: (boolean|undefined),
 *   menu: !Array<!MenuItem>,
 * }} bar
 * @return {!HTMLElement}
 */
export function appBar({title, sub = '', badge = null, edit = true, menu}) {
  return el(
      'header',
      {class: 'app-bar'},
      iconButton('back', icons.arrowLeft, t('Back')),
      el(
          'div',
          {class: 'app-bar-title'},
          el('h2', {}, badge, el('span', {class: 'name'}, title)),
          // In a span of its own, as the stylesheet draws the dot before it.
          sub &&
              el('span', {class: 'sub'}, el('span', {class: 'sub-part'}, sub)),
          ),
      el(
          'div',
          {class: 'app-bar-actions'},
          edit && iconButton('edit', icons.edit, t('Edit')),
          ...(menu.length > 0 ? overflowMenu(menu) : []),
          ),
  );
}

/**
 * Builds an icon button with its label.
 * @param {string} action
 * @param {string} icon SVG markup
 * @param {string} label
 * @return {!HTMLElement}
 */
function iconButton(action, icon, label) {
  return el(
      'button', {
        class: 'icon-button',
        type: 'button',
        data: {action},
        title: label,
        'aria-label': label,
      },
      markup(icon));
}

/** The number of menus built, for their IDs. */
let count = 0;

/**
 * Returns the ⋮ button and its menu, to be inserted side by side. A chosen item
 * closes the menu; its click then bubbles with its data-action like any other
 * button of the view.
 *
 * The menu is a popover: it closes on a click outside, on Escape and on the
 * system back gesture, and returns the focus to its button.
 * @param {!Array<!MenuItem>} items
 * @return {!Array<!HTMLElement>}
 */
function overflowMenu(items) {
  const id = `overflow-menu-${++count}`;

  const button =
      el('button', {
        type: 'button',
        class: 'icon-button',
        title: t('More options'),
        'aria-label': t('More options'),
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        popovertarget: id,
      },
         markup(icons.moreVertical));

  const menu = el(
      'div',
      {id, class: 'overflow-menu', popover: 'auto', role: 'menu'},
      ...items.map(
          (item) =>
              el('button', {
                type: 'button',
                class: ['overflow-item', item.danger && 'is-danger'],
                data: {action: item.action},
                role: 'menuitem',
              },
                 icons[item.icon] && markup(icons[item.icon]),
                 el('span', {}, item.label))),
  );

  menu.addEventListener('toggle', (event) => {
    const open = event.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    place(menu, button);
    menu.querySelector('[role="menuitem"]')?.focus();
  });
  // Escape returns the focus to the button. The browser does so only if the
  // button had it before, which a tap does not guarantee.
  menu.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'closed' && menu.contains(document.activeElement)) {
      button.focus({preventScroll: true});
    }
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('[role="menuitem"]')) menu.hidePopover();
  });
  menu.addEventListener('keydown', onKey);

  return [button, menu];
}

/**
 * Aligns the menu's right edge with the button, just below it.
 * @param {!HTMLElement} menu
 * @param {!HTMLElement} button
 */
function place(menu, button) {
  const box = button.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  menu.style.right =
      `${Math.round(document.documentElement.clientWidth - box.right)}px`;
}

/**
 * Arrow keys move between the items; Escape stays with the menu.
 * @param {!KeyboardEvent} event
 */
function onKey(event) {
  const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement);
  let next = -1;
  switch (event.key) {
    case 'ArrowDown':
      next = (at + 1) % items.length;
      break;
    case 'ArrowUp':
      next = (at - 1 + items.length) % items.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    // The popover closes itself; the view must not also go back.
    case 'Escape':
      event.stopPropagation();
      return;
    default:
      return;
  }
  event.preventDefault();
  items[next].focus();
}

// A menu placed for the old layout would float in the wrong place.
window.addEventListener('resize', () => {
  for (const menu of document.querySelectorAll('.overflow-menu:popover-open')) {
    menu.hidePopover();
  }
});
