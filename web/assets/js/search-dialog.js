/**
 * @fileoverview Search dialog for habits and categories, opened from the title
 * bar or with "/". Selecting a result opens it.
 */

import * as habitHelpers from './habit-helpers.js';
import {t} from './i18n.js';
import {colorValue, hasHabitIcon} from './icons.js';
import {closePage, openPage} from './page-stack.js';
import {openCategory, openHabit} from './route.js';
import {groupedHabits} from './state.js';
import {computed, nextTick, onMounted, ref, watch} from './vue.js';

/**
 * A search result: a habit with its category, or a category with its habits.
 * @typedef {{
 *   kind: string,
 *   item: (!Habit|!Category),
 *   category: (?Category|undefined),
 *   habits: (!Array<!Habit>|undefined),
 * }}
 */
let SearchEntry;

/** The query as typed. */
const query = ref('');

/** The index of the selected result. */
const active = ref(0);

/** Counts the openings, so the list is measured once it can be. */
const openings = ref(0);

/**
 * The dialog, once mounted.
 * @type {?HTMLDialogElement}
 */
let dialog = null;

/**
 * Opens the search with an empty query.
 */
export function openSearch() {
  if (dialog.open) return;
  query.value = '';
  active.value = 0;
  openPage(dialog);
  openings.value++;
  dialog.querySelector('input').focus();
}

/**
 * Returns all searchable entries in board order.
 * @return {!Array<!SearchEntry>}
 */
function candidates() {
  const out = [];
  for (const {category, habits} of groupedHabits()) {
    if (category) out.push({kind: 'category', item: category, habits});
    for (const habit of habits) {
      out.push({kind: 'habit', item: habit, category});
    }
  }
  return out;
}

/**
 * Reports whether an entry matches the query, which is in lower case.
 * @param {!SearchEntry} entry
 * @param {string} text
 * @return {boolean}
 */
function matches(entry, text) {
  if (text === '') return true;
  // Habits also match the name of their category.
  const name = entry.kind === 'habit' ?
      `${entry.item.name} ${entry.category?.name ?? ''}` :
      entry.item.name;
  return name.toLowerCase().includes(text);
}

/**
 * Returns the detail shown after a result: for a habit its category, or
 * without one its target; for a category its number of habits.
 * @param {!SearchEntry} entry
 * @return {string}
 */
function meta(entry) {
  if (entry.kind === 'habit') {
    return entry.category?.name ?? habitHelpers.describeHabit(entry.item);
  }
  const n = entry.habits.length;
  return n === 1 ? t('Category · 1 habit') : t('Category · {n} habits', {n});
}

/**
 * Returns the element ID of the result at `index`.
 * @param {number} index
 * @return {string}
 */
function optionId(index) {
  return `search-option-${index}`;
}

/**
 * Closes the search and opens the chosen habit or category.
 * @param {!SearchEntry|undefined} entry
 * @return {!Promise<void>}
 */
async function choose(entry) {
  if (!entry) return;
  // The view takes the search's place in the history once its entry is gone.
  await closePage(dialog);
  if (entry.kind === 'habit') {
    openHabit(entry.item.id);
  } else {
    openCategory(entry.item.id);
  }
}

