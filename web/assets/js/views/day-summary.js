/**
 * @fileoverview Day summary above the board: the active day's date, how many
 * habits are done, and a progress ring that the orbs of newly completed habits
 * fly into.
 */

import {state} from '../data/state.js';
import {colorValue} from '../ui/icons.js';
import {daysBetween, formatFull, yearOf} from '../util/dates.js';
import * as habitHelpers from '../util/habit-helpers.js';
import {t} from '../util/i18n.js';
import {computed, reactive, watch} from '../vue.js';

/**
 * The board element, which holds the summary. Set by initSummary.
 * @type {?HTMLElement}
 */
let board = null;

/**
 * Sets the board element, in which the orbs find their cells and the ring.
 * @param {!HTMLElement} boardElement
 */
export function initSummary(boardElement) {
  board = boardElement;
}

/**
 * Counts the habits due on `day` and how many of them are complete, by the
 * statuses the server sent, and the habits done on top of what their week or
 * month needs (bonus), which are not due.
 * @param {!Array<!Habit>} habits
 * @param {string} day
 * @return {{due: number, done: number, bonus: number}}
 */
export function dayProgress(habits, day) {
  const active = habits.filter((h) => !h.archivedAt);
  const due = active.filter((h) => habitHelpers.isDue(h, day));
  const done = due.filter((h) => habitHelpers.isDone(h, day));
  const bonus = active.filter((h) => habitHelpers.isBonus(h, day));
  return {due: due.length, done: done.length, bonus: bonus.length};
}

/**
 * Messages for a completed day; the date selects one, so it stays stable.
 * @const {!Array<function(number): string>}
 */
const COMPLETE_TEXTS = [
  () => t('All habits done!'),
  () => t('Everything ticked off. Well done!'),
  () => t('Done for today – enjoy the rest of it.'),
  (n) => t('{n} of {n}. Nothing left to do today.', {n}),
  () => t('A clean sweep today!'),
];

/**
 * Returns the message for a completed day.
 * @param {number} due
 * @return {string}
 */
function completeText(due) {
  const pick = daysBetween('2000-01-01', state.today) % COMPLETE_TEXTS.length;
  return COMPLETE_TEXTS[pick](due);
}

// Ring geometry in viewBox units (0 0 40 40).

/** Radius of the ring. */
const RING_R = 15.5;

/** Amplitude of the ring's wave. */
const RING_WAVE = 0.9;

/** Number of waves around the ring; whole, so the wave closes smoothly. */
const RING_WAVES = 16;

/**
 * SVG path of the wavy ring around RING_R, starting at twelve o'clock and
 * running clockwise.
 * @const {string}
 */
const WAVY_RING_PATH = (() => {
  const steps = 240;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const r = RING_R + RING_WAVE * Math.sin(RING_WAVES * t);
    // Start at the top.
    const x = 20 + r * Math.cos(t - Math.PI / 2);
    const y = 20 + r * Math.sin(t - Math.PI / 2);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
})();

/**
 * What the ring shows: the fill animates from `from` to `to` (in percent)
 * whenever `key` changes, as the fill is then drawn anew and its keyframe
 * animation starts again. While orbs are in flight, `filling` replaces the
 * animation with a transition that follows their landings.
 */
const ring = reactive({from: 0, to: 0, key: 0, filling: false});

/**
 * The ring's value when it last showed the actual progress, or null before
 * the first. A new value animates from there.
 * @type {?number}
 */
let lastRingPercent = null;

/**
 * Shows `percent` on the ring: animated from the last value, or, while orbs
 * are in flight, once they have landed.
 * @param {number} percent
 */
function showPercent(percent) {
  if (ringHold) {
    ringHold.target = percent;
    ring.filling = true;
    ring.to = ringHold.shown;
    return;
  }
  ring.from = lastRingPercent ?? 0;
  ring.to = percent;
  ring.filling = false;
  ring.key++;
  lastRingPercent = percent;
}

/**
 * The day summary: the active day's date, progress and ring. Counts all
 * habits, regardless of paging and filter. Emits `open` to open the day
 * statistics.
 */
