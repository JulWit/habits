# Structure

```
main.go                     Startup, signal handling, embedded frontend; the
                            subcommands healthcheck, move-user and backup
internal/config             Configuration from environment variables
internal/auth               User identification (single-user or trusted headers)
internal/domain             The rules of the tracker (no I/O)
  habit.go                    Habit, kinds, frequencies, colours and icons; validation
  edit.go                     HabitEdit: creating and editing a habit, archiving
  schedule.go                 Schedule versions and which days they make due
  entry.go                    A day's entry: value or skip
  period.go                   Weeks and months of times-per-week/-month habits
  status.go                   The status of each day (DayStatus)
  streak.go                   Streak runs
  stats.go                    A habit's statistics: streaks, completion rate, total
  daystats.go                 Day statistics over many habits
  totals.go                   A habit's values summed per day, week or month
  category.go                 Category and CategoryEdit
  date.go                     Date without time of day
  problem.go                  Validation errors with a code (Problem)
internal/settings           User settings: defaults, options and rules
internal/store              SQLite: transactions, schema, migrations, undo steps
  store.go                    Opening the database (a writing connection and a
                              read-only pool), backup, transactions per user (View,
                              Update), users, IDs
  schema.go                   Schema of new databases and the migrations
  habits.go                   Habits
  schedules.go                Schedule versions of the habits
  entries.go                  Entries
  categories.go               Categories
  reorder.go                  Saving the order of habits and categories
  settings.go                 Settings
  changes.go                  Undo steps: watching the rows a change writes, undo, redo
internal/httpapi            Routing, JSON API, frontend delivery
  server.go                   Routes of all endpoints, middleware, GET /, the
                              assets and GET /healthz
  json.go                     JSON bodies, error responses, 404 for unknown /api/ paths
  build.go                    Version and build information of the binary
  manifest.go                 GET /manifest.webmanifest
  handlers_habits.go          GET /api/state; GET, POST, PATCH, DELETE /api/habits…;
                              POST /api/habits/reorder; the habit views they share
  handlers_entries.go         PUT /api/habits/{id}/entries/{date}
  handlers_stats.go           GET /api/days, GET /api/habits/{id}/totals
  handlers_skips.go           POST /api/skips
  handlers_categories.go      POST, PATCH, DELETE /api/categories…;
                              POST /api/categories/reorder
  handlers_undo.go            POST /api/undo, POST /api/redo
  handlers_settings.go        GET, PATCH /api/settings
  handlers_transfer.go        GET /api/export, POST /api/import, DELETE /api/data
scripts/genicons.go         Generates the PNG app icons
scripts/firefox_test.py     Tests the frontend in Firefox with mouse, keyboard and touch
scripts/format_templates.py Formats the Vue templates (Vue style guide)
scripts/format_css.py       Formats the stylesheets (Google HTML/CSS style guide)
.clang-format               Formatting of the frontend JS (Google style)
Dockerfile                  Container image: cross-compiled binary on scratch
.github/workflows/image.yml Tests, then builds and publishes the image (see DEPLOYMENT.md)
.github/dependabot.yml      Weekly updates of Go modules and GitHub Actions
docs/                       This documentation
web/                        Frontend (Vue, ES modules, no build step)
  index.html                  App shell, rendered as a Go template: the appearance
                              settings on <html> and the element Vue mounts into
  manifest.webmanifest        Web app manifest; served with the colours of the
                              user's theme (manifest.go)
  sw.js                       Service worker for offline start
  assets/css/                 Loaded in this order, from the general to the
                              specific; a later file may override an earlier one
    fonts.css                   @font-face rules of the embedded fonts
    base.css                    Design tokens (colours, palette, density), the
                                page and background patterns, the app shell,
                                buttons, shared text; global sizes for narrow
                                and touch screens
    forms.css                   Form controls: fields, segmented controls,
                                weekday buttons, dropdowns, stepper, picker
                                button, switch, slider
    ui.css                      Building blocks of js/ui/: habit icons and names,
                                app bar, stat tiles and panels, year navigation,
                                grid and heatmap, tooltips, toasts, drag and
                                drop, colour and icon choices
    dialogs.css                 Dialog and page frames, settings, search,
                                category picker, day dialog
    board.css                   The overview: day header, cards, rows, day cells,
                                day summary, tight and stacked board, edit mode
    views.css                   Habit, category and day statistics views, the
                                cumulative chart, the style guide
  assets/fonts/               Embedded woff2 fonts and their licences
  assets/images/              App icon (SVG and PNG), the chevron of dropdowns and
                              the grain pattern
  assets/vendor/              Vue's ESM browser build and its licence
  assets/js/                  One module per file, named in kebab-case, in a
                              folder by its role; each exports its components
    app.js                      Entry point: root component (shell), appearance, shortcuts
    vue.js                      Vue, imported from the vendor directory
    data/                       State, server and navigation; no components
      state.js                    Reactive client-side state; typedefs Habit, Category, Entry, …
      api.js                      API client
      actions.js                  All data changes
      loader.js                   Loads and reloads the state; sync status and retries
      outbox.js                   Offline: remembered state and waiting entry writes
      undo.js                     Undo/redo through the server
      remote-stats.js             Statistics a view loads from the server
      route.js                    The shown view (reactive) and navigation between views
    views/                      The views (*-view) and the parts only they use
      board-view.js               Board with category blocks, day header and active day
      board-cells.js              Header day, habit label and day cell of the board
      day-summary.js              Day summary with progress ring and the orbs flying into it
      habit-view.js               Habit detail view
      category-view.js            Category detail view
      day-stats-view.js           Day statistics view
      style-guide-view.js         Style guide at #/styleguide, loaded on first use
    dialogs/                    Dialogs and pages (*-editor, *-picker, *-dialog)
      habit-editor.js             Habit dialog
      category-editor.js          Category dialog
      category-picker.js          Category picker
      day-editor.js               Day dialog: value and skip
      skip-editor.js              Page for skipping a range of days
      search-dialog.js            Search dialog
      settings-dialog.js          Settings pages
    ui/                         Building blocks shared by views and dialogs
      app-bar.js                  Title bar of the habit, category and day statistics views
      stat-panels.js              Stat tiles and fact panels of the statistics views
      year-grid.js                Year label and navigation, heatmap grid and day heatmap
                                  of the statistics views
      icons.js                    Inline SVG icons; icon, colour and icon choice components
      patterns.js                 Background patterns drawn as SVG tiles
      toast.js                    Toasts and the messages of errors
      tooltip.js                  Tooltips
      page-stack.js               Full-screen pages and dialogs, stacked with history entries
      drag-reorder.js             Drag and drop reordering
    util/                       Helpers without components or state of their own
      dates.js                    Date helpers
      i18n.js                     Translations and time zone
      habit-helpers.js            Reads the day statuses; value, schedule and streak helpers
```

`internal/domain` depends neither on the database nor on HTTP and is tested
without either.

The handlers in `internal/httpapi` are grouped by the data they serve, not one
file per route. `GET /api/state` lives in `handlers_habits.go` because its
response is mostly the list of habit views, built by `viewFor` and
`computeHistory` like the other habit endpoints; the rest of the response
(settings, options, build) is only gathered there.

The frontend has no build step (no npm, no bundler); `go build` is all that is
needed for a release. Vue compiles the templates of the components in the
browser, which is why the CSP allows eval.

A future tool (e.g. kanban, pomodoro) would be a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
