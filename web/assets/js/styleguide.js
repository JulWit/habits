// A page that shows every building block the app draws, in both themes at once.
//
// Linked from nowhere and reached only at #/styleguide: this is a tool for
// whoever builds the next module, not a feature. Its point is that it does not
// copy any markup — the board pieces come from the same functions the overview
// calls, so a change to a cell shows up here rather than drifting out of date.

import { state } from "./state.js";
import { dayCell, habitLabel, dayEntry } from "./cells.js";
import { paintIcons } from "./icons.js";
import { addDays } from "./dates.js";
import { STREAK_LEVELS } from "./habit.js";

/** A date `back` days before today, for the sample cells. */
const day = (back) => addDays(state.today, -back);

/** Habits that exist only here, one per kind and per interesting state. */
function samples() {
  const freq = (over) => ({
    kind: "daily", timesPerWeek: 0, weekdays: 0, intervalDays: 0, anchorDate: "", ...over,
  });
  const base = {
    unit: "", archivedAt: null, categoryId: "",
    stats: { currentStreak: 0, streakUnit: "days", completionRate: 0, longestStreak: 0, total: 0 },
  };
  return {
    check: {
      ...base, id: "sg-check", name: "Meditate", color: "#2563eb", kind: "check",
      targetValue: 1, frequency: freq(),
      stats: { ...base.stats, currentStreak: 6, streakUnit: "days" },
      entries: { [day(1)]: 1, [day(2)]: 1, [day(0)]: 1 },
    },
    count: {
      ...base, id: "sg-count", name: "Drink water", color: "#0d9488", kind: "count",
      targetValue: 80, unit: "glasses", frequency: freq(),
      entries: { [day(0)]: 80, [day(1)]: 30, [day(2)]: 65 },
    },
    time: {
      ...base, id: "sg-time", name: "Reading", color: "#7c3aed", kind: "time",
      targetValue: 200, frequency: freq({ kind: "times_per_week", timesPerWeek: 4 }),
      stats: { ...base.stats, currentStreak: 1, streakUnit: "weeks" },
      entries: { [day(0)]: 200, [day(1)]: 125, [day(2)]: 250 },
    },
    distance: {
      ...base, id: "sg-distance", name: "Running", color: "#ea580c", kind: "distance",
      targetValue: 5000, frequency: freq({ kind: "every_n_days", intervalDays: 3, anchorDate: day(0) }),
      entries: { [day(0)]: 5200, [day(1)]: 2400, [day(2)]: 5000 },
    },
    // Only Mondays are scheduled, so most sample days draw the "not planned" ring.
    sparse: {
      ...base, id: "sg-sparse", name: "Laundry", color: "#64748b", kind: "check",
      targetValue: 1, frequency: freq({ kind: "weekdays", weekdays: 1 }), entries: {},
    },
    archived: {
      ...base, id: "sg-archived", name: "Old habit", color: "#db2777", kind: "check",
      targetValue: 1, frequency: freq(), entries: {}, archivedAt: day(30),
    },
  };
}

// ---------- small builders ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Constant markup from icons.js, never user input. */
function html(tag, className, markup) {
  const node = el(tag, className);
  node.innerHTML = markup;
  return node;
}

function section(title, note, ...items) {
  const s = el("section", "sg-section");
  s.append(el("h3", "sg-title", title));
  if (note) s.append(el("p", "sg-note", note));
  const row = el("div", "sg-row");
  row.append(...items);
  s.append(row);
  return s;
}

/** A labelled specimen, so a state can be named rather than guessed at. */
function specimen(label, node) {
  const box = el("div", "sg-specimen");
  box.append(node, el("span", "sg-label", label));
  return box;
}

// ---------- the sections ----------

function buttons() {
  const b = (cls, text, over = {}) => {
    const node = el("button", cls, text);
    node.type = "button";
    Object.assign(node, over);
    return node;
  };
  const icon = (name, label) => {
    const node = html("button", "icon-button", `<span data-icon="${name}"></span>`);
    node.type = "button";
    node.setAttribute("aria-label", label);
    return node;
  };
  return section(
    "Buttons",
    "Primary carries the single accent colour of the interface: dark grey on light, light on dark.",
    specimen(".button.primary", b("button primary", "Create")),
    specimen(".button", b("button", "Cancel")),
    specimen(".button.ghost", b("button ghost", "Later")),
    specimen(".button.danger", b("button danger", "Delete")),
    specimen(":disabled", b("button primary", "Save", { disabled: true })),
    specimen(".button.round", b("button round", "+")),
    specimen(".icon-button", icon("edit", "Edit")),
    specimen(".icon-button.is-back", (() => {
      const node = icon("arrowLeft", "Back");
      node.classList.add("is-back");
      return node;
    })()),
  );
}

