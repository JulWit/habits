/**
 * @fileoverview Title bar of the habit, category, day statistics and style
 * guide views, as Material's top app bar: back, title, edit, and an overflow
 * menu (⋮) for rare and destructive actions. The app's own title bar is hidden
 * on these views (see views.css).
 */

import {onMounted, onUnmounted, ref} from '../vue.js';

/** @import {Ref} from '../vue.js' */

/**
 * An item of the overflow menu; `icon` names one of `ICONS`.
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
  /**
   * @param {{title: string, sub: string, edit: boolean, menu:
   *     !Array<!MenuItem>}} props
   * @param {{emit: function(string, ...*)}} context
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props, {emit}) {
    const menuId = `app-bar-menu-${++count}`;
    /** @type {!Ref<?HTMLButtonElement>} */
    const menuButton = ref(null);
    /** @type {!Ref<?HTMLElement>} */
    const menuEl = ref(null);
    const expanded = ref(false);

    /**
     * Places the menu when it opens and focuses its first item.
     * @param {!ToggleEvent} event
     */
    const onToggle = (event) => {
      expanded.value = event.newState === 'open';
      if (!expanded.value) return;
      place(menuEl.value, menuButton.value);
      menuEl.value.querySelector('button')?.focus();
    };

    /**
     * Returns the focus to the button when the menu closes. The browser does
     * so only if the button had it before, which a tap does not guarantee.
     * @param {!ToggleEvent} event
     */
    const onBeforeToggle = (event) => {
      if (event.newState === 'closed' &&
          menuEl.value.contains(document.activeElement)) {
        menuButton.value?.focus({preventScroll: true});
      }
    };

    /**
     * Closes the menu and passes on the chosen action.
     * @param {!MenuItem} item
     */
    const choose = (item) => {
      menuEl.value.hidePopover();
      emit('action', item.action);
    };

    // A menu placed for the old layout would float in the wrong place.
    /** Closes the menu when the window changes size. */
    const closeOnResize = () => {
      if (menuEl.value?.matches(':popover-open')) menuEl.value.hidePopover();
    };
    onMounted(() => window.addEventListener('resize', closeOnResize));
    onUnmounted(() => window.removeEventListener('resize', closeOnResize));

    return {
      menuId,
      menuButton,
      menuEl,
      expanded,
      onToggle,
      onBeforeToggle,
      choose,
      onMenuKey,
    };
  },
  template: `
    <header class="app-bar">
      <button
        v-tooltip="t('Back')"
        class="icon-button"
        type="button"
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
          v-tooltip="t('Edit')"
          class="icon-button"
          type="button"
          :aria-label="t('Edit')"
          @click="$emit('edit')"
        >
          <app-icon name="edit"/>
        </button>
        <template v-if="menu.length > 0">
          <button
            ref="menuButton"
            v-tooltip="t('More options')"
            type="button"
            class="icon-button"
            :aria-label="t('More options')"
            aria-haspopup="menu"
            :aria-expanded="String(expanded)"
            :popovertarget="menuId"
          >
            <app-icon name="moreVertical"/>
          </button>
          <div
            ref="menuEl"
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
              @click="choose(item)"
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
  const menu = /** @type {!HTMLElement} */ (event.currentTarget);
  const items = [...menu.querySelectorAll('button')];
  const at = items.findIndex((button) => button === document.activeElement);
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
