// Title bar of the habit, category and day statistics views, as Material's top
// app bar: back, title, edit, and an overflow menu (⋮) for rare and
// destructive actions. The app's own title bar is hidden on these views (see
// components.css).

/**
 * An item of the overflow menu; `icon` names one of `icons`.
 * @typedef {{action: string, label: string, icon: string, danger:
 *     (boolean|undefined)}}
 */
let MenuItem;

/** The number of menus built, for their IDs. */
let count = 0;

/**
 * The title bar: `title` is the name of the habit or category, `sub` a detail
 * shown after it, set off by a dot, and the slot `badge` is shown before it.
 * `edit` adds an edit button, and `menu` holds the overflow menu's items; an
 * empty list omits the menu. Emits `back`, `edit` and `action` with the
 * chosen item's action.
 *
 * The menu is a popover: it closes on a click outside, on Escape and on the
 * system back gesture, and returns the focus to its button.
 */
export const AppBar = {
  name: 'AppBar',
  props: {
    title: {type: String, required: true},
    sub: {type: String, default: ''},
    edit: {type: Boolean, default: true},
    menu: {type: Array, default: () => []},
  },
  emits: ['back', 'edit', 'action'],
  setup(props, {emit}) {
    const menuId = `app-bar-menu-${++count}`;

    /**
     * Places the menu when it opens and focuses its first item.
     * @param {!ToggleEvent} event
     */
    const onToggle = (event) => {
      const menu = event.target;
      const button = document.querySelector(`[popovertarget="${menuId}"]`);
      button.setAttribute('aria-expanded', String(event.newState === 'open'));
      if (event.newState !== 'open') return;
      place(menu, button);
      menu.querySelector('[role="menuitem"]')?.focus();
    };

    /**
     * Returns the focus to the button when the menu closes. The browser does
     * so only if the button had it before, which a tap does not guarantee.
     * @param {!ToggleEvent} event
     */
    const onBeforeToggle = (event) => {
      if (event.newState === 'closed' &&
          event.target.contains(document.activeElement)) {
        document.querySelector(`[popovertarget="${menuId}"]`)?.focus({
          preventScroll: true,
        });
      }
    };

    /**
     * Closes the menu and passes on the chosen action.
     * @param {!MenuItem} item
     * @param {!Event} event
     */
    const choose = (item, event) => {
      event.currentTarget.closest('[popover]').hidePopover();
      emit('action', item.action);
    };

    return {menuId, onToggle, onBeforeToggle, choose, onMenuKey};
  },
  template: `
    <header class="app-bar">
      <button
        class="icon-button"
        type="button"
        :title="t('Back')"
        :aria-label="t('Back')"
        @click="$emit('back')"
      >
        <app-icon name="arrowLeft"/>
      </button>
      <div class="app-bar-title">
        <h2><slot name="badge"/><span class="app-bar-name">{{ title }}</span>
        </h2>
        <!-- In a span of its own, as the stylesheet draws the dot before
             it. -->
        <span
          v-if="sub"
          class="app-bar-sub"
        >
          <span class="app-bar-sub-part">{{ sub }}</span>
        </span>
      </div>
      <div class="app-bar-actions">
        <button
          v-if="edit"
          class="icon-button"
          type="button"
          :title="t('Edit')"
          :aria-label="t('Edit')"
          @click="$emit('edit')"
        >
          <app-icon name="edit"/>
        </button>
        <template v-if="menu.length > 0">
          <button
            type="button"
            class="icon-button"
            :title="t('More options')"
            :aria-label="t('More options')"
            aria-haspopup="menu"
            aria-expanded="false"
            :popovertarget="menuId"
          >
            <app-icon name="moreVertical"/>
          </button>
          <div
            :id="menuId"
            class="app-bar-menu"
            popover="auto"
            role="menu"
            @toggle="onToggle"
            @beforetoggle="onBeforeToggle"
            @keydown="onMenuKey"
          >
            <button
              v-for="item in menu"
              :key="item.action"
              type="button"
              class="app-bar-menu-item"
              :class="{'is-danger': item.danger}"
              role="menuitem"
              @click="choose(item, $event)"
            >
              <app-icon :name="item.icon"/><span>{{ item.label }}</span>
            </button>
          </div>
        </template>
      </div>
    </header>`,
};

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
function onMenuKey(event) {
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
  for (const menu of document.querySelectorAll('.app-bar-menu:popover-open')) {
    menu.hidePopover();
  }
});