export const BoardDaySummary = {
  name: 'BoardDaySummary',
  props: {
    habits: {type: Array, required: true},
    day: {type: String, required: true},
  },
  emits: ['open'],
  /**
   * @param {{habits: !Array<!Habit>, day: string}} props
   * @return {!Object<string, *>} the bindings of the template
   */
  setup(props) {
    const progress = computed(() => dayProgress(props.habits, props.day));
    // A bonus takes the progress beyond 100%.
    const percent = computed(() => {
      const {due, done, bonus} = progress.value;
      return due === 0 ? 0 : Math.round(((done + bonus) / due) * 100);
    });
    // No ring, and nothing to animate, if nothing is due on the day.
    watch(() => (progress.value.due > 0 ? percent.value : null), (value) => {
      if (value !== null) showPercent(value);
    }, {immediate: true});

    return {
      progress,
      bonusText: computed(
          () => progress.value.bonus > 0 ?
              t('+{n} bonus', {n: progress.value.bonus}) :
              ''),
      isComplete: computed(() => {
        const {due, done} = progress.value;
        return due > 0 && done === due;
      }),
      ring,
      // Filling from empty, the ring also fades in (ring-wind in the CSS).
      ringStyle: computed(() => ({
                            '--from': ring.from,
                            '--to': ring.to,
                            '--from-opacity': ring.from === 0 ? 0 : 1,
                          })),
      RING_R,
      WAVY_RING_PATH,
      // The year only if it is not the current one.
      date: computed(
          () =>
              formatFull(props.day, yearOf(props.day) !== yearOf(state.today))),
      // The varying messages of a completed day speak of today.
      completeText: computed(
          () => props.day === state.today ? completeText(progress.value.due) :
                                            t('All habits done!')),
    };
  },
  template: `
    <button
      class="board-day-summary"
      :class="{'is-complete': isComplete}"
      data-role="open-days"
      type="button"
      :title="t('Show day statistics')"
      @click="$emit('open')"
    >
      <span class="board-day-summary-text">
        <span class="board-day-summary-date">{{ date }}</span>
        <span class="board-day-summary-count">
          <template v-if="progress.due === 0">{{ t('Nothing due on this day') }}
          </template>
          <template v-else-if="progress.done < progress.due">
            {{ t('{done} of {due} done', progress) }}
          </template>
          <template v-else><app-icon name="check"/>
            <span>{{ completeText }}</span>
          </template>
          <span
            v-if="bonusText"
            class="board-day-summary-bonus"
          >
            {{ bonusText }}
          </span>
        </span>
      </span>
      <span
        v-if="progress.due > 0"
        class="board-day-summary-ring"
      >
        <svg
          viewBox="0 0 40 40"
          aria-hidden="true"
        >
          <circle
            class="board-day-summary-ring-track"
            cx="20"
            cy="20"
            :r="RING_R"
          />
          <!-- pathLength="100" allows dash lengths in percent. -->
          <path
            :key="ring.key"
            class="board-day-summary-ring-fill"
            :class="{'is-filling': ring.filling, 'is-empty': ring.to === 0}"
            :d="WAVY_RING_PATH"
            pathLength="100"
            :style="ringStyle"
          />
        </svg>
        <span class="board-day-summary-percent">
          {{ Math.round(ring.to) }}%</span>
      </span>
    </button>`,
};

// ---------- ticking off: orbs into the ring ----------

/**
 * State of the ring while orbs are in flight, or null. `shown` is the
 * displayed value, `planned` the value after all launched orbs, `target` the
 * actual value and `pending` the number of orbs in flight.
 * @type {?{shown: number, planned: number, target: number, pending: number}}
 */
let ringHold = null;

/**
 * The IDs of the habits complete on the active day at the last call of
 * newlyDone.
 * @type {?Set<string>}
 */
let lastDone = null;
/**
 * The active day of the last call of newlyDone.
 * @type {?string}
 */
let lastDoneDay = null;

/**
 * An orb flight: the habit's colour and the centre of its cell.
 * @typedef {{color: string, x: number, y: number}}
 */
