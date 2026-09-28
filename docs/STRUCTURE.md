# Structure

```
main.go                     Startup, signal handling, embedded frontend
internal/config             Configuration from environment variables
internal/auth               User identification (single-user or trusted headers)
internal/domain             Habits, schedules, streaks, statistics (no I/O)
internal/store              SQLite: schema, migrations, queries
internal/httpapi            Routing, JSON API, frontend delivery
scripts/genicons.go         Generates the PNG app icons
web/                        Frontend (ES modules, no build step)
  index.html                  App shell, rendered as a Go template
  sw.js                       Service worker for offline start
  assets/css/                 Design tokens, components, forms, fonts
  assets/fonts/               Embedded woff2 fonts and their licences
  assets/images/              App icon (SVG and PNG)
  assets/js/app.js            Entry point, routing, appearance, shortcuts
  assets/js/state.js          Client-side state
  assets/js/api.js            API client
  assets/js/actions.js        All data changes with their undo steps
  assets/js/undo.js           Undo/redo and toasts
  assets/js/outbox.js         Offline: remembered state and waiting entry writes
  assets/js/overview.js       Board with category blocks, day header and active day
  assets/js/summary.js        Day summary with progress ring and the orbs flying into it
  assets/js/cells.js          Habit row and day cell
  assets/js/habit.js          Schedule, value and streak helpers
  assets/js/detail.js         Habit detail view
  assets/js/category.js       Category detail view
  assets/js/days.js           Day statistics
  assets/js/year.js           Year range, perfect days and heatmap grid of the statistics views
  assets/js/editor.js         Habit dialog
  assets/js/categoryeditor.js Category dialog
  assets/js/categorypicker.js Category picker
  assets/js/value.js          Exact value dialog
  assets/js/search.js         Search dialog
  assets/js/settings.js       Settings dialog
  assets/js/i18n.js           Translations and time zone
  assets/js/dates.js          Date helpers
  assets/js/icons.js          Inline SVG icons
  assets/js/reorder.js        Drag and drop reordering
  assets/js/styleguide.js     Style guide at #/styleguide
```

`internal/domain` depends neither on the database nor on HTTP and is tested
without either.

The frontend has no build step (no npm, no bundler); `go build` is all that is
needed for a release.

A future tool (e.g. kanban, pomodoro) would be a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
