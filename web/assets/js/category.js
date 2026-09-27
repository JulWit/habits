// Category detail view: its habits and its perfect days, i.e. days on which
// every scheduled habit of the category was completed.

import { addDays, formatDayMonth, formatLong, localISO } from "./dates.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { habitIconBadge, categoryIconBadge, colorValue } from "./icons.js";
import { appBar } from "./appbar.js";
import { openCategoryEditor } from "./categoryeditor.js";
import { statRow, factsPanel, factItem } from "./panels.js";

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
 * Counts the perfect days between `from` and `to`, the days with scheduled
 * habits (`due`) and the current run of perfect days (`streak`). Days without
 * scheduled habits are skipped. Habits count from their creation day.
 */
function perfectDays(habits, from, to) {
  let perfect = 0;
  let due = 0;
  // The current run of perfect days; an open today does not end it.
  let run = 0;

  const bornOn = new Map(habits.map((h) => [h.id, (h.createdAt ?? "").slice(0, 10)]));
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const scheduled = habits.filter(
      (h) => bornOn.get(h.id) <= day && H.isScheduled(h, day),
    );
    if (scheduled.length === 0) continue;
    due++;
    if (scheduled.every((h) => H.isComplete(h, day, h.entries[day] ?? 0))) {
      perfect++;
      run++;
    } else if (day !== state.today) {
      run = 0;
    }
  }
  return { perfect, due, streak: run };
}

/** Returns January 1 of this year, or the start of the loaded entries if later. */
function rangeStart() {
  const yearStart = `${state.today.slice(0, 4)}-01-01`;
  const loaded = state.entriesFrom ?? yearStart;
  return loaded > yearStart ? loaded : yearStart;
}

function stats(habits) {
  const from = rangeStart();
  const { perfect, due, streak } = perfectDays(habits, from, state.today);

  // Summed from the habits' own stats.
  const expected = habits.reduce((sum, h) => sum + (h.stats?.expected ?? 0), 0);
  const achieved = habits.reduce((sum, h) => sum + (h.stats?.achieved ?? 0), 0);
  const rate = expected > 0 ? Math.round((achieved / expected) * 100) : 0;

  return statRow([
    [t("Current streak"), streak === 1 ? t("1 day") : t("{n} days", { n: streak })],
    [t("Perfect days {since}", { since: sinceLabel(from) }), t("{n} of {total}", { n: perfect, total: due })],
    [t("Rate (30 days)"), `${rate} %`],
    [t("Habits"), String(habits.length)],
  ]);
}

/**
 * Shows whether the category's progress is shown on the board and when it
 * was created.
 */
function details(category) {
  const items = [factItem(t("Progress"),
    category.showProgress ? t("Shown on the board") : t("Not shown"))];
  if (category.createdAt) items.push(factItem(t("Created"), formatLong(localISO(category.createdAt))));
  return factsPanel(t("Details"), items);
}

/** Returns "(2026)" for a full year, "(since 12 Mar)" otherwise. */
function sinceLabel(from) {
  const year = state.today.slice(0, 4);
  if (from === `${year}-01-01`) return `(${year})`;
  return t("(since {date})", { date: formatDayMonth(from) });
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
    // Singular/plural for days; "wk" needs no plural.
    const unit = s.streakUnit === "weeks"
      ? t("wk")
      : s.currentStreak === 1 ? t("day") : t("days");
    row.querySelector(".cat-habit-streak").textContent = `${s.currentStreak} ${unit}`;
    list.append(row);
  }
  panel.append(list);
  return panel;
}
