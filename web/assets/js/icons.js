// Inline SVG icons, kept as markup strings in one place.
//
// SVG rather than emoji or symbol glyphs: those render as a colour emoji on one
// platform and as a hairline on the next, so a row of buttons changed weight
// from machine to machine. These inherit currentColor and draw identically
// everywhere. All markup here is constant — it never contains user input, so
// assigning it with innerHTML carries nothing to escape.

import { t } from "./i18n.js";

const draw = (body) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"' +
  ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";

export const icons = {
  sun: draw(
    '<circle cx="12" cy="12" r="4.1"/>' +
    '<path d="M12 2.6v2.3M12 19.1v2.3M21.4 12h-2.3M4.9 12H2.6' +
    "M18.65 5.35l-1.63 1.63M6.98 17.02l-1.63 1.63" +
    'M18.65 18.65l-1.63-1.63M6.98 6.98L5.35 5.35"/>',
  ),

  moon: draw('<path d="M20.6 14.6A9 9 0 0 1 9.4 3.4a9 9 0 1 0 11.2 11.2Z"/>'),

  // A screen on a stand: the appearance the device asks for.
  display: draw('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>'),

  // Settings sections. A painter's palette for how things look, and the board
  // itself - a label column beside rows of days - for how it is laid out.
  palette: draw(
    '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2' +
    "-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a4.1 4.1 0 0 0 4.1-4.1" +
    'C20.8 6.6 16.9 3.2 12 3.2Z"/>' +
    '<path d="M7.6 12.2h.01M9 8h.01M13.6 7h.01M17 9.8h.01"/>',
  ),
  board: draw(
    '<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.2"/>' +
    '<path d="M3.2 9.4h17.6M3.2 14.6h17.6M9.4 9.4v10.4"/>',
  ),
  // A globe for region and language: where "today" is, and in which words.
  globe: draw(
    '<circle cx="12" cy="12" r="8.8"/>' +
    '<path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8' +
    'M12 3.2C9.6 5.6 8.4 8.5 8.4 12s1.2 6.4 3.6 8.8"/>',
  ),

  // Habit kinds. Each has to read at 15px, which rules out anything with fine
  // detail — a running figure, for instance, becomes a smudge at that size, so
  // distance uses the navigation arrow instead.
  clock: draw('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.1V12l3.3 2"/>'),

  calculator: draw(
    '<rect x="4.6" y="2.9" width="14.8" height="18.2" rx="2.2"/>' +
    '<path d="M8.2 7h7.6"/>' +
    '<path d="M8.6 12.2h.01M12 12.2h.01M15.4 12.2h.01' +
    'M8.6 16.4h.01M12 16.4h.01M15.4 16.4h.01"/>',
  ),

  navigation: draw('<path d="M3.2 10.9 21 2.6l-8.3 17.8-1.9-7.6z"/>'),

  edit: draw('<path d="M16.5 3.5a2.6 2.6 0 0 1 3.7 3.7L8 19.4 3.5 20.5 4.6 16z"/>'),

  // A lidded box. The arrow inside says which way the habit is moving, so
  // archiving and restoring are not the same picture with a different caption.
  archive: draw(
    '<rect x="2.5" y="3.5" width="19" height="4.5" rx="1"/>' +
    '<path d="M4.5 8v11.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8"/>' +
    '<path d="M12 11.5v5M9.5 14l2.5 2.5L14.5 14"/>',
  ),

  unarchive: draw(
    '<rect x="2.5" y="3.5" width="19" height="4.5" rx="1"/>' +
    '<path d="M4.5 8v11.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8"/>' +
    '<path d="M12 16.5v-5M9.5 14l2.5-2.5L14.5 14"/>',
  ),

  check: draw('<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>'),

  // The current streak, beside a habit's name. Filled rather than outlined,
  // unlike the flame a habit can wear as its icon: at the size of the meta line
  // an outline thins to a hairline, and the two must not read as the same
  // thing. The inner tongue is cut out (evenodd), so the flame keeps a shape
  // of its own instead of becoming a blot.
  streak: draw(
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="' +
    "M12 22C7.6 22 4.8 19 4.8 15.2 4.8 12 6.6 9.9 8.4 8.2 8.6 10 9.4 11.2 10.6 11.8" +
    " 10.4 8 11.8 4.6 14.6 2.4 15 5.4 16.4 7.4 17.7 9.1 18.8 10.6 19.4 12.4 19.4 14.6" +
    " 19.4 18.9 16.3 22 12 22Z" +
    "M12 19.8C10.5 19.8 9.4 18.7 9.4 17.3 9.4 15.8 10.4 14.8 11.5 13.8 11.7 14.8 12.3 15.4 13 15.7" +
    ' 13.4 14.9 13.9 14.2 14.4 13.7 15.1 14.7 15.6 15.8 15.6 17 15.6 18.7 14 19.8 12 19.8Z"/>',
  ),

  // Eight teeth on a body of radius 7.35, tips at 9.75, every point generated
  // from the same centre as the hub. The previous outline was a hand-edited
  // one whose bounding box sat at 12.57/11.03, which read as a hub off-centre
  // inside its gear.
  gear: draw(
    '<circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M9.85 4.97L10.47 2.37L13.53 2.37L14.15 4.97A7.35 7.35 0 0 1 15.45 5.51L17.73 4.11L19.89 6.27L18.49 8.55A7.35 7.35 0 0 1 19.03 9.85L21.63 10.47L21.63 13.53L19.03 14.15A7.35 7.35 0 0 1 18.49 15.45L19.89 17.73L17.73 19.89L15.45 18.49A7.35 7.35 0 0 1 14.15 19.03L13.53 21.63L10.47 21.63L9.85 19.03A7.35 7.35 0 0 1 8.55 18.49L6.27 19.89L4.11 17.73L5.51 15.45A7.35 7.35 0 0 1 4.97 14.15L2.37 13.53L2.37 10.47L4.97 9.85A7.35 7.35 0 0 1 5.51 8.55L4.11 6.27L6.27 4.11L8.55 5.51A7.35 7.35 0 0 1 9.85 4.97Z"/>',
  ),

  arrowLeft: draw('<path d="M20 12H4.4M11 5 4 12l7 7"/>'),

  chevron: draw('<path d="M6 9.5 12 15.5l6-6"/>'),

  // Two columns of dots, the shape a draggable handle has everywhere. Filled
  // circles rather than strokes, so it reads as texture and not as a control.
  grip: draw(
    '<g fill="currentColor" stroke="none">' +
    '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/>' +
    '<circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/>' +
    '<circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>' +
    "</g>",
  ),

  chevronUp: draw('<path d="M5.5 14.5 12 8l6.5 6.5"/>'),

  chevronDown: draw('<path d="M5.5 9.5 12 16l6.5-6.5"/>'),

  chevronLeft: draw('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),

  chevronRight: draw('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),

  // Back to today. Not an arrow: the board pages in both directions now, so a
  // chevron pointing one way would be wrong half the time. A calendar sheet
  // with the day marked says where the button goes without saying which way.
  toToday: draw(
    '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.2"/>' +
    '<path d="M8 2.9v4.2M16 2.9v4.2M3.4 10.2h17.2"/>' +
    '<circle cx="12" cy="15.6" r="1.9" fill="currentColor" stroke="none"/>',
  ),

  search: draw('<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.4 15.4 20.5 20.5"/>'),

  // A plus sign for the one control that adds something. Drawn on the same
  // grid as the icons beside it, so the three read as one row.
  plus: draw('<path d="M12 5.2v13.6M5.2 12h13.6"/>'),

  // A funnel: what a filter looks like everywhere.
  filter: draw('<path d="M3.6 5.2h16.8l-6.6 7.7v5.4l-3.6 2.1v-7.5z"/>'),

  trash: draw(
    '<path d="M3.5 6h17"/>' +
    '<path d="M18.5 6v13.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6"/>' +
    '<path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"/>' +
    '<path d="M10 10.5v6M14 10.5v6"/>',
  ),
};

/**
 * The icons a habit can wear, by the names the server validates against
 * (domain.HabitIcons). The server owns the list and its order; this owns only
 * the drawings. A name without a drawing here is left out of the picker and
 * drawn as nothing, rather than as a broken box.
 *
 * Drawn on the same 24px grid and stroke as the interface icons, and kept
 * simple for the same reason: they are read at about 16px beside a name.
 */
export const habitIcons = {
  droplet: draw('<path d="M12 21.5a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5-2 1.6-3 3.5-3 5.5a7 7 0 0 0 7 7z"/>'),
  apple: draw(
    '<path d="M12 20.9c1.5 0 2.8 1.1 4 1.1 3 0 6-8 6-12.2A4.9 4.9 0 0 0 17 5c-2.2 0-4 1.4-5 2-1-.6-2.8-2-5-2a4.9 4.9 0 0 0-5 4.8C2 14 5 22 8 22c1.2 0 2.5-1.1 4-1.1z"/>' +
    '<path d="M10 2c1 .5 2 2 2 5"/>',
  ),
  utensils: draw('<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>'),
  coffee: draw(
    '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/>' +
    '<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/>' +
    '<path d="M6 2v2M10 2v2M14 2v2"/>',
  ),
  pill: draw('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z"/><path d="m8.5 8.5 7 7"/>'),
  heart: draw('<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>'),
  dumbbell: draw('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  bike: draw(
    '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>' +
    '<circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  ),
  mountain: draw('<path d="m8 3 4 8 5-5 5 15H2z"/>'),
  flame: draw('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  bed: draw('<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>'),
  moon: icons.moon,
  sun: icons.sun,
  book: draw('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  pencil: icons.edit,
  lightbulb: draw(
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>' +
    '<path d="M9 18h6M10 22h4"/>',
  ),
  code: draw('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  globe: draw(
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  ),
  music: draw('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  palette: icons.palette,
  camera: draw(
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/>' +
    '<circle cx="12" cy="13" r="3"/>',
  ),
  leaf: draw(
    '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/>' +
    '<path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12"/>',
  ),
  home: draw('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
  wallet: draw(
    '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>' +
    '<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  ),
  users: draw(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
    '<path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  ),
  smartphone: draw('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'),
  ban: draw('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  smile: draw('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  star: draw('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/>'),
  target: draw('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  clock: icons.clock,
  check: icons.check,
};

/**
 * The rounded tile an icon sits on, or null for a name without a drawing.
 *
 * The colour comes from --habit-color on the tile itself, so it can be placed
 * anywhere without depending on what its parent happens to set. Without a
 * colour the tile is neutral: see .habit-icon.is-neutral.
 */
function iconBadge(name, color, className) {
  const svg = habitIcons[name];
  if (!svg) return null;
  const el = document.createElement("span");
  el.className = className;
  if (color) el.style.setProperty("--habit-color", color);
  else el.classList.add("is-neutral");
  el.innerHTML = svg;
  return el;
}

/** A habit's icon, in the habit's colour. */
export function habitIconBadge(habit, className = "habit-icon") {
  return iconBadge(habit.icon, habit.color, className);
}

/** A category's icon, in its colour, or in neutral ink when it has none. */
export function categoryIconBadge(category, className = "habit-icon") {
  return iconBadge(category.icon, category.color || null, className);
}

/**
 * Fills host with one radio button per icon, after a first one for "no icon",
 * and calls onPick with the chosen name ("" for none).
 *
 * The names are the server's (state.icons); one without a drawing here is
 * skipped rather than offered as an empty tile.
 */
export function buildIconChoices(host, names, onPick) {
  const offered = ["", ...(names ?? []).filter((name) => habitIcons[name])];
  host.replaceChildren(
    ...offered.map((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = name ? "icon-choice" : "icon-choice is-none";
      b.dataset.icon = name;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", name ? t("Icon {name}", { name }) : t("No icon"));
      b.title = name || t("No icon");
      // "No icon" is an empty, dashed tile: the absence it stands for.
      if (name) b.innerHTML = habitIcons[name];
      b.addEventListener("click", () => onPick(name));
      return b;
    }),
  );
}

/** Marks the choice for `name` as the selected one. */
export function markIconChoice(host, name) {
  for (const el of host.querySelectorAll(".icon-choice")) {
    el.setAttribute("aria-checked", String(el.dataset.icon === name));
  }
}

/**
 * Fills every element carrying data-icon="<name>" with that icon, once.
 *
 * The markup stays declarative — the HTML names the icon it wants — while the
 * drawings live only here. Guarded against running twice, because a second pass
 * would stack a duplicate SVG in front of the label.
 */
export function paintIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    const svg = icons[el.dataset.icon];
    if (!svg || el.querySelector("svg")) continue;
    el.insertAdjacentHTML("afterbegin", svg);
  }
}
