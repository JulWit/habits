// Search dialog for habits and categories, opened from the title bar or with
// "/". Selecting a result opens it.

import { subscribe, groupedHabits } from "./state.js";
import { habitIconBadge, categoryIconBadge, colorValue } from "./icons.js";
import * as H from "./habit-helpers.js";
import { t } from "./i18n.js";
import { openPage, closePage } from "./page-stack.js";
import { el } from "./dom.js";

let dialog;
let input;
let list;
let empty;
let clear;

/** The displayed results and the index of the selected one. */
let results = [];
let active = 0;

/** Callbacks set by app.js. */
let deps;

export function initSearch(handlers) {
  deps = handlers;
  dialog = document.getElementById("search-dialog");
  input = document.getElementById("search-input");
  list = document.getElementById("search-results");
  empty = document.getElementById("search-empty");

  const button = document.getElementById("open-search");
  button.addEventListener("click", openSearch);
  // Without a keyboard the shortcut in the title means nothing; screen readers
  // would still read it out.
  if (matchMedia("(pointer: coarse)").matches) button.title = t("Search");
  input.addEventListener("input", () => {
    active = 0;
    draw();
  });
  input.addEventListener("keydown", onKey);

  clear = document.getElementById("search-clear");
  clear.addEventListener("click", () => {
    input.value = "";
    active = 0;
    draw();
    input.focus();
  });

  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option) choose(results[Number(option.dataset.index)]);
  });
  // Pointer and arrow keys move the same selection.
  list.addEventListener("pointermove", (event) => {
    const option = event.target.closest("[data-index]");
    if (option && Number(option.dataset.index) !== active) {
      active = Number(option.dataset.index);
      mark();
    }
  });

  // Close on a click on the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePage(dialog);
  });

  // Update the results when the state changes.
  subscribe(() => {
    if (dialog.open) draw();
  });
}

export function openSearch() {
  if (dialog.open) return;
  input.value = "";
  active = 0;
  // Open first, so that draw() can measure the list.
  openPage(dialog);
  draw();
  input.focus();
}

/** Returns all searchable entries in board order. */
function candidates() {
  const out = [];
  for (const { category, habits } of groupedHabits()) {
    if (category) out.push({ kind: "category", item: category, habits });
    for (const habit of habits) out.push({ kind: "habit", item: habit, category });
  }
  return out;
}

function matches(entry, query) {
  if (query === "") return true;
  // Habits also match the name of their category.
  const text = entry.kind === "habit"
    ? `${entry.item.name} ${entry.category?.name ?? ""}`
    : entry.item.name;
  return text.toLowerCase().includes(query);
}

function draw() {
  const query = input.value.trim().toLowerCase();
  clear.hidden = input.value === "";
  results = candidates().filter((entry) => matches(entry, query));
  active = Math.min(active, Math.max(0, results.length - 1));

  list.replaceChildren(...results.map(option));
  list.hidden = results.length === 0;
  empty.hidden = results.length > 0;
  // Measure without the class's padding.
  list.classList.remove("is-scrolling");
  list.classList.toggle("is-scrolling", list.scrollHeight > list.clientHeight);
  mark();
}

function option(entry, index) {
  const isHabit = entry.kind === "habit";
  const meta = isHabit
    ? entry.category?.name ?? H.describeHabit(entry.item)
    : entry.habits.length === 1
      ? t("Category · 1 habit")
      : t("Category · {n} habits", { n: entry.habits.length });

  return el("div", {
    class: ["search-option", isHabit && entry.item.archivedAt ? "is-archived" : ""],
    id: `search-option-${index}`,
    data: { index },
    role: "option",
  },
    optionDot(entry),
    el("span", { class: "search-option-name" }, entry.item.name),
    el("span", { class: "search-option-meta" }, meta),
  );
}

/** Returns the icon of a result, or a dot if it has none. */
function optionDot({ kind, item }) {
  if (kind === "habit") {
    return habitIconBadge(item, "habit-icon is-small") ??
      el("span", { class: "dot", style: { "--habit-color": colorValue(item.color) } });
  }
  return categoryIconBadge(item, "habit-icon is-small") ?? el("span", { class: "dot is-category" });
}

/** Highlights the selected result and scrolls it into view. */
function mark() {
  for (const node of list.children) {
    node.setAttribute("aria-selected", String(Number(node.dataset.index) === active));
  }
  const current = list.children[active];
  if (current) {
    input.setAttribute("aria-activedescendant", current.id);
    current.scrollIntoView({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function onKey(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (results.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    active = (active + step + results.length) % results.length;
    mark();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (results[active]) choose(results[active]);
  }
}

async function choose(entry) {
  if (!entry) return;
  // The view takes the search's place in the history once its entry is gone.
  await closePage(dialog);
  if (entry.kind === "habit") deps.openHabit(entry.item.id);
  else deps.openCategory(entry.item.id);
}
