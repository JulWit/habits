// Category detail view: its habits and its perfect days, i.e. days on which
// every scheduled habit of the category was completed.

import { t } from "./i18n.js";
import { state, categoryById } from "./state.js";
import * as H from "./habit-helpers.js";
import { habitIconBadge, categoryIconBadge, colorValue } from "./icons.js";
import { appBar } from "./app-bar.js";
import { openCategoryEditor } from "./category-editor.js";
import { statRow, factsPanel, factItem, rateLabel, createdItem, changedItem } from "./stat-panels.js";
import { currentYear, sinceLabel } from "./year-grid.js";
import { api } from "./api.js";
import { remote } from "./remote-stats.js";
import { el } from "./dom.js";

let root;
let actions;

export function initCategory(handlers) {
  actions = handlers;
  root = document.getElementById("category-view");
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const id = root.dataset.category;
    switch (target.dataset.action) {
      case "back": actions.closeCategory(); break;
      case "edit": openCategoryEditor(id, (input) => actions.updateCategory(id, input)); break;
      case "delete": actions.deleteCategory(id); break;
      case "open-habit": actions.openHabit(target.dataset.habit); break;
    }
  });
}

export function renderCategory(category) {
  if (!root || !category) return;
  root.dataset.category = category.id;

  const habits = habitsOf(category.id);
  root.replaceChildren(
    header(category),
    details(category),
    stats(category),
    habitList(habits),
    activity(category),
  );
}

/** Returns the category's habits in board order. */
function habitsOf(id) {
  return state.habits.filter((h) => h.categoryId === id && !h.archivedAt);
}

/**
 * The view's title bar: back, name, edit, and delete in the menu. The habit
 * count is a stat tile; other details are in the details panel.
 */
function header(category) {
  return appBar({
    title: category.name,
    badge: categoryIconBadge(category, "habit-icon"),
    menu: [{ action: "delete", label: t("Delete"), icon: "trash", danger: true }],
  });
}

/**
 * Builds the stat tiles from the server's day statistics of the category's
 * habits this year (GET /api/days?category=); dashes until they have arrived.
 */
function stats(category) {
  const year = currentYear();
  const s = remote(`category|${category.id}|${year}`, () => api.days(year, category.id), () => {
    if (!root.hidden && root.dataset.category === category.id) renderCategory(categoryById(category.id));
  });
  if (!s) {
    return statRow([
      [t("Current streak"), "–", "streak"],
      [t("Perfect days {since}", { since: sinceLabel(`${year}-01-01`) }), "–", "calendarCheck"],
      [rateLabel(), "–", "percent"],
      [t("Habits"), "–", "list"],
    ]);
  }
  const rate = s.expected > 0 ? Math.round((s.achieved / s.expected) * 100) : 0;
  const { currentStreak, perfect, counted } = s.stats;
  return statRow([
    [t("Current streak"), currentStreak === 1 ? t("1 day") : t("{n} days", { n: currentStreak }), "streak"],
    [t("Perfect days {since}", { since: sinceLabel(`${s.year}-01-01`) }),
      t("{n} of {total}", { n: perfect, total: counted }), "calendarCheck"],
    [rateLabel(), `${rate} %`, "percent"],
    [t("Habits"), String(s.habits), "list"],
  ]);
}

/** Shows whether the category's progress is shown on the board. */
function details(category) {
  return factsPanel(t("Details"), [factItem(t("Progress"),
    category.showProgress ? t("Shown on the board") : t("Not shown"))]);
}

/** Shows when the category was created and last changed, as for a habit. */
function activity(category) {
  return factsPanel(t("Activity"), [
    createdItem(category.createdAt),
    changedItem(category.updatedAt),
  ], "activity");
}

function habitList(habits) {
  return el("section", { class: "panel" },
    el("h3", {}, t("Habits")),
    habits.length === 0
      ? el("p", { class: "block-empty" }, t("No habit in this category yet."))
      : el("div", { class: "cat-habits" }, ...habits.map(habitItem)),
  );
}

/** Builds the entry of a habit in the list, a button that opens the habit. */
function habitItem(habit) {
  return el("button", {
    type: "button",
    class: "cat-habit",
    data: { action: "open-habit", habit: habit.id },
    style: { "--habit-color": colorValue(habit.color) },
  },
    // Without an icon, a dot in the habit's colour.
    habitIconBadge(habit) ?? el("span", { class: "dot" }),
    el("span", { class: "cat-habit-text" },
      el("span", { class: "habit-name" }, habit.name),
      el("span", { class: "habit-meta" }, H.describeHabit(habit)),
    ),
    el("span", { class: "cat-habit-streak" }, shortStreak(habit.stats)),
  );
}

/** Formats the current streak shortly: "1 day", "5 days", "3 wk", "2 mo". */
function shortStreak({ currentStreak, streakUnit }) {
  // Singular/plural for days; "wk" and "mo" need no plural.
  let unit = currentStreak === 1 ? t("day") : t("days");
  if (streakUnit === "weeks") unit = t("wk");
  if (streakUnit === "months") unit = t("mo");
  return `${currentStreak} ${unit}`;
}