function fields() {
  const field = (label, control, hint) => {
    const wrap = el("label", "field");
    wrap.append(el("span", "field-label", label), control);
    if (hint) wrap.append(el("p", "field-hint", hint));
    return wrap;
  };
  const input = (over) => Object.assign(el("input"), { type: "text", ...over });

  const segmented = html("div", "segmented", `
    <label><input type="radio" name="sg-kind" value="check" checked><span data-icon="check">Check</span></label>
    <label><input type="radio" name="sg-kind" value="count"><span data-icon="calculator">Count</span></label>
    <label><input type="radio" name="sg-kind" value="time"><span data-icon="clock">Time</span></label>
    <label><input type="radio" name="sg-kind" value="distance"><span data-icon="navigation">Distance</span></label>`);
  segmented.setAttribute("role", "radiogroup");
  segmented.setAttribute("aria-label", "Kind");

  const weekdays = el("div", "weekdays");
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((d, i) => {
    const w = el("button", "weekday", d);
    w.type = "button";
    w.setAttribute("aria-pressed", String(i === 0 || i === 2 || i === 4));
    weekdays.append(w);
  });

  const swatches = el("div", "swatches");
  swatches.setAttribute("role", "radiogroup");
  for (const color of state.colors) {
    const s = el("button", "swatch");
    s.type = "button";
    s.style.background = color;
    s.setAttribute("role", "radio");
    s.setAttribute("aria-checked", String(color === state.colors[0]));
    s.setAttribute("aria-label", color);
    swatches.append(s);
  }

  const stepper = el("div", "stepper");
  const minus = el("button", "button round", "−");
  const plus = el("button", "button round", "+");
  minus.type = plus.type = "button";
  stepper.append(minus, Object.assign(el("input"), { type: "number", value: "20" }), plus);

  const toggle = el("label", "switch");
  toggle.append(
    Object.assign(el("input"), { type: "checkbox", checked: true }),
    el("span", null, "Show archived habits"),
  );

  const picker = html("button", "picker", '<span class="picker-value">Health</span>');
  picker.type = "button";

  return section(
    "Form fields",
    "Everything the editor and the settings use.",
    field("Name", input({ placeholder: "e.g. drink water" })),
    field("With hint", input({ value: "5000" }), "Equals 5.0 km."),
    field("Disabled", input({ value: "Locked", disabled: true })),
    specimen(".segmented", segmented),
    specimen(".weekdays", weekdays),
    specimen(".swatches", swatches),
    specimen(".stepper", stepper),
    specimen(".switch", toggle),
    specimen(".picker", picker),
    specimen("p.error", el("p", "error", "Please select at least one weekday.")),
  );
}

function board(s) {
  // The real builders, not a copy: whatever the overview draws, this draws.
  const cells = (habit, dates) => {
    const row = el("div", "sg-cells");
    for (const iso of dates) row.append(dayEntry(habit, iso));
    return row;
  };
  const dates = [day(2), day(1), day(0), addDays(state.today, 1)];

  const header = el("div", "sg-cells");
  // Today and an ordinary day, so both header states are visible.
  header.append(dayCell(day(0)), dayCell(day(1)));

  return section(
    "Board",
    "Built with the same functions as the overview — dayCell(), habitLabel(), dayEntry().",
    specimen("dayCell: today / normal", header),
    specimen("habitLabel()", habitLabel(s.time)),
    specimen("habitLabel(): archived", habitLabel(s.archived)),
    specimen("Check", cells(s.check, dates)),
    specimen("Count", cells(s.count, dates)),
    specimen("Time", cells(s.time, dates)),
    specimen("Distance", cells(s.distance, dates)),
    specimen("not scheduled", cells(s.sparse, dates)),
    specimen("streak levels: none, 1 week … 1 year", streakScale(s.check)),
    specimen(".month-label", el("div", "month-label", "September")),
  );
}

/**
 * One completed cell per streak level, drawn through dayEntry() like the rest
 * of this page.
 *
 * Each cell gets its own day and its own run, reaching exactly as far back as
 * the level it stands for — the rendering path is then the real one, down to
 * how the run is looked up.
 */
function streakScale(habit) {
  const row = el("div", "sg-cells");
  [0, ...STREAK_LEVELS].forEach((length, i) => {
    const iso = day(i);
    row.append(dayEntry({
      ...habit,
      entries: { [iso]: 1 },
      streakRuns: length ? [{ from: addDays(iso, -(length - 1)), to: iso }] : [],
    }, iso));
  });
  return row;
}

