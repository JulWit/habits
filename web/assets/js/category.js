// Category detail view: its habits and its perfect days, i.e. days on which
// every scheduled habit of the category was completed.

import { t } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge, categoryIconBadge, colorValue } from "./icons.js";
import { appBar } from "./appbar.js";
import { openCategoryEditor } from "./categoryeditor.js";
import { statRow, factsPanel, factItem, rateLabel, createdItem, changedItem } from "./panels.js";
import { rangeStart, sinceLabel, dayRecords, isPerfect, perfectStreaks } from "./year.js";

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
    stats(habits),
    details(category),
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

function stats(habits) {
  const from = rangeStart();
  const days = dayRecords(habits, from, state.today);
  const due = days.filter((d) => d.due > 0).length;
  const perfect = days.filter(isPerfect).length;
  const streak = perfectStreaks(days).current;

  // Summed from the habits' own stats.
  const expected = habits.reduce((sum, h) => sum + (h.stats?.expected ?? 0), 0);
  const achieved = habits.reduce((sum, h) => sum + (h.stats?.achieved ?? 0), 0);
  const rate = expected > 0 ? Math.round((achieved / expected) * 100) : 0;

  return statRow([
    [t("Current streak"), streak === 1 ? t("1 day") : t("{n} days", { n: streak })],
    [t("Perfect days {since}", { since: sinceLabel(from) }), t("{n} of {total}", { n: perfect, total: due })],
    [rateLabel(), `${rate} %`],
    [t("Habits"), String(habits.length)],
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
