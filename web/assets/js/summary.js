// Day summary above the board: the active day's date, how many habits are
// done, and a progress ring that the orbs of newly completed habits fly into.

import { daysBetween, yearOf, formatFull } from "./dates.js";
import { state } from "./state.js";
import * as H from "./habit.js";
import { icons, colorValue } from "./icons.js";
import { t } from "./i18n.js";

/** The board element, which holds the summary. Set by initSummary. */
let board;

export function initSummary(boardElement) {
  board = boardElement;
}

/** Counts the habits due on `day` and how many of them are complete. */
export function dayProgress(habits, day) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, day));
  const done = due.filter((h) => H.isComplete(h, day, h.entries[day] ?? 0));
  return { due: due.length, done: done.length };
}

/**
 * Builds the day summary below the header: the active day's date, progress
 * and ring. Refers to all habits, regardless of paging and filter.
 */
export function daySummary(habits, day) {
  const { due, done } = dayProgress(habits, day);
  const percent = due === 0 ? 0 : Math.round((done / due) * 100);
  const isToday = day === state.today;

  const el = document.createElement("section");
  el.className = "day-summary";

  const text = document.createElement("div");
  text.className = "day-summary-text";

  const date = document.createElement("h2");
  date.className = "day-summary-date";
  // The year only if it is not the current one.
  date.textContent = formatFull(day, yearOf(day) !== yearOf(state.today));
  el.setAttribute("aria-label", `${date.textContent} — ${t("Show day statistics")}`);
  // Opens the day statistics (overview.js handles the click).
  el.dataset.role = "open-days";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.title = t("Show day statistics");
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    el.click();
  });

  const count = document.createElement("p");
  count.className = "day-summary-count";
  if (due > 0 && done === due) {
    // Everything due on the day is done.
    el.classList.add("is-complete");
    count.innerHTML = icons.check; // constant markup from icons.js
    const words = document.createElement("span");
    // The varying messages speak of today.
    words.textContent = isToday ? completeText(due) : t("All habits done!");
    count.append(words);
  } else if (due === 0) {
    count.textContent = t("Nothing due on this day");
  } else {
    count.textContent = t("{done} of {due} done", { done, due });
  }
  text.append(date, count);
  el.append(text);

  // No ring if nothing is due on the day.
  if (due > 0) el.append(progressRing(percent, t("Done on this day")));
  return el;
}

/** Messages for a completed day; the date selects one, so it stays stable. */
const COMPLETE_TEXTS = [
  () => t("All habits done!"),
  () => t("Everything ticked off. Well done!"),
  () => t("Done for today – enjoy the rest of it."),
  (n) => t("{n} of {n}. Nothing left to do today.", { n }),
  () => t("A clean sweep today!"),
];

function completeText(due) {
  const pick = daysBetween("2000-01-01", state.today) % COMPLETE_TEXTS.length;
  return COMPLETE_TEXTS[pick](due);
}

// Ring geometry in viewBox units (0 0 40 40): radius, wave amplitude and number
// of waves. RING_WAVES must be a whole number so the wave closes smoothly.
const RING_R = 15.5;
const RING_WAVE = 0.9;
const RING_WAVES = 16;

/**
 * SVG path of the wavy ring around RING_R, starting at twelve o'clock and
 * running clockwise.
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
  return `M${points.join("L")}Z`;
})();

/**
 * The ring's value at the last render. A new ring animates from there to its
 * new value.
 */
let lastRingPercent = null;

/**
 * Builds the progress ring filled to `percent`, with the number in its centre
 * and `name` as its accessible label.
 * pathLength="100" allows dash lengths in percent.
 */
function progressRing(percent, name) {
  const ring = document.createElement("div");
  ring.className = "day-summary-ring";
  ring.setAttribute("role", "progressbar");
  ring.setAttribute("aria-valuemin", "0");
  ring.setAttribute("aria-valuemax", "100");
  ring.setAttribute("aria-valuenow", String(percent));
  ring.setAttribute("aria-label", name);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(ns, "circle");
  track.setAttribute("class", "day-summary-ring-track");
  track.setAttribute("cx", "20");
  track.setAttribute("cy", "20");
  track.setAttribute("r", String(RING_R));

  const fill = document.createElementNS(ns, "path");
  fill.setAttribute("class", "day-summary-ring-fill");
  fill.setAttribute("d", WAVY_RING_PATH);
  fill.setAttribute("pathLength", "100");
  svg.append(track, fill);

  const label = document.createElement("span");
  label.className = "day-summary-percent";
  ring.append(svg, label);

  // While orbs are in flight, they advance the ring as they land.
  if (ringHold) {
    ringHold.target = percent;
    fill.classList.add("is-filling");
    showRing(ring, ringHold.shown);
    return ring;
  }

  // A keyframe animation starts as soon as the element is inserted.
  const from = lastRingPercent ?? 0;
  lastRingPercent = percent;
  fill.style.setProperty("--from", String(from));
  fill.style.setProperty("--to", String(percent));
  // Fade in from 0, as a round cap would show a dot at zero length.
  fill.style.setProperty("--from-opacity", from === 0 ? "0" : "1");
  fill.classList.toggle("is-empty", percent === 0);
  label.textContent = `${percent}%`;
  return ring;
}

/** Sets an existing ring to `percent`. */
function showRing(ring, percent) {
  const fill = ring.querySelector(".day-summary-ring-fill");
  fill.style.setProperty("--to", String(percent));
  fill.classList.toggle("is-empty", percent === 0);
  ring.querySelector(".day-summary-percent").textContent = `${Math.round(percent)}%`;
}

