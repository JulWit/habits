// Category detail view: its habits and its perfect days, i.e. days on which
// every scheduled habit of the category was completed.

import { t } from "./i18n.js";
import { state, categoryById } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge, categoryIconBadge, colorValue } from "./icons.js";
import { appBar } from "./appbar.js";
import { openCategoryEditor } from "./categoryeditor.js";
import { statRow, factsPanel, factItem, rateLabel, createdItem, changedItem } from "./panels.js";
import { currentYear, sinceLabel } from "./year.js";
import { api } from "./api.js";
import { remote } from "./remote.js";

let root;
let actions;

export function initCategory(handlers) {
  actions = handlers;
  root = document.getElementById("view-category");
  root.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const id = root.dataset.category;
    switch (el.dataset.action) {
      case "back": actions.closeCategory(); break;
      case "edit": openCategoryEditor(id, (input) => actions.updateCategory(id, input)); break;
      case "delete": actions.deleteCategory(id); break;
      case "open-habit": actions.openHabit(el.dataset.habit); break;
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
 * Builds the stat tiles from the server's statistics of the category (GET
 * /api/categories/{id}/stats); dashes until they have arrived.
 */
function stats(category) {
  const s = remote(`category|${category.id}`, () => api.categoryStats(category.id), () => {
    if (!root.hidden && root.dataset.category === category.id) renderCategory(categoryById(category.id));
  });
  if (!s) {
    return statRow([
      [t("Current streak"), "–", "streak"],
      [t("Perfect days {since}", { since: sinceLabel(`${currentYear()}-01-01`) }), "–", "calendarCheck"],
      [rateLabel(), "–", "percent"],
      [t("Habits"), "–", "list"],
    ]);
  }
  const rate = s.expected > 0 ? Math.round((s.achieved / s.expected) * 100) : 0;
  return statRow([
    [t("Current streak"), s.currentStreak === 1 ? t("1 day") : t("{n} days", { n: s.currentStreak }), "streak"],
    [t("Perfect days {since}", { since: sinceLabel(s.from) }),
      t("{n} of {total}", { n: s.perfect, total: s.dueDays }), "calendarCheck"],
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
  const panel = document.createElement("section");
  panel.className = "panel";
  const title = document.createElement("h3");
  title.textContent = t("Habits");
  panel.append(title);

  if (habits.length === 0) {
    const empty = document.createElement("p");
    empty.className = "block-empty";
    empty.textContent = t("No habit in this category yet.");
    panel.append(empty);
    return panel;
  }

  const list = document.createElement("div");
  list.className = "cat-habits";
  for (const habit of habits) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cat-habit";
    row.dataset.action = "open-habit";
    row.dataset.habit = habit.id;
    row.style.setProperty("--habit-color", colorValue(habit.color));
    row.innerHTML = `
      <span class="dot"></span>
      <span class="cat-habit-text">
        <span class="habit-name"></span>
        <span class="habit-meta"></span>
      </span>
      <span class="cat-habit-streak"></span>`;
    const badge = habitIconBadge(habit);
    if (badge) row.querySelector(".dot").replaceWith(badge);
    row.querySelector(".habit-name").textContent = habit.name;
    row.querySelector(".habit-meta").textContent = H.describeHabit(habit);
    const s = habit.stats;
    // Singular/plural for days; "wk" and "mo" need no plural.
    let unit = s.currentStreak === 1 ? t("day") : t("days");
    if (s.streakUnit === "weeks") unit = t("wk");
    if (s.streakUnit === "months") unit = t("mo");
    row.querySelector(".cat-habit-streak").textContent = `${s.currentStreak} ${unit}`;
    list.append(row);
  }
  panel.append(list);
  return panel;
}
