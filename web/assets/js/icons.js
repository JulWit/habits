// Inline SVG icons. They use currentColor. The markup is constant, so it is
// safe to assign with innerHTML.

import {el, markup} from './dom.js';
import {t} from './i18n.js';
import {h} from './vue.js';

/**
 * Wraps the shapes of an icon in its SVG element.
 * @param {string} body
 * @return {string}
 */
const draw = (body) =>
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
    'stroke="currentColor"' +
    ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    body + '</svg>';

/**
 * The interface icons as SVG markup, keyed by name.
 * @const {!Object<string, string>}
 */
export const icons = {
  sun: draw(
      '<circle cx="12" cy="12" r="4.1"/>' +
          '<path d="M12 2.6v2.3M12 19.1v2.3M21.4 12h-2.3M4.9 12H2.6' +
          'M18.65 5.35l-1.63 1.63M6.98 17.02l-1.63 1.63' +
          'M18.65 18.65l-1.63-1.63M6.98 6.98L5.35 5.35"/>',
      ),

  moon: draw('<path d="M20.6 14.6A9 9 0 0 1 9.4 3.4a9 9 0 1 0 11.2 11.2Z"/>'),

  // Screen on a stand: system theme.
  display: draw(
      '<rect x="3" y="4" width="18" height="12" rx="2"/>' +
      '<path d="M9 20h6M12 16v4"/>'),

  // Settings sections.
  palette: draw(
      '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6' +
          'c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2' +
          '-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a4.1 4.1 0 0 0 4.1-4.1' +
          'C20.8 6.6 16.9 3.2 12 3.2Z"/>' +
          '<path d="M7.6 12.2h.01M9 8h.01M13.6 7h.01M17 9.8h.01"/>',
      ),
  board: draw(
      '<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.2"/>' +
          '<path d="M3.2 9.4h17.6M3.2 14.6h17.6M9.4 9.4v10.4"/>',
      ),
  // Globe: region and language.
  globe: draw(
      '<circle cx="12" cy="12" r="8.8"/>' +
          '<path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8' +
          's-1.2 6.4-3.6 8.8' +
          'M12 3.2C9.6 5.6 8.4 8.5 8.4 12s1.2 6.4 3.6 8.8"/>',
      ),

  // Habit kinds. Must be legible at 15px.
  clock: draw('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.1V12l3.3 2"/>'),

  calculator: draw(
      '<rect x="4.6" y="2.9" width="14.8" height="18.2" rx="2.2"/>' +
          '<path d="M8.2 7h7.6"/>' +
          '<path d="M8.6 12.2h.01M12 12.2h.01M15.4 12.2h.01' +
          'M8.6 16.4h.01M12 16.4h.01M15.4 16.4h.01"/>',
      ),

  navigation: draw('<path d="M3.2 10.9 21 2.6l-8.3 17.8-1.9-7.6z"/>'),

  edit: draw(
      '<path d="M16.5 3.5a2.6 2.6 0 0 1 3.7 3.7L8 19.4 3.5 20.5 4.6 16z"/>'),

  // Box with an arrow indicating archive or restore.
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

  // A skipped day: a step over the day, like skipping a track.
  skip: draw('<path d="M5 6.5 12 12l-7 5.5zM13 6.5 20 12l-7 5.5z"/>'),

  // Current streak. Filled, to be distinguishable from the flame habit icon.
  streak: draw(
      '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="' +
          'M12 22C7.6 22 4.8 19 4.8 15.2 4.8 12 6.6 9.9 8.4 8.2 8.6 10' +
          ' 9.4 11.2 10.6 11.8' +
          ' 10.4 8 11.8 4.6 14.6 2.4 15 5.4 16.4 7.4 17.7 9.1 18.8 10.6' +
          ' 19.4 12.4 19.4 14.6' +
          ' 19.4 18.9 16.3 22 12 22Z' +
          'M12 19.8C10.5 19.8 9.4 18.7 9.4 17.3 9.4 15.8 10.4 14.8 11.5' +
          ' 13.8 11.7 14.8 12.3 15.4 13 15.7' +
          ' 13.4 14.9 13.9 14.2 14.4 13.7 15.1 14.7 15.6 15.8 15.6 17' +
          ' 15.6 18.7 14 19.8 12 19.8Z"/>',
      ),

  // Statistics tiles (stat-panels.js): best streak, rate, total, perfect days
  // and the habits of a category.
  trophy: draw(
      '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/>' +
          '<path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14' +
          'v4M8 21h8M9.5 18h5v3h-5z"/>',
      ),
  percent: draw(
      '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/>' +
      '<circle cx="17.5" cy="17.5" r="2.5"/>'),
  // Rising bars: the total that has added up.
  total: draw('<path d="M4 20h16M7 16v-3M12 16V9M17 16V5"/>'),
  calendarCheck: draw(
      '<rect x="3" y="4" width="18" height="18" rx="2"/>' +
          '<path d="M8 2v4M16 2v4M3 10h18M9 16l2 2 4-4"/>',
      ),
  list: draw('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),

  // Gear with eight teeth, centred on the hub.
  gear: draw(
      '<circle cx="12" cy="12" r="3.2"/>' +
          '<path d="M9.85 4.97L10.47 2.37L13.53 2.37L14.15 4.97' +
          'A7.35 7.35 0 0 1 15.45 5.51L17.73 4.11L19.89 6.27L18.49 8.55' +
          'A7.35 7.35 0 0 1 19.03 9.85L21.63 10.47L21.63 13.53' +
          'L19.03 14.15A7.35 7.35 0 0 1 18.49 15.45L19.89 17.73' +
          'L17.73 19.89L15.45 18.49A7.35 7.35 0 0 1 14.15 19.03' +
          'L13.53 21.63L10.47 21.63L9.85 19.03' +
          'A7.35 7.35 0 0 1 8.55 18.49L6.27 19.89L4.11 17.73L5.51 15.45' +
          'A7.35 7.35 0 0 1 4.97 14.15L2.37 13.53L2.37 10.47L4.97 9.85' +
          'A7.35 7.35 0 0 1 5.51 8.55L4.11 6.27L6.27 4.11L8.55 5.51' +
          'A7.35 7.35 0 0 1 9.85 4.97Z"/>',
      ),

  // The version page in the settings.
  info:
      draw('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>'),

  arrowLeft: draw('<path d="M20 12H4.4M11 5 4 12l7 7"/>'),

  // Closes a full-screen dialog without saving.
  close: draw('<path d="M6 6l12 12M18 6 6 18"/>'),

  // Three dots: the overflow menu of a title bar.
  moreVertical: draw(
      '<circle cx="12" cy="5.5" r=".9" fill="currentColor"/>' +
          '<circle cx="12" cy="12" r=".9" fill="currentColor"/>' +
          '<circle cx="12" cy="18.5" r=".9" fill="currentColor"/>',
      ),

  chevron: draw('<path d="M6 9.5 12 15.5l6-6"/>'),

  // Drag handle: two columns of dots.
  grip: draw(
      '<g fill="currentColor" stroke="none">' +
          '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/>' +
          '<circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/>' +
          '<circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>' +
          '</g>',
      ),

  chevronUp: draw('<path d="M5.5 14.5 12 8l6.5 6.5"/>'),

  chevronDown: draw('<path d="M5.5 9.5 12 16l6.5-6.5"/>'),

  chevronLeft: draw('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),

  chevronRight: draw('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),

  // Calendar sheet: back to today.
  toToday: draw(
      '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.2"/>' +
          '<path d="M8 2.9v4.2M16 2.9v4.2M3.4 10.2h17.2"/>' +
          '<circle cx="12" cy="15.6" r="1.9" fill="currentColor" ' +
          'stroke="none"/>',
      ),

  search: draw(
      '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.4 15.4 20.5 20.5"/>'),

  // Plus sign.
  plus: draw('<path d="M12 5.2v13.6M5.2 12h13.6"/>'),

  // Funnel: filter.
  filter: draw('<path d="M3.6 5.2h16.8l-6.6 7.7v5.4l-3.6 2.1v-7.5z"/>'),

  // Import and export: arrows in both directions.
  transfer: draw(
      '<path d="M7.5 20V4.5M3.5 8.5l4-4 4 4M16.5 4v15.5M12.5 15.5l4 4 4-4"/>'),
  // Arrow into a tray: export to a file.
  download: draw(
      '<path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5M4 15.5v3' +
      'a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  // Arrow out of a tray: import from a file.
  upload: draw(
      '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M4 15.5v3a2 2 0 0 0 2 2h12' +
      'a2 2 0 0 0 2-2v-3"/>'),

  trash: draw(
      '<path d="M3.5 6h17"/>' +
          '<path d="M18.5 6v13.5a1.5 1.5 0 0 1-1.5 1.5H7' +
          'a1.5 1.5 0 0 1-1.5-1.5V6"/>' +
          '<path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"/>' +
          '<path d="M10 10.5v6M14 10.5v6"/>',
      ),
};

/**
 * Drawings of the habit icons, keyed by the names in domain.HabitIcons. Names
 * without a drawing are not offered.
 */
export const habitIcons = {
  droplet: draw(
      '<path d="M12 21.5a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5' +
      'c-.5 2.5-2 4.9-4 6.5-2 1.6-3 3.5-3 5.5a7 7 0 0 0 7 7z"/>'),
  apple: draw(
      '<path d="M12 20.9c1.5 0 2.8 1.1 4 1.1 3 0 6-8 6-12.2' +
          'A4.9 4.9 0 0 0 17 5c-2.2 0-4 1.4-5 2-1-.6-2.8-2-5-2' +
          'a4.9 4.9 0 0 0-5 4.8C2 14 5 22 8 22c1.2 0 2.5-1.1 4-1.1z"/>' +
          '<path d="M10 2c1 .5 2 2 2 5"/>',
      ),
  utensils: draw(
      '<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2' +
      'a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>'),
  coffee: draw(
      '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/>' +
          '<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/>' +
          '<path d="M6 2v2M10 2v2M14 2v2"/>',
      ),
  pill: draw(
      '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10' +
      'a4.95 4.95 0 1 0 7 7z"/><path d="m8.5 8.5 7 7"/>'),
  heart: draw(
      '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3' +
      'c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5' +
      'c0 2.3 1.5 4 3 5.5l7 7z"/>'),
  dumbbell:
      draw('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  bike: draw(
      '<circle cx="5.5" cy="17.5" r="3.5"/>' +
          '<circle cx="18.5" cy="17.5" r="3.5"/>' +
          '<circle cx="15" cy="5" r="1"/>' +
          '<path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
      ),
  mountain: draw('<path d="m8 3 4 8 5-5 5 15H2z"/>'),
  flame: draw(
      '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12' +
      'c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3' +
      ' 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  bed: draw('<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>'),
  alarm: draw(
      '<circle cx="12" cy="13" r="8"/>' +
          '<path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3M6.4 18.7 4 21' +
          'M17.6 18.7 20 21"/>',
      ),
  // Times of day: the sun rising, high above the horizon, and setting.
  morning: draw(
      '<path d="M12 2v8M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0M4.9 10.9l1.4 1.4' +
          'M19.1 10.9l-1.4 1.4' +
          'M2 18h2M20 18h2M22 22H2"/>',
      ),
  midday: draw(
      '<circle cx="12" cy="10" r="3.5"/>' +
          '<path d="M12 2.5V4M12 16v1.5M4 10h1.5M18.5 10H20M6.7 4.7l1 1' +
          'M17.3 4.7l-1 1' +
          'M6.7 15.3l1-1M17.3 15.3l-1-1M2 21.5h20"/>',
      ),
  evening: draw(
      '<path d="M12 10V2M16 6l-4 4-4-4M16 18a4 4 0 0 0-8 0M4.9 10.9' +
          'l1.4 1.4M19.1 10.9l-1.4 1.4' +
          'M2 18h2M20 18h2M22 22H2"/>',
      ),
  moon: icons.moon,
  sun: icons.sun,
  book: draw(
      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6' +
      'a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  pencil: icons.edit,
  lightbulb: draw(
      '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5' +
          'A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>' +
          '<path d="M9 18h6M10 22h4"/>',
      ),
  code: draw('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  globe: draw(
      '<circle cx="12" cy="12" r="10"/>' +
          '<path d="M2 12h20M12 2' +
          'a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0' +
          ' 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
      ),
  music: draw(
      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>' +
      '<circle cx="18" cy="16" r="3"/>'),
  palette: icons.palette,
  camera: draw(
      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16' +
          'a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/>' +
          '<circle cx="12" cy="13" r="3"/>',
      ),
  leaf: draw(
      '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2' +
          'c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/>' +
          '<path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12"/>',
      ),
  home: draw(
      '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
      '<path d="M9 22V12h6v10"/>'),
  wallet: draw(
      '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4' +
          'h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>' +
          '<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
      ),
  users: draw(
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>' +
          '<circle cx="9" cy="7" r="4"/>' +
          '<path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
      ),
  smartphone: draw(
      '<rect x="5" y="2" width="14" height="20" rx="2"/>' +
      '<path d="M12 18h.01"/>'),
  ban: draw('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  smile: draw(
      '<circle cx="12" cy="12" r="10"/>' +
      '<path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  star: draw(
      '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2' +
      'L7 14.2 2 9.3l6.9-1z"/>'),
  target: draw(
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/>' +
      '<circle cx="12" cy="12" r="2"/>'),
  clock: icons.clock,
  hourglass: draw(
      '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12' +
          'l-4.4 4.4a2 2 0 0 0-.6 1.4V22' +
          'M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
      ),
  calendar: draw(
      '<rect x="3" y="4" width="18" height="18" rx="2"/>' +
      '<path d="M8 2v4M16 2v4M3 10h18"/>'),
  calendarcheck: icons.calendarCheck,
  check: icons.check,
};

/**
 * Returns the tile for an icon, or null if there is no drawing for `name`.
 * Without a colour, the tile is neutral.
 * @param {string} name
 * @param {?string} color
 * @param {string} className
 * @return {?HTMLElement}
 */
function iconBadge(name, color, className) {
  const svg = habitIcons[name];
  if (!svg) return null;
  return el(
      'span', {
        class: [className, !color && 'is-neutral'],
        style: {'--habit-color': color ? colorValue(color) : undefined},
      },
      markup(svg));
}

/**
 * Returns the icon tile of a habit, in the habit's colour.
 * @param {!Habit} habit
 * @param {string=} className
 * @return {?HTMLElement}
 */
export function habitIconBadge(habit, className = 'habit-icon') {
  return iconBadge(habit.icon, habit.color, className);
}

/**
 * Returns the icon tile of a category, in its colour or neutral.
 * @param {!Category} category
 * @param {string=} className
 * @return {?HTMLElement}
 */
export function categoryIconBadge(category, className = 'habit-icon') {
  return iconBadge(category.icon, category.color || null, className);
}

// Names of the icons and colours, for screen readers and tooltips. Missing
// entries fall back to the identifier.
const ICON_LABELS = {
  droplet: 'Water drop',
  apple: 'Apple',
  utensils: 'Cutlery',
  coffee: 'Coffee',
  pill: 'Pill',
  heart: 'Heart',
  dumbbell: 'Dumbbell',
  bike: 'Bicycle',
  mountain: 'Mountain',
  flame: 'Flame',
  bed: 'Bed',
  alarm: 'Alarm clock',
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
  moon: 'Moon',
  sun: 'Sun',
  book: 'Book',
  pencil: 'Pencil',
  lightbulb: 'Light bulb',
  code: 'Code',
  globe: 'Globe',
  music: 'Music',
  palette: 'Paint palette',
  camera: 'Camera',
  leaf: 'Leaf',
  home: 'House',
  wallet: 'Wallet',
  users: 'People',
  smartphone: 'Smartphone',
  ban: 'No entry',
  smile: 'Smile',
  star: 'Star',
  target: 'Target',
  clock: 'Clock',
  hourglass: 'Hourglass',
  calendar: 'Calendar',
  calendarcheck: 'Calendar with check mark',
  check: 'Check mark',
};

const COLOR_LABELS = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  lime: 'Lime',
  green: 'Green',
  teal: 'Teal',
  sky: 'Sky blue',
  blue: 'Blue',
  indigo: 'Indigo',
  violet: 'Violet',
  pink: 'Pink',
  slate: 'Slate',
};

/**
 * Returns the name of an icon in the UI language.
 * @param {string} name
 * @return {string}
 */
export function iconLabel(name) {
  return t(ICON_LABELS[name] ?? name);
}

/**
 * Returns the name of a palette colour in the UI language.
 * @param {string} name
 * @return {string}
 */
export function colorLabel(name) {
  const label = COLOR_LABELS[name];
  return label ? t(label) : name;
}

/**
 * Fills `host` with a radio button per icon, preceded by "no icon", and calls
 * `onPick` with the chosen name ("" for none). Names without a drawing are
 * skipped.
 * @param {!Element} host
 * @param {?Array<string>|undefined} names
 * @param {function(string): void} onPick
 */
export function buildIconChoices(host, names, onPick) {
  const offered = ['', ...(names ?? []).filter((name) => habitIcons[name])];
  host.replaceChildren(
      ...offered.map((name) => {
        // "No icon" is an empty tile.
        const b =
            el('button', {
              type: 'button',
              class: ['icon-choice', !name && 'is-none'],
              data: {icon: name},
              role: 'radio',
              'aria-label': name ? t('Icon {name}', {name: iconLabel(name)}) :
                                   t('No icon'),
              title: name ? iconLabel(name) : t('No icon'),
            },
               name && markup(habitIcons[name]));
        b.addEventListener('click', () => onPick(name));
        return b;
      }),
  );
}

/**
 * Selects the choice for `name`.
 * @param {!Element} host
 * @param {string} name
 */
export function markIconChoice(host, name) {
  for (const node of host.querySelectorAll('.icon-choice')) {
    node.setAttribute('aria-checked', String(node.dataset.icon === name));
  }
}

/**
 * Inserts the icon named in data-icon into each element below `root`. Elements
 * that already have their icon are skipped.
 * @param {!ParentNode=} root
 */
export function paintIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    const svg = icons[node.dataset.icon];
    if (!svg || node.querySelector('svg')) continue;
    node.insertAdjacentHTML('afterbegin', svg);
  }
}

// ---------- components ----------

/**
 * The attributes and the content of each icon's markup, parsed once.
 * @type {!Map<string, {attrs: !Object<string, string>, body: string}>}
 */
const parsedIcons = new Map();

/**
 * Splits the markup of an icon into the attributes of its <svg> element and
 * the shapes inside it.
 * @param {string} svg
 * @return {{attrs: !Object<string, string>, body: string}}
 */
function parseIcon(svg) {
  let parsed = parsedIcons.get(svg);
  if (!parsed) {
    const [, attrText, body] = svg.trim().match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
    const attrs = {};
    for (const [, name, value] of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[name] = value;
    }
    parsed = {attrs, body};
    parsedIcons.set(svg, parsed);
  }
  return parsed;
}

/**
 * An icon as an inline <svg> element: `name` names one of `icons`, or `svg`
 * gives the markup itself (e.g. of a habit icon). Renders nothing for an
 * unknown name. The markup is constant, so it is safe as innerHTML.
 */
export const AppIcon = {
  name: 'AppIcon',
  props: {name: String, svg: String},
  setup(props) {
    return () => {
      const markup = props.svg ?? icons[props.name];
      if (!markup) return null;
      const {attrs, body} = parseIcon(markup);
      return h('svg', {...attrs, innerHTML: body});
    };
  },
};

/**
 * Reports whether `name` is a habit icon with a drawing.
 * @param {?string|undefined} name
 * @return {boolean}
 */
export function hasHabitIcon(name) {
  return Boolean(name && habitIcons[name]);
}

/**
 * The icon tile of a habit or category: its icon in its colour, or neutral
 * without a colour. Renders nothing if the icon has no drawing; callers show
 * a dot instead where needed (hasHabitIcon).
 */
export const IconBadge = {
  name: 'IconBadge',
  props: {icon: String, color: String},
  setup(props) {
    return {habitIcons, colorValue};
  },
  template: `
    <span v-if="habitIcons[icon]" :class="{'is-neutral': !color}"
          :style="color ? {'--habit-color': colorValue(color)} : null">
      <app-icon :svg="habitIcons[icon]"/>
    </span>`,
};

/**
 * Returns the CSS value of a palette colour. Habits, categories and the accent
 * store palette names (domain.Colors); base.css defines their shades as
 * --c-red and so on.
 * @param {string} name
 * @return {string}
 */
export function colorValue(name) {
  return `var(--c-${name})`;
}