let Flight;

/**
 * The number of orbs sent per completed habit.
 */
const ORBS_PER_HABIT = 6;

/**
 * Returns the habits completed on the active day since the last call, each
 * with the position of its cell on the board. Must be called before the board
 * is updated, while it still shows the cells. Returns nothing on the first
 * call and after a change of the active day.
 * @param {!Array<!Habit>} habits
 * @param {string} day
 * @return {!Array<!Flight>}
 */
export function newlyDone(habits, day) {
  // A bonus counts towards the ring as well.
  const counted = habits.filter(
      (h) => !h.archivedAt &&
          (habitHelpers.isDue(h, day) || habitHelpers.isBonus(h, day)));
  const done = new Set(
      counted.filter((h) => habitHelpers.isDone(h, day)).map((h) => h.id));
  const before = lastDoneDay === day ? lastDone : null;
  lastDone = done;
  lastDoneDay = day;
  // No animation in a hidden page.
  if (!before || !board || prefersReducedMotion() || document.hidden) {
    return [];
  }

  const fresh = counted.filter((h) => done.has(h.id) && !before.has(h.id));
  // No ring, no orbs.
  if (fresh.length === 0 || !board.querySelector('.board-day-summary-ring')) {
    return [];
  }

  const flights = [];
  for (const habit of fresh) {
    const cell = board.querySelector(`.board-day-cell[data-habit="${
        habit.id}"][data-date="${day}"] .board-day-cell-mark`);
    const rect = cell?.getBoundingClientRect();
    // Cell not visible.
    if (!rect || rect.width === 0) continue;
    flights.push({
      color: habit.color,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }
  if (flights.length === 0) return [];

  // Keep the ring at its current value.
  const shown = ringHold?.shown ?? lastRingPercent ?? 0;
  ringHold ??= {shown, planned: shown, target: shown, pending: 0};
  return flights;
}

/**
 * Reports whether the user asked for less motion.
 * @return {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
      false;
}

/**
 * Returns the ring element on the board, or null.
 * @return {?Element}
 */
function ringElement() {
  return board?.querySelector('.board-day-summary-ring') ?? null;
}

/**
 * Returns the screen position of the wave at `percent`, or null.
 * @param {number} percent
 * @return {?{x: number, y: number}}
 */
function ringPoint(percent) {
  const r = ringElement()?.getBoundingClientRect();
  if (!r || r.width === 0) return null;
  // RING_R scaled from the viewBox.
  const radius = (r.width / 40) * RING_R;
  const angle = (percent / 100) * 2 * Math.PI - Math.PI / 2;
  return {
    x: r.left + r.width / 2 + radius * Math.cos(angle),
    y: r.top + r.height / 2 + radius * Math.sin(angle),
  };
}

/**
 * Returns the top of the visible board area, below the sticky header.
 * @return {number}
 */
function visibleTop() {
  let top = 0;
  for (const bar
           of [document.querySelector('.topbar'),
               board?.querySelector('.board-view-day-header')]) {
    if (bar) top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  return top;
}

/**
 * Shows a short flash where an orb leaves the visible area. `color` is a CSS
 * colour value, taken from the orb.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {string} color
 */
function flash(x, y, size, color) {
  const spark = document.createElement('span');
  spark.className = 'board-day-summary-orb board-day-summary-orb-flash';
  spark.style.setProperty('--habit-color', color);
  spark.style.width = spark.style.height = `${size}px`;
  spark.style.left = `${x - size / 2}px`;
  spark.style.top = `${y - size / 2}px`;
  orbLayer().append(spark);
  spark
      .animate(
          [
            {transform: 'scale(.6)', opacity: 1},
            {transform: 'scale(2.6)', opacity: 0},
          ],
          {duration: 380, easing: 'ease-out'},
          )
      .onfinish = () => spark.remove();
}

/**
 * Returns the layer for the orbs, above the board and below dialogs. It lies
 * outside the Vue app, as the orbs are moved frame by frame.
 * @return {!HTMLElement}
 */
function orbLayer() {
  let layer = document.getElementById('board-day-summary-orbs');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'board-day-summary-orbs';
    layer.className = 'board-day-summary-orbs';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

/**
 * Sends orbs in the habit's colour from its cell to the ring. Each orb
 * advances the ring when it lands.
 * @param {!Flight} flight
 */
export function launchOrbs({color, x, y}) {
  const hold = ringHold;
  if (!hold) return;
  const from = hold.planned;
  const to = hold.target;
  hold.planned = to;
  hold.pending += ORBS_PER_HABIT;

  const layer = orbLayer();
  for (let i = 0; i < ORBS_PER_HABIT; i++) {
    const orb = document.createElement('span');
    orb.className = 'board-day-summary-orb';
    orb.style.setProperty('--habit-color', colorValue(color));
    const size = 7 + Math.random() * 5;
    orb.style.width = orb.style.height = `${size}px`;
    orb.style.transform =
        `translate(${x - size / 2}px, ${y - size / 2}px) scale(0)`;
    layer.append(orb);

    flyOrb(orb, {
      x,
      y,
      size,
      landing: from + ((to - from) * (i + 1)) / ORBS_PER_HABIT,
      delay: i * 70,
      duration: 650 + Math.random() * 250,
      // Direction and amount of the curve, random per orb.
      bend: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3),
    });
  }
}

/**
 * Moves an orb along a curve from its cell to the ring.
 * @param {!HTMLElement} orb
 * @param {{x: number, y: number, size: number, landing: number, delay: number,
 *     duration: number, bend: number}} flight where it starts, its size, the
 *     ring value it lands at, and the timing and bend of its curve
 */
function flyOrb(orb, {x, y, size, landing, delay, duration, bend}) {
  let start = null;

  /**
   * Draws the orb at the time `now` and requests the next frame.
   * @param {number} now
   */
  const frame = (now) => {
    start ??= now + delay;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    // Look up the ring every frame, as it may be re-rendered or scrolled.
    const end = ringPoint(landing);
    if (!end) {
      orb.remove();
      landOrb(landing, false);
      return;
    }
    // If the ring is not visible, aim at the top of the visible area and flash
    // there.
    const edge = visibleTop();
    const hidden = end.y < edge;
    if (hidden) end.y = edge;

    // Quadratic curve, bent sideways and slightly upwards.
    const dx = end.x - x;
    const dy = end.y - y;
    const cx = x + dx / 2 - dy * bend;
    const cy = y + dy / 2 + dx * bend - Math.hypot(dx, dy) * 0.15;
    // Ease in-out (cubic).
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * x + 2 * u * e * cx + e * e * end.x;
    let py = u * u * y + 2 * u * e * cy + e * e * end.y;
    // Stay below the header.
    if (hidden) py = Math.max(py, edge);
    // Grow at the start, then shrink.
    const scale = t < 0.15 ? t / 0.15 : 1 - 0.45 * ((t - 0.15) / 0.85);
    orb.style.transform =
        `translate(${px - size / 2}px, ${py - size / 2}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      orb.remove();
      if (hidden) {
        flash(end.x, end.y, size, orb.style.getPropertyValue('--habit-color'));
      }
      landOrb(landing, !hidden);
    }
  };
  requestAnimationFrame(frame);
}

/**
 * Advances the ring when an orb lands.
 * @param {number} landing the ring value the orb lands at
 * @param {boolean} visible whether the ring is visible
 */
function landOrb(landing, visible) {
  const hold = ringHold;
  if (!hold) return;
  hold.pending--;
  hold.shown = hold.pending === 0 ? hold.target : landing;
  ring.to = hold.shown;

  if (visible) {
    ringElement()?.animate(
        [
          {transform: 'scale(1)'},
          {transform: 'scale(1.07)'},
          {transform: 'scale(1)'},
        ],
        {duration: 220, easing: 'ease-out'},
    );
  }

  // `filling` stays on, so the keyframe animation does not replay.
  if (hold.pending === 0) {
    ringHold = null;
    lastRingPercent = hold.target;
  }
}
