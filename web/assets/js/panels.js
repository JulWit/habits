// Building blocks shared by the habit and category views: a row of stat tiles
// and a panel listing labelled facts.

/** Builds a row of stat tiles from [label, value] pairs. */
export function statRow(stats) {
  const row = document.createElement("div");
  row.className = "stat-row";
  for (const [label, value] of stats) {
    const tile = document.createElement("div");
    tile.className = "stat";
    tile.innerHTML = `<div class="value"></div><div class="label"></div>`;
    tile.querySelector(".value").textContent = value;
    tile.querySelector(".label").textContent = label;
    row.append(tile);
  }
  return row;
}

/**
 * Builds a panel with a heading and a list of facts, each built by
 * factItem.
 */
export function factsPanel(title, items, className = "details") {
  const panel = document.createElement("section");
  panel.className = `panel ${className}`;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const list = document.createElement("dl");
  list.className = "activity-list";
  list.append(...items);

  panel.append(heading, list);
  return panel;
}

/** Builds a labelled fact, with an optional note after the value. */
export function factItem(label, value, note = "") {
  const item = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  if (note) {
    const small = document.createElement("span");
    small.className = "note";
    small.textContent = note;
    dd.append(small);
  }
  item.append(dt, dd);
  return item;
}