// ---------- ticking off: orbs into the ring ----------

/**
 * State of the ring while orbs are in flight, or null. `shown` is the
 * displayed value, `planned` the value after all launched orbs, `target` the
 * actual value and `pending` the number of orbs in flight.
 */
let ringHold = null;

/** The habits complete on the active day at the last render, and the day. */
let lastDone = null;
let lastDoneDay = null;

const ORBS_PER_HABIT = 6;

/**
 * Returns the habits completed on the active day since the last render, each
 * with the position of its cell on the old board. Returns nothing on the first
 * render and after a change of the active day.
 */
export function newlyDone(habits, day) {
  const due = habits.filter((h) => !h.archivedAt && H.isScheduled(h, day));
  const done = new Set(due.filter((h) => H.isComplete(h, day, h.entries[day] ?? 0)).map((h) => h.id));
  const before = lastDoneDay === day ? lastDone : null;
  lastDone = done;
  lastDoneDay = day;
  // No animation in a hidden page.
  if (!before || prefersReducedMotion() || document.hidden) return [];

  const fresh = due.filter((h) => done.has(h.id) && !before.has(h.id));
  // No ring, no orbs.
  if (fresh.length === 0 || !board.querySelector(".day-summary-ring")) return [];

  const flights = [];
  for (const habit of fresh) {
    const cell = board.querySelector(
      `.cell[data-habit="${habit.id}"][data-date="${day}"] .mark`);
    const rect = cell?.getBoundingClientRect();
    // Cell not visible.
    if (!rect || rect.width === 0) continue;
    flights.push({ color: habit.color, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }
  if (flights.length === 0) return [];

  // Keep the ring at its current value.
  const shown = ringHold?.shown ?? lastRingPercent ?? 0;
  ringHold ??= { shown, planned: shown, target: shown, pending: 0 };
  return flights;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Returns the screen position of the wave at `percent`, or null. */
function ringPoint(percent) {
  const ring = board.querySelector(".day-summary-ring");
  const r = ring?.getBoundingClientRect();
  if (!r || r.width === 0) return null;
  // RING_R scaled from the viewBox.
  const radius = (r.width / 40) * RING_R;
  const angle = (percent / 100) * 2 * Math.PI - Math.PI / 2;
  return {
    x: r.left + r.width / 2 + radius * Math.cos(angle),
    y: r.top + r.height / 2 + radius * Math.sin(angle),
  };
}

/** Returns the top of the visible board area, below the sticky header. */
function visibleTop() {
  let top = 0;
  for (const el of [document.querySelector(".topbar"), board.querySelector(".day-header")]) {
    if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
  }
  return top;
}

/**
 * Shows a short flash where an orb leaves the visible area. `color` is a CSS
 * colour value, taken from the orb.
 */
function flash(x, y, size, color) {
  const el = document.createElement("span");
  el.className = "orb orb-flash";
  el.style.setProperty("--habit-color", color);
  el.style.width = el.style.height = `${size}px`;
  el.style.left = `${x - size / 2}px`;
  el.style.top = `${y - size / 2}px`;
  orbLayer().append(el);
  el.animate(
    [{ transform: "scale(.6)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }],
    { duration: 380, easing: "ease-out" },
  ).onfinish = () => el.remove();
}

/** Returns the layer for the orbs, above the board and below dialogs. */
function orbLayer() {
  let layer = document.getElementById("orb-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "orb-layer";
    layer.className = "orb-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
  }
  return layer;
}

/**
 * Sends orbs in the habit's colour from its cell to the ring. Each orb
 * advances the ring when it lands.
 */
export function launchOrbs({ color, x, y }) {
  const hold = ringHold;
  if (!hold) return;
  const from = hold.planned;
  const to = hold.target;
  hold.planned = to;
  hold.pending += ORBS_PER_HABIT;

  const layer = orbLayer();
  for (let i = 0; i < ORBS_PER_HABIT; i++) {
    const orb = document.createElement("span");
    orb.className = "orb";
    orb.style.setProperty("--habit-color", colorValue(color));
    const size = 7 + Math.random() * 5;
    orb.style.width = orb.style.height = `${size}px`;
    orb.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) scale(0)`;
    layer.append(orb);

    flyOrb(orb, {
      x, y, size,
      landing: from + ((to - from) * (i + 1)) / ORBS_PER_HABIT,
      delay: i * 70,
      duration: 650 + Math.random() * 250,
      // Direction and amount of the curve, random per orb.
      bend: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3),
    });
  }
}

function flyOrb(orb, { x, y, size, landing, delay, duration, bend }) {
  let start = null;

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
    orb.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      orb.remove();
      if (hidden) flash(end.x, end.y, size, orb.style.getPropertyValue("--habit-color"));
      landOrb(landing, !hidden);
    }
  };
  requestAnimationFrame(frame);
}

/** Advances the ring when an orb lands. */
function landOrb(landing, visible) {
  const hold = ringHold;
  if (!hold) return;
  hold.pending--;
  hold.shown = hold.pending === 0 ? hold.target : landing;

  const ring = board.querySelector(".day-summary-ring");
  if (ring) {
    showRing(ring, hold.shown);
    if (visible) {
      ring.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
        { duration: 220, easing: "ease-out" },
      );
    }
  }

  // Keep is-filling, so the keyframe animation does not replay.
  if (hold.pending === 0) {
    ringHold = null;
    lastRingPercent = hold.target;
  }
}
