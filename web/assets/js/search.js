// The search dialog: a quick jump to a habit or a category, opened from the
// title bar or with "/". It does not filter the board - a modal lies over the
// board, so a filter behind it would change something no one can see. Picking a
// result opens it instead, which is what one searches a list of names for.

import { subscribe, groupedHabits } from "./state.js";
import { habitIconBadge, categoryIconBadge } from "./icons.js";
import * as H from "./habit.js";

let dialog;
let input;
let list;
let empty;

/** The results as drawn, in order, and which of them Enter would open. */
let results = [];
let active = 0;

let deps = { openHabit: () => {}, openCategory: () => {} };

export function initSearch(handlers) {
  deps = { ...deps, ...handlers };
  dialog = document.getElementById("search-dialog");
  input = document.getElementById("search-input");
  list = document.getElementById("search-results");
  empty = document.getElementById("search-empty");

  document.getElementById("open-search").addEventListener("click", openSearch);
  input.addEventListener("input", () => {
    active = 0;
    draw();
  });
  input.addEventListener("keydown", onKey);

  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option) choose(results[Number(option.dataset.index)]);
  });
  // The pointer and the arrow keys share one highlight, so Enter always opens
  // what is marked - whichever of the two marked it last.
  list.addEventListener("pointermove", (event) => {
    const option = event.target.closest("[data-index]");
    if (option && Number(option.dataset.index) !== active) {
      active = Number(option.dataset.index);
      mark();
    }
  });

  // A click on the backdrop lands on the dialog element itself, outside its
  // content box; a modal only closes on Escape by default.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  // The state can change while the dialog is open - an undo, another tab - and
  // the list should not offer something that has just gone.
  subscribe(() => {
    if (dialog.open) draw();
  });
}

export function openSearch() {
  if (dialog.open) return;
  input.value = "";
  active = 0;
  // Shown first: a closed dialog lays nothing out, and draw() measures the list.
  dialog.showModal();
  draw();
  input.focus();
}

/** Everything that can be jumped to, in the order the board shows it. */
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
  // A habit is found by its category's name too: typing "Sport" should list
  // what is filed under it, not only the category itself.
  const text = entry.kind === "habit"
    ? `${entry.item.name} ${entry.category?.name ?? ""}`
    : entry.item.name;
  return text.toLowerCase().includes(query);
}

function draw() {
  const query = input.value.trim().toLowerCase();
  results = candidates().filter((entry) => matches(entry, query));
  active = Math.min(active, Math.max(0, results.length - 1));

  list.replaceChildren(...results.map(option));
  list.hidden = results.length === 0;
  empty.hidden = results.length > 0;
  // Measured without the padding the class adds, so the answer does not
  // depend on the previous one.
  list.classList.remove("is-scrolling");
  list.classList.toggle("is-scrolling", list.scrollHeight > list.clientHeight);
  mark();
}

function option(entry, index) {
  const el = document.createElement("div");
  el.className = "search-option";
  el.id = `search-option-${index}`;
  el.dataset.index = String(index);
  el.setAttribute("role", "option");

  // A habit or category with an icon shows it in place of its dot.
  let dot = entry.kind === "habit"
    ? habitIconBadge(entry.item, "habit-icon is-small")
    : categoryIconBadge(entry.item, "habit-icon is-small");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = entry.kind === "habit" ? "dot" : "dot is-category";
    if (entry.kind === "habit") dot.style.setProperty("--habit-color", entry.item.color);
  }

  const name = document.createElement("span");
  name.className = "search-option-name";
  name.textContent = entry.item.name;

  const meta = document.createElement("span");
  meta.className = "search-option-meta";
  meta.textContent = entry.kind === "habit"
    ? entry.category?.name ?? H.describeHabit(entry.item)
    : entry.habits.length === 1 ? "Category · 1 habit" : `Category · ${entry.habits.length} habits`;

  el.append(dot, name, meta);
  if (entry.kind === "habit" && entry.item.archivedAt) el.classList.add("is-archived");
  return el;
}

/** Moves the highlight and keeps it in view. */
function mark() {
  for (const el of list.children) {
    el.setAttribute("aria-selected", String(Number(el.dataset.index) === active));
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

function choose(entry) {
  if (!entry) return;
  dialog.close();
  if (entry.kind === "habit") deps.openHabit(entry.item.id);
  else deps.openCategory(entry.item.id);
}
