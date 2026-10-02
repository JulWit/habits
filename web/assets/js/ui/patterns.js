/**
 * @fileoverview Background patterns drawn as SVG tiles: the habit icons and
 * halftone dots. base.css picks them up as --pattern-icons and
 * --pattern-halftone. An SVG image cannot use the page's colours, so both are
 * drawn in mid grey at low opacity, which gives dark grey on the dark theme and
 * light grey on the light one.
 */

import {HABIT_ICONS} from './icons.js';

/** SVG attributes of the faint grey every pattern is drawn in. */
const INK = 'color="#808080" fill="#808080" opacity=".12"';

/**
 * Returns an SVG image as a CSS url() value.
 * @param {string} svg
 * @return {string}
 */
const url = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/**
 * Returns an SVG tile of the given size with `shapes` drawn in INK.
 * @param {number} width
 * @param {number} height
 * @param {string} shapes
 * @return {string}
 */
function tile(width, height, shapes) {
  const size = `width="${width}" height="${height}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size}>` +
      `<g ${INK}>${shapes}</g></svg>`;
}

// Icon grid: every habit icon at least once per tile, in rows of COLS, each
// second row shifted by half a column. A last row not filled by the icons is
// completed with the first ones again.

/** Number of icons per row of the icon grid. */
const COLS = 8;

/** Horizontal distance between the icons of a row, in px. */
const STEP_X = 76;

/** Vertical distance between the rows, in px. */
const STEP_Y = 66;

/** Size of an icon, in px. */
const ICON = 22;

/**
 * Returns the icon tile and its size in pixels.
 * @return {{image: string, size: string}}
 */
function iconTile() {
  const names = Object.keys(HABIT_ICONS);
  // An even number of rows, so the shift continues across the tile edge.
  const rows = 2 * Math.ceil(names.length / (2 * COLS));
  const height = rows * STEP_Y;
  const width = COLS * STEP_X;
  /**
   * Returns the icon `name` as a nested SVG at `x`, `y`.
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @return {string}
   */
  const place = (name, x, y) => HABIT_ICONS[name].replace(
      '<svg ', `<svg x="${x}" y="${y}" width="${ICON}" height="${ICON}" `);
  const slots =
      Array.from({length: rows * COLS}, (_, i) => names[i % names.length]);
  const icons = slots.flatMap((name, i) => {
    const row = Math.floor(i / COLS);
    const x =
        (i % COLS) * STEP_X + (row % 2) * STEP_X / 2 + (STEP_X - ICON) / 2;
    const y = row * STEP_Y + (STEP_Y - ICON) / 2;
    // An icon across the right edge continues on the left one.
    return x + ICON > width ? [place(name, x, y), place(name, x - width, y)] :
                              [place(name, x, y)];
  });
  const svg = tile(width, height, icons.join(''));
  return {image: url(svg), size: `${width}px ${height}px`};
}

// Halftone: a staggered dot grid whose dots swell and shrink in diagonal
// waves, one wave per tile in each direction, so the tile repeats seamlessly.

/** Distance between the dots, in px. */
const DOT_STEP = 16;

/** Size of the square halftone tile, in px; a multiple of DOT_STEP. */
const HALFTONE_TILE = 256;

/** Radius of the largest dot, at the crest of a wave, in px. */
const DOT_MAX = 5.2;

/**
 * Returns the halftone tile and its size in pixels.
 * @return {{image: string, size: string}}
 */
function halftoneTile() {
  const dots = [];
  for (let row = 0; row < HALFTONE_TILE / DOT_STEP; row++) {
    for (let col = 0; col < HALFTONE_TILE / DOT_STEP; col++) {
      const x = col * DOT_STEP + (row % 2) * DOT_STEP / 2;
      const y = row * DOT_STEP;
      const wave = (1 - Math.cos((2 * Math.PI * (x + y)) / HALFTONE_TILE)) / 2;
      const r = DOT_MAX * wave;
      if (r < .4) continue;
      // Dots on the left and top edges continue on the opposite ones.
      for (const dx of x < r ? [0, HALFTONE_TILE] : [0]) {
        for (const dy of y < r ? [0, HALFTONE_TILE] : [0]) {
          dots.push(
              `<circle cx="${x + dx}" cy="${y + dy}" r="${r.toFixed(2)}"/>`);
        }
      }
    }
  }
  const svg = tile(HALFTONE_TILE, HALFTONE_TILE, dots.join(''));
  return {image: url(svg), size: `${HALFTONE_TILE}px ${HALFTONE_TILE}px`};
}

/**
 * Sets the pattern images as custom properties on `root`.
 * @param {!HTMLElement} root
 */
export function definePatterns(root) {
  const icons = iconTile();
  root.style.setProperty('--pattern-icons', icons.image);
  root.style.setProperty('--pattern-icons-size', icons.size);
  const halftone = halftoneTile();
  root.style.setProperty('--pattern-halftone', halftone.image);
  root.style.setProperty('--pattern-halftone-size', halftone.size);
}