/** The search dialog (see openSearch). The input controls the list. */
export const TheSearchDialog = {
  name: 'TheSearchDialog',
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    const el = ref(null);
    const input = ref(null);
    const list = ref(null);
    const scrolling = ref(false);
    onMounted(() => {
      dialog = el.value;
    });

    const results = computed(() => {
      const text = query.value.trim().toLowerCase();
      return candidates().filter((entry) => matches(entry, text));
    });
    // A new query selects the first result; a shorter list keeps the
    // selection within it.
    watch(query, () => {
      active.value = 0;
    });
    watch(results, (now) => {
      active.value = Math.min(active.value, Math.max(0, now.length - 1));
    });

    // The list gets room for its scrollbar only when it overflows (measured
    // without the class's padding), and the selection stays in view.
    watch([results, active, openings], async () => {
      await nextTick();
      if (!list.value) return;
      scrolling.value = false;
      await nextTick();
      scrolling.value = list.value.scrollHeight > list.value.clientHeight;
      list.value.children[active.value]?.scrollIntoView({block: 'nearest'});
    }, {flush: 'post'});

    /**
     * Moves the selection with the arrow keys and chooses it with Enter.
     * @param {!KeyboardEvent} event
     */
    const onKey = (event) => {
      const count = results.value.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (count === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active.value = (active.value + step + count) % count;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(results.value[active.value]);
      }
    };

    return {
      el,
      input,
      list,
      scrolling,
      query,
      active,
      results,
      optionId,
      // The option the arrow keys point at, for screen readers.
      activeOption: computed(
          () =>
              results.value[active.value] ? optionId(active.value) : undefined),
      /**
       * Reports whether a result is an archived habit.
       * @param {!SearchEntry} entry
       * @return {boolean}
       */
      isArchived: (entry) =>
          entry.kind === 'habit' && Boolean(entry.item.archivedAt),
      meta,
      choose,
      onKey,
      colorValue,
      hasHabitIcon,
      clear: () => {
        query.value = '';
        input.value.focus();
      },
      /**
       * Closes the search on a click on the backdrop.
       * @param {!MouseEvent} event
       */
      onBackdrop: (event) => {
        if (event.target === el.value) closePage(el.value);
      },
    };
  },
  // Pointer and arrow keys move the same selection. Our own clear button:
  // Firefox has none, Chrome's is hidden. A result without an icon gets a
  // dot.
  template: `
    <dialog
      id="search-dialog"
      ref="el"
      class="dialog search-dialog"
      :aria-label="t('Search')"
      @click="onBackdrop"
    >
      <div class="search-field">
        <span
          class="search-icon"
          aria-hidden="true"
        >
          <app-icon name="search"/>
        </span>
        <input
          id="search-input"
          ref="input"
          v-model="query"
          type="search"
          class="search-input"
          :placeholder="t('Search habits and categories…')"
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('Search habits and categories')"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="search-results"
          :aria-activedescendant="activeOption"
          @keydown="onKey"
        >
        <button
          v-if="query !== ''"
          class="icon-button search-clear"
          type="button"
          :title="t('Clear search')"
          :aria-label="t('Clear search')"
          @click="clear"
        >
          <app-icon name="close"/>
        </button>
      </div>
      <div
        id="search-results"
        ref="list"
        class="search-results"
        role="listbox"
        :aria-label="t('Results')"
        :class="{'is-scrolling': scrolling}"
        :hidden="results.length === 0"
      >
        <div
          v-for="(entry, i) in results"
          :key="entry.kind + entry.item.id"
          :id="optionId(i)"
          class="search-option"
          :class="{'is-archived': isArchived(entry)}"
          role="option"
          :aria-selected="String(i === active)"
          @click="choose(entry)"
          @pointermove="active = i"
        >
          <template v-if="entry.kind === 'habit'">
            <app-icon-badge
              v-if="hasHabitIcon(entry.item.icon)"
              class="habit-icon is-small"
              :icon="entry.item.icon"
              :color="entry.item.color"
            />
            <span
              v-else
              class="color-dot"
              :style="{'--habit-color': colorValue(entry.item.color)}"
            ></span>
          </template>
          <template v-else>
            <app-icon-badge
              v-if="hasHabitIcon(entry.item.icon)"
              class="habit-icon is-small"
              :icon="entry.item.icon"
              :color="entry.item.color || null"
            />
            <span
              v-else
              class="color-dot is-category"
            ></span>
          </template>
          <span class="search-option-name">{{ entry.item.name }}</span>
          <span class="search-option-meta">{{ meta(entry) }}</span>
        </div>
      </div>
      <p
        v-if="results.length === 0"
        class="search-empty"
      >
        {{ t('No habit or category matches.') }}
      </p>
    </dialog>`,
};
