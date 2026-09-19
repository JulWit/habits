// Inline SVG icons, kept as markup strings in one place.
//
// SVG rather than emoji or symbol glyphs: those render as a colour emoji on one
// platform and as a hairline on the next, so a row of buttons changed weight
// from machine to machine. These inherit currentColor and draw identically
// everywhere. All markup here is constant — it never contains user input, so
// assigning it with innerHTML carries nothing to escape.

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
