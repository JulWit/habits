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
scripts/firefox_test.py     Tests the frontend in Firefox with mouse, keyboard and touch
scripts/format_templates.py Formats the Vue templates (Vue style guide)
scripts/format_css.py       Formats the stylesheets (Google HTML/CSS style guide)
.clang-format               Formatting of the frontend JS (Google style)
web/                        Frontend (Vue, ES modules, no build step)
  index.html                  App shell, rendered as a Go template: the appearance
                              settings on <html> and the element Vue mounts into
  sw.js                       Service worker for offline start
  assets/css/                 Design tokens, components, forms, fonts
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
      year-grid.js                Year label and heatmap grid of the statistics views
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

The frontend has no build step (no npm, no bundler); `go build` is all that is
needed for a release. Vue compiles the templates of the components in the
browser, which is why the CSP allows eval.

A future tool (e.g. kanban, pomodoro) would be a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