function heatmap() {
  const row = el("div", "heatmap-sample");
  for (const level of [0, 1, 2, 3, 4]) {
    const cell = el("div", "heat");
    cell.dataset.level = String(level);
    row.append(cell);
  }
  for (const mod of ["is-off", "is-future"]) {
    const cell = el("div", `heat ${mod}`);
    row.append(cell);
  }
  return section(
    "Heatmap",
    "Levels 0–4, then \"not scheduled\" and the future.",
    specimen("data-level 0 … 4 · is-off · is-future", row),
  );
}

function feedback() {
  const toast = (cls, text, withAction) => {
    const node = el("div", cls);
    node.append(el("span", "text", text));
    if (withAction) {
      const action = el("button", "button", "Undo");
      action.type = "button";
      node.append(action);
    }
    const close = html("button", "icon-button", "&times;");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    node.append(close);
    return node;
  };
  return section(
    "Messages",
    "In the running app toasts sit at the bottom right; here they stand in the flow.",
    specimen(".toast", toast("toast", "Habit deleted.", true)),
    specimen(".toast.is-error", toast("toast is-error", "No connection to the server.", false)),
  );
}

function typography() {
  return section(
    "Text",
    "The type sizes that appear outside the building blocks.",
    specimen("h2", el("h2", null, "Heading")),
    specimen(".block-title", el("h2", "block-title", "Category")),
    specimen("p", el("p", null, "Body text, as it appears in empty states.")),
    specimen(".habit-meta", el("span", "habit-meta", "🔥 12 days · 20 min · daily")),
    specimen(".field-hint", el("p", "field-hint", "A hint below a field.")),
  );
}

/**
 * The design tokens, read out of the stylesheet rather than listed here.
 *
 * A hand-kept list would be wrong the first time someone adds a token; this
 * cannot be, because it reports exactly what the light theme declares.
 */
function tokenNames() {
  const names = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // A stylesheet from another origin. There are none, but reading cssRules
      // on one throws, and a styleguide must not take the page down with it.
      continue;
    }
    for (const rule of rules) {
      if (!rule.selectorText || !/:root/.test(rule.selectorText)) continue;
      for (const prop of rule.style) {
        if (prop.startsWith("--") && !names.includes(prop)) names.push(prop);
      }
    }
  }
  return names;
}

function tokens(names) {
  const list = el("div", "sg-tokens");
  for (const name of names) {
    const row = el("div", "sg-token");
    const chip = el("span", "sg-chip");
    // Filled from the panel's own theme, so the same row shows two colours.
    chip.style.background = `var(${name})`;
    row.append(chip, el("code", "sg-token-name", name), el("span", "sg-token-value"));
    list.append(row);
  }
  const s = section("Tokens", "Read straight from the stylesheet, not maintained here.", list);
  s.querySelector(".sg-row").classList.add("is-block");
  return s;
}

/** Resolves every token's value inside the panel it is shown in. */
function fillTokenValues(panel, names) {
  const styles = getComputedStyle(panel);
  const rows = panel.querySelectorAll(".sg-token");
  rows.forEach((row, i) => {
    // Collapsed: a multi-line calc() is stored with its line breaks intact and
    // would otherwise be printed across four lines of the table.
    const value = styles.getPropertyValue(names[i]).trim().replace(/\s+/g, " ");
    row.querySelector(".sg-token-value").textContent = value;
    // Only colours get a chip. Made invisible rather than removed: the rows are
    // display:contents, so dropping a cell would shift the grid from there on.
    if (!/^(#|rgb|hsl|color|oklch)/i.test(value)) {
      row.querySelector(".sg-chip").classList.add("is-empty");
    }
  });
}

// ---------- assembly ----------

function panel(theme, names) {
  const wrap = el("div", "sg-theme");
  wrap.dataset.theme = theme;
  wrap.append(el("h2", "sg-theme-title", theme === "dark" ? "Dark" : "Light"));

  const s = samples();
  wrap.append(tokens(names), buttons(), fields(), board(s), heatmap(), feedback(), typography());
  return wrap;
}

export function renderStyleguide(root) {
  const names = tokenNames();

  const head = el("header", "sg-head");
  head.append(el("h1", null, "Building blocks"));
  head.append(el("p", "sg-note",
    "Every building block of the application, in both themes side by side. " +
    "Not linked — reachable at #/styleguide."));

  const both = el("div", "sg-themes");
  const light = panel("light", names);
  const dark = panel("dark", names);
  both.append(light, dark);

  root.replaceChildren(head, both);
  // After insertion: the values only resolve once the panels are in the page.
  fillTokenValues(light, names);
  fillTokenValues(dark, names);
  paintIcons(root);
}
