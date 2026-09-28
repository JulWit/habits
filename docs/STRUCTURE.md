# Structure

```
main.go                     Startup, signal handling, embedded frontend
internal/config             Configuration from environment variables
internal/auth               User identification (single-user or trusted headers)
internal/domain             Habits, schedules, day statuses, streaks, statistics (no I/O)
internal/settings           User settings: defaults, options and rules
internal/store              SQLite: transactions, schema, migrations, undo steps
internal/httpapi            Routing, JSON API, frontend delivery
scripts/genicons.go         Generates the PNG app icons
web/                        Frontend (ES modules, no build step)
  index.html                  App shell, rendered as a Go template
  sw.js                       Service worker for offline start
  assets/css/                 Design tokens, components, forms, fonts
  assets/fonts/               Embedded woff2 fonts and their licences
  assets/images/              App icon (SVG and PNG)
  assets/js/                  One module per file, named in kebab-case:
                              *-view for a view, *-editor, *-picker or *-dialog
                              for a dialog
    app.js                      Entry point, routing, appearance, shortcuts
    state.js                    Client-side state
    api.js                      API client
    actions.js                  All data changes
    undo.js                     Undo/redo through the server, and toasts
    outbox.js                   Offline: remembered state and waiting entry writes
    remote-stats.js             Statistics a view loads from the server
    habit-helpers.js            Reads the day statuses; value, schedule and streak helpers
    board-view.js               Board with category blocks, day header and active day
    board-cells.js              Habit row and day cell of the board
    day-summary.js              Day summary with progress ring and the orbs flying into it
    drag-reorder.js             Drag and drop reordering
    habit-view.js               Habit detail view
    category-view.js            Category detail view
    day-stats-view.js           Day statistics view
    style-guide-view.js         Style guide at #/styleguide
    app-bar.js                  Title bar of the habit and category views
    stat-panels.js              Stat tiles and fact panels of the statistics views
    year-grid.js                Year label and heatmap grid of the statistics views
    habit-editor.js             Habit dialog
    category-editor.js          Category dialog
    category-picker.js          Category picker
    day-editor.js               Day dialog: value and skip
    skip-editor.js              Page for skipping a range of days
    search-dialog.js            Search dialog
    settings-dialog.js          Settings dialog
    page-stack.js               Full-screen pages and dialogs, stacked with history entries
    tooltip.js                  Tooltips
    dom.js                      DOM helpers: el() builds elements, markup() parses trusted SVG
    i18n.js                     Translations and time zone
    dates.js                    Date helpers
    icons.js                    Inline SVG icons
    patterns.js                 Background patterns drawn as SVG tiles
```

`internal/domain` depends neither on the database nor on HTTP and is tested
without either.

The frontend has no build step (no npm, no bundler); `go build` is all that is
needed for a release.

A future tool (e.g. kanban, pomodoro) would be a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
