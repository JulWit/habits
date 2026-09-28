# Usage

| Action | How |
|---|---|
| Tick off | Tap the day; tap again to undo |
| Increase count/time/distance | Tap: adds one step (default: count 1, time 5 min, distance 500 m; configurable per habit), also beyond the target |
| Set an exact value, skip a day or add a note | Long press or right-click opens the day dialog |
| Clear a day | Day dialog, then "Clear": removes the value, the skip and the note |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or "Undo" in the toast |
| Move between days and habits | Arrow keys; `Home`/`End` for the first and last day, with `Ctrl` for the first and last habit. The days are a single tab stop, and the arrows page to earlier or later days at the end of a row |
| Select a day | Click the day in the day header; click today to go back |
| Back to today | Floating button at the bottom of the screen |
| Show only open habits | Filter in the header |
| New habit | `N` |
| Search habits and categories | Magnifier in the header, `/` or `Ctrl+K` |
| Settings | Gear in the header |
| Assign or create a category | "Category" field in the habit editor |
| Edit or delete a category | Click the category heading, then "Edit" or "Delete" |
| Close the detail view | `Esc` |
| Skip several days (holiday, illness) | Settings → "Skip days" for all habits; "Skip days…" in the menu of a habit's detail view for one or all |
| Import, export or delete all data | Settings → "Data" |

**Active day**: The board has one active day, today by default. The day
marker in the header, the band in the cards, the day summary, the categories'
progress bars and the "only open" filter all refer to it. The filter shows the
habits due on the active day that are not yet complete. While another day is
active, today's date is underlined in the header. The selection is not saved;
it resets to today on reload and with "Back to today". Tapping a cell still
writes to that cell's day, whichever day is active.

**Skipping a day**: "Skip this day" in the day dialog, e.g. when ill or on
holiday. A skipped day does not count: it neither breaks nor extends the
streak and is left out of the rate, the day summary and the filter. Future
days can be skipped too. A tap on a skipped day records a value and ends the
skip. See [DATAMODEL.md](DATAMODEL.md#entries).

**Skipping several days**: "Skip days" takes a first and a last day (up to 366
days), a note, and one habit or all that are not archived. It skips the due
days without an entry; days with an entry keep it, and a day's own note is
kept. Undo writes the days back as they were.

**Limits**: For count, time and distance, "Goal" in the habit editor chooses
"At least" (a target to reach) or "At most" (a limit to stay within, e.g. at
most 2 cups of coffee; 0 means none at all). Days without an entry keep the
limit. See [DATAMODEL.md](DATAMODEL.md#targets-and-limits).

**Notes**: The day dialog takes a note per day. Days with a note have a dot on
their mark; the note shows in the tooltip, in the heatmap and in the "Notes"
panel of the detail view.

Deleted habits and categories can be restored for 30 days. After that, they are
removed permanently: on the next start, and otherwise within a day.

## Settings

Settings are stored per user on the server as one JSON document and saved
immediately. Missing or invalid values fall back to their defaults.

| Key | Values | Meaning |
|---|---|---|
| `theme` | `system`, `light`, `dark` | Colour scheme; `system` follows the device |
| `font` | `system`, `inter`, `roboto`, `geist`, `opensans` | Font (all embedded) |
| `density` | `compact`, `standard`, `comfortable` | Spacing and font weights |
| `overviewDays` | 0 (automatic) or 3–90 | Day columns on the board |
| `alignWeeks` | bool | Align the board to calendar weeks |
| `showArchived` | bool | Show archived habits |
| `reorderMode` | `drag`, `buttons` | Reorder by drag and drop or with arrow buttons |
| `pattern` | `none`, `grain`, `dots`, `grid`, `lines`, `icons`, `halftone` | Page background; `grain` is a rough texture, `icons` the habit icons in a staggered grid, `halftone` dots in halftone waves |
| `bandColor` | `neutral` or a palette colour | Colour of the day marker and band (on the active day) |
| `bandOpacity` | 0–100 | Opacity of the day marker in the header |
| `bandFillOpacity` | 0–100 | Opacity of the band in the cards |
| `showBand` | bool | Show the band in the cards |
| `language` | `system`, `en`, `de` | UI language; `system` uses the browser's `Accept-Language`, falling back to English |
| `timeZone` | `""` or an IANA name | Time zone for "today"; `""` uses `HABITS_TZ` |

**Day columns**: "Automatic" shows as many days as fit. A fixed number is an
upper limit; the dialog shows how many are actually displayed. At least seven
days are shown: if they do not fit, the board is compacted (`data-tight`, set
in `overview.js`). A fixed number below seven is respected.

**Language**: The server sets `<html lang>`; `web/assets/js/i18n.js`
translates using the English text as key (`t("New habit")`). Untranslated
texts are shown in English. Changing the language reloads the page.

**Time zone**: Determines the server's `today`, and thus the last day of the
board, the day a tap writes to and the open day for streaks.
