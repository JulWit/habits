# Usage

| Action | How |
|---|---|
| Tick off | Tap the day; tap again to undo |
| Increase count/time/distance | Tap: adds one step (default: count 1, time 5 min, distance 500 m; configurable per habit), also beyond the target |
| Set an exact value or skip a day | Long press or right-click opens the day dialog |
| Clear a day | Day dialog, then "Clear": removes the value and the skip. On a day the habit is not due on, the dialog only offers this |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or "Undo" in the toast. The undo history is kept on the server, so it survives a reload and is shared by all devices |
| Move between days and habits | Arrow keys; `Home`/`End` for the first and last day, with `Ctrl` for the first and last habit. The days are a single tab stop, and the arrows page to earlier or later days at the end of a row |
| Select a day | Click the day in the day header; click today to go back |
| Back to today | Floating button at the bottom of the screen |
| Show only open habits | Filter in the header |
| New habit | `+` in the header or `N` |
| Open a habit's detail view | Click its name on the board |
| Edit a habit | Pencil in the title bar of its detail view |
| Archive, reactivate or delete a habit | Menu (⋮) of its detail view |
| Day statistics | Click the day summary above the board |
| Search habits and categories | Magnifier in the header, `/` or `Ctrl+K`; finds archived habits too |
| Settings | Gear in the header |
| Assign or create a category | "Category" field in the habit editor |
| Edit or delete a category | Click the category heading, then "Edit" or "Delete" |
| Reorder habits and categories | Settings → "Arrange"; then by drag and drop or with arrow buttons (`reorderMode`). Dragging near the top or bottom edge scrolls the page along. "Finish arranging" at the bottom of the screen ends it. Arranging turns the "only open" filter off, and turning the filter on ends arranging, as it would hide habits and handles |
| Close the detail view | `Esc` |
| Skip several days (holiday, illness) | Settings → "Skip days" for all habits; "Skip days…" in the menu of a habit's detail view for one or all |
| Show an earlier year in a statistics view | Arrows beside the heatmap's year |
| Import, export or delete all data | Settings → "Data" |

**Habit editor**: A habit has a name, an icon, a colour and optionally a
category. "Kind" chooses what a day records: "Check" (done or not), "Count"
with a unit of your own (e.g. glasses), "Time" in minutes or "Distance" in
kilometres. For the measured kinds, "Step" is what one tap adds and "Goal"
chooses a target or a limit (see "Limits" below). "Frequency" is
"Daily", "Times per week", "Times per month", "Weekdays" (every week, every
few weeks, or one occurrence in the month such as the first Monday) or
"Custom interval" (every few days from a starting day). A changed target or
frequency applies from today on; "Apply to past days as well" applies it to
the whole history. The kind is fixed once the habit exists. See
[DATAMODEL.md](DATAMODEL.md#habits).

**Archiving**: An archived habit keeps its history but leaves the board, the
day statistics and "Skip days" for all habits. Settings → "Archive" shows
archived habits on the board again; their detail view offers "Reactivate".
Deleting a habit removes it with its history; undo brings it back.

**Views**: Besides the board there are three views, each with an address of
its own, so the browser's back button closes them:

- The **detail view** of a habit (`#/habit/{id}`): streaks, completion rate
  and total, a heatmap of the year, its values summed per day, week or month
  with a cumulative chart, and the details of its schedule, earlier ones
  included.
- The **category view** (`#/category/{id}`), opened from the category
  heading: the progress, perfect days and current streak of its habits, a
  heatmap of the year and the list of its habits.
- The **day statistics** (`#/days`), opened from the day summary: perfect
  days and streaks over all habits that are not archived, a heatmap of the
  year and the rates by weekday and month.

`#/styleguide` shows the building blocks of the interface, for development.

**Offline**: The app can be installed from the browser and starts without a
connection, with the data last loaded. Values recorded offline are shown as
pending, wait on the device and are sent once the connection is back; the
header shows how many are waiting. Everything else (skipping days, editing
habits and categories, settings, undo) needs a connection. See
[DATAFLOW.md](DATAFLOW.md#offline).

**Active day**: The board has one active day, today by default. The day
marker in the header, the band in the cards, the day summary, the categories'
progress bars and the "only open" filter all refer to it. The filter shows the
habits due on the active day that are not yet complete; a habit completed
by a tap stays for two seconds, so a quick second tap does not hit the next
row moving up. While another day is
active, today's date is underlined in the header. The selection is not saved;
it resets to today on reload and with "Back to today". Tapping a cell still
writes to that cell's day, whichever day is active.

**Skipping a day**: "Skip this day" in the day dialog, e.g. when ill or on
holiday. A skipped day does not count: it neither breaks nor extends the
streak and is left out of the rate, the day summary and the filter. Future
days can be skipped too. A tap on a skipped day records a value and ends the
skip. See [DATAMODEL.md](DATAMODEL.md#entries).

**Skipping several days**: "Skip days" takes a first and a last day (up to 366
days) and one habit or all that are not archived. It skips the due days
without an entry; days with an entry keep it. Undo takes all of them back
at once.

**Years in the statistics views**: The detail view, the category view and
the day statistics show one calendar year, the current one when the view
opens. The arrows beside the heatmap's year go back to the first year of the
history: of the habit, or of the habits counted that are not archived. In the
detail view, the year changes the heatmap and the cumulative chart; in the
category view, the heatmap, the perfect days and the streak, which for an
earlier year is the one at its end; in the day statistics, everything. The
completion rate always covers its window up to today.

**Limits**: For count, time and distance, "Goal" in the habit editor chooses
"At least" (a target to reach) or "At most" (a limit to stay within, e.g. at
most 2 cups of coffee; 0 means none at all). Days without an entry keep the
limit. See [DATAMODEL.md](DATAMODEL.md#targets-and-limits).

**Times per week or month**: "Number of days" in the habit editor chooses
"At least" or "Exactly". Once a week or month has enough completed days, its
other days are no longer due, so the day's progress can reach 100%. With "At
least" they can still be ticked off as a bonus, which takes the day's
progress beyond 100%; the board draws their ring dashed. With "Exactly" they
are closed. See
[DATAMODEL.md](DATAMODEL.md#frequencies).

**Undo**: Deleting, archiving and editing habits and categories, entries,
skipped days and imports can be undone, the latest 100 changes for 30 days. A
deleted habit comes back with its history. A change that was changed again
since, e.g. on another device, cannot be undone; the app says so instead of
overwriting the newer change. Reordering and settings are not part of the
undo history.

**Export and import**: The export holds the habits with their schedules and
recorded days, and the categories; importing it restores them, on this server
or another. It is a backup of everything except the settings. After an
import, "Undo import" next to its result takes it back.

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
| `rateWindow` | `7`, `30`, `90`, `365`, `all` | Days the completion rate covers ("Completion rate over" in the overview settings); `all` covers the whole history |

**Day columns**: "Automatic" shows as many days as fit. A fixed number is an
upper limit; the dialog shows how many are actually displayed. At least seven
days are shown: if they do not fit, the board is stacked, each habit's name
on a line of its own above its days, which then share the whole width
(`data-stacked`, set in `board-view.js`), as long as the days keep at least
their normal width for touch; otherwise names and days shrink side by side
(`data-tight`). A fixed number below seven is respected.

**Language**: The server sets `<html lang>`; `web/assets/js/util/i18n.js`
translates using the English text as key (`t('New habit')`). Untranslated
texts are shown in English. Changing the language reloads the page.

**Time zone**: Determines the server's `today`, and thus the last day of the
board, the day a tap writes to and the open day for streaks.
