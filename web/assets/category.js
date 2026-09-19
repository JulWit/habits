// The single-category screen: what a category is made of, and how often all of
// it gets done on the same day.
//
// The habit screen answers "how is this one habit going"; this one answers the
// question a category actually poses — whether the group holds together. Its
// central number is the perfect day: a day on which every habit of the category
// that was due got done.

import { addDays, MONTH_SHORT, dayOfMonth } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { icons } from "./icons.js";
import { inlineInput } from "./inline.js";

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
      case "rename": startRename(id); break;
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
    header(category, habits),
    stats(habits),
    habitList(habits),
  );
}

/** The category's habits, in board order. */
function habitsOf(id) {
  return state.habits.filter((h) => h.categoryId === id && !h.archivedAt);
}

function header(category, habits) {
  const head = document.createElement("div");
  head.className = "detail-head";
  head.innerHTML = `
    <button class="icon-button is-back" type="button" data-action="back" aria-label="Zurück">${icons.arrowLeft}</button>
    <div class="detail-title">
      <h2><span class="name"></span></h2>
      <span class="sub"></span>
    </div>
    <div class="topbar-actions">
      <button type="button" class="button" data-action="rename" aria-label="Umbenennen">
        ${icons.edit}<span class="label">Bearbeiten</span>
      </button>
      <button type="button" class="button danger" data-action="delete" aria-label="Löschen">
        ${icons.trash}<span class="label">Löschen</span>
      </button>
    </div>`;
  head.querySelector(".name").textContent = category.name;
  head.querySelector(".sub").textContent = habits.length === 1
    ? "1 Gewohnheit"
    : `${habits.length} Gewohnheiten`;
  return head;
}

function startRename(id) {
  const category = state.categories.find((c) => c.id === id);
  const title = root.querySelector(".detail-title .name");
  if (!category || !title) return;
  inlineInput(title, {
    value: category.name,
    onCommit: (name) => actions.renameCategory(category.id, name),
  });
}

/**
 * A day counts once every habit that was due on it is complete.
 *
 * Days on which nothing was scheduled are skipped rather than counted as
 * missed: a category of weekday habits would otherwise lose its run every
 * Saturday. Today is skipped the same way while it is still open — it has not
 * failed yet. And a habit only counts from the day it was created: the months
 * before it existed are not days it missed.
 */
function perfectDays(habits, from, to) {
  let perfect = 0;
  let due = 0;
  let streak = 0;
  let best = 0;
  let run = 0;

  const bornOn = new Map(habits.map((h) => [h.id, (h.createdAt ?? "").slice(0, 10)]));
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const scheduled = habits.filter(
      (h) => bornOn.get(h.id) <= day && H.isScheduled(h, day),
    );
    if (scheduled.length === 0) continue;
    due++;
    if (scheduled.every((h) => H.isComplete(h, h.entries[day] ?? 0))) {
      perfect++;
      run++;
      if (run > best) best = run;
    } else if (day !== state.today) {
      run = 0;
    }
  }
  streak = run;
  return { perfect, due, streak, best };
}

/** The first day the client can speak for: the year, unless history is shorter. */
function rangeStart() {
  const yearStart = `${state.today.slice(0, 4)}-01-01`;
  const loaded = state.entriesFrom ?? yearStart;
  return loaded > yearStart ? loaded : yearStart;
}

function stats(habits) {
  const from = rangeStart();
  const { perfect, due, streak } = perfectDays(habits, from, state.today);

  // Aggregated from the same numbers the habit screen shows, so a category's
  // rate and its habits' rates can never tell different stories.
  const expected = habits.reduce((sum, h) => sum + (h.stats?.expected ?? 0), 0);
  const achieved = habits.reduce((sum, h) => sum + (h.stats?.achieved ?? 0), 0);
  const rate = expected > 0 ? Math.round((achieved / expected) * 100) : 0;

  const row = document.createElement("div");
  row.className = "stat-row";
  for (const [label, value] of [
    ["Aktuelle Serie", `${streak} ${streak === 1 ? "Tag" : "Tage"}`],
    [`Perfekte Tage ${sinceLabel(from)}`, `${perfect} von ${due}`],
    ["Quote (30 Tage)", `${rate} %`],
    ["Gewohnheiten", String(habits.length)],
  ]) {
    const tile = document.createElement("div");
    tile.className = "stat";
    tile.innerHTML = `<div class="value"></div><div class="label"></div>`;
    tile.querySelector(".value").textContent = value;
    tile.querySelector(".label").textContent = label;
    row.append(tile);
  }
  return row;
}

/** "(2026)" for a full year, "(seit 12. Mär)" when history starts later. */
function sinceLabel(from) {
  const year = state.today.slice(0, 4);
  if (from === `${year}-01-01`) return `(${year})`;
  return `(seit ${dayOfMonth(from)}. ${MONTH_SHORT[Number(from.slice(5, 7)) - 1]})`;
}

function habitList(habits) {
  const panel = document.createElement("section");
  panel.className = "panel";
  const title = document.createElement("h3");
  title.textContent = "Gewohnheiten";
  panel.append(title);

  if (habits.length === 0) {
    const empty = document.createElement("p");
    empty.className = "block-empty";
    empty.textContent = "Noch keine Gewohnheit in dieser Kategorie.";
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
    row.style.setProperty("--habit-color", habit.color);
    row.innerHTML = `
      <span class="dot"></span>
      <span class="cat-habit-text">
        <span class="habit-name"></span>
        <span class="habit-meta"></span>
      </span>
      <span class="cat-habit-streak"></span>`;
    row.querySelector(".habit-name").textContent = habit.name;
    row.querySelector(".habit-meta").textContent = H.describeHabit(habit);
    const s = habit.stats;
    row.querySelector(".cat-habit-streak").textContent =
      `${s.currentStreak} ${s.streakUnit === "weeks" ? "Wo." : "Tage"}`;
    list.append(row);
  }
  panel.append(list);
  return panel;
}
