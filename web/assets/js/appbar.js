// Title bar of the habit and category views, as Material's top app bar: back,
// title, edit, and an overflow menu (⋮) for rare and destructive actions. The
// app's own title bar is hidden on these views (see base.css).
//
// The buttons carry data-action ("back", "edit" and the menu's actions); the
// view handles their clicks.

import { icons } from "./icons.js";
import { t } from "./i18n.js";

/**
 * Builds the title bar.
 * @param {object} bar
 * @param {string} bar.title  the name of the habit or category
 * @param {string|string[]} [bar.sub]  details shown after the title, e.g.
 *   frequency and target, each set off by a dot
 * @param {Node|null} [bar.badge]  shown before the title
 * @param {Array} bar.menu  the overflow menu's items, see overflowMenu
 */
export function appBar({ title, sub = "", badge = null, menu }) {
  const bar = document.createElement("header");
  bar.className = "app-bar";
  bar.innerHTML = `
    <button class="icon-button" type="button" data-action="back"></button>
    <div class="app-bar-title">
      <h2><span class="name"></span></h2>
      <span class="sub"></span>
    </div>
    <div class="app-bar-actions">
      <button class="icon-button" type="button" data-action="edit"></button>
    </div>`;
  labelled(bar.querySelector('[data-action="back"]'), icons.arrowLeft, t("Back"));
  labelled(bar.querySelector('[data-action="edit"]'), icons.edit, t("Edit"));
  bar.querySelector(".name").textContent = title;
  if (badge) bar.querySelector("h2").prepend(badge);
  // One element per detail, so the dots between them are drawn by the
  // stylesheet with even spacing.
  const subLine = bar.querySelector(".sub");
  const parts = [sub].flat().filter(Boolean);
  if (parts.length > 0) {
    subLine.append(...parts.map((text) => {
      const part = document.createElement("span");
      part.className = "sub-part";
      part.textContent = text;
      return part;
    }));
  } else {
    subLine.remove();
  }
  bar.querySelector(".app-bar-actions").append(...overflowMenu(menu));
  return bar;
}

/** Gives an icon button its icon and label. */
function labelled(button, icon, label) {
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
}

let count = 0;

/**
 * Returns the ⋮ button and its menu, to be inserted side by side. Items are
 * { action, label, icon, danger }. A chosen item closes the menu; its click
 * then bubbles with its data-action like any other button of the view.
 *
 * The menu is a popover: it closes on a click outside, on Escape and on the
 * system back gesture, and returns the focus to its button.
 */
function overflowMenu(items) {
  const id = `overflow-menu-${++count}`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.innerHTML = icons.moreVertical;
  button.title = t("More options");
  button.setAttribute("aria-label", t("More options"));
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("popovertarget", id);

  const menu = document.createElement("div");
  menu.id = id;
  menu.className = "overflow-menu";
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = item.danger ? "overflow-item is-danger" : "overflow-item";
    entry.dataset.action = item.action;
    entry.setAttribute("role", "menuitem");
    entry.innerHTML = icons[item.icon] ?? "";
    const label = document.createElement("span");
    label.textContent = item.label;
    entry.append(label);
    menu.append(entry);
  }

  menu.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    place(menu, button);
    menu.querySelector('[role="menuitem"]')?.focus();
  });
  // Escape returns the focus to the button. The browser does so only if the
  // button had it before, which a tap does not guarantee.
  menu.addEventListener("beforetoggle", (event) => {
    if (event.newState === "closed" && menu.contains(document.activeElement)) {
      button.focus({ preventScroll: true });
    }
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest('[role="menuitem"]')) menu.hidePopover();
  });
  menu.addEventListener("keydown", onKey);

  return [button, menu];
}

/** Aligns the menu's right edge with the button, just below it. */
function place(menu, button) {
  const box = button.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  menu.style.right = `${Math.round(document.documentElement.clientWidth - box.right)}px`;
}

/** Arrow keys move between the items; Escape stays with the menu. */
function onKey(event) {
  const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement);
  let next = -1;
  switch (event.key) {
    case "ArrowDown": next = (at + 1) % items.length; break;
    case "ArrowUp": next = (at - 1 + items.length) % items.length; break;
    case "Home": next = 0; break;
    case "End": next = items.length - 1; break;
    // The popover closes itself; the view must not also go back.
    case "Escape": event.stopPropagation(); return;
    default: return;
  }
  event.preventDefault();
  items[next].focus();
}

// A menu placed for the old layout would float in the wrong place.
window.addEventListener("resize", () => {
  for (const menu of document.querySelectorAll(".overflow-menu:popover-open")) menu.hidePopover();
});
