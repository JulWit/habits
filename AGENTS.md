# Agent guide

A self-hosted habit tracker: Go server with SQLite and an embedded Vue frontend
of plain ES modules without a build step, compiled into a single binary.
Details are in `docs/`; read
the relevant file before changing an area:

- `docs/STRUCTURE.md`: where things live
- `docs/DATAFLOW.md`: how client and server exchange data, undo, offline
- `docs/DATAMODEL.md`: the tables, kinds, frequencies, schedules, streaks
- `docs/API.md`: endpoints, request bodies, error format, export format
- `docs/EXTENDING.md`: checklists for new fields, kinds, endpoints, settings, migrations
- `docs/USAGE.md`: how the app is used, the settings
- `docs/BUILDING.md`: building, formatters, the Firefox test, updating Vue
- `docs/DEPLOYMENT.md`: environment variables, container, authentication

## Principles

These come first; the rules below follow from them.

- **Readability has top priority.** Prefer code a reader understands in one
  pass over clever or short code. Use established patterns and practices, for
  example:
  - *Code locality*: keep what belongs together in one place, close to where
    it is used; avoid indirection and abstractions without a second user.
  - *Parse, don't validate*: turn untrusted input into typed values once at
    the boundary (e.g. `domain.ParseDate` into `domain.Date`) and work with
    those afterwards, instead of re-checking raw values further down.
  - Clear names, small functions with one job, early returns, no hidden side
    effects.
- **Online first.** The server is the source of truth and the normal case is a
  connection. Offline support is a fallback: the app shell starts from the
  cache, and only entry writes wait in the outbox (see `docs/DATAFLOW.md`).
  Do not build new features around offline operation or client-side copies of
  server logic.
- **Always a single binary.** Server, frontend, Vue, fonts and icons are
  embedded; at runtime only the database file is created. Ideally `go build`
  is the only build step: no npm, bundler, code generation or asset pipeline
  in the regular build (Vue compiles its templates in the browser). No CGO, so
  cross-compiling keeps working.
- **Follow the platform guidelines.** The UI follows Apple's Human Interface
  Guidelines and Google's Material Design guidelines as far as possible
  (touch target sizes, spacing, feedback, focus and keyboard handling, dialogs,
  contrast, accessibility). Where they differ, choose what fits the target
  platforms below.
- **Target platforms.** Mainly desktop (Windows and Linux, Firefox) and
  smartphone/tablet (Android, Firefox). Test changes in Firefox, both with
  mouse and keyboard and with touch at phone width. Do not rely on
  Chromium-only or Safari-only features.

## Commands

```bash
go build -o habits .   # build (also the only "build" for the frontend)
go run .               # run on http://localhost:8080, single-user mode
go test ./...          # all tests; they use temporary SQLite files
go vet ./...
gofmt -l .             # must print nothing
```

On a Windows checkout with `core.autocrlf=true`, `gofmt -l` lists every file
because of the CRLF line endings; that is not a formatting error. Check a file
without them instead: `tr -d '\r' < path/file.go | gofmt -l`.

There is no npm, no bundler and no JS test runner. Frontend changes are checked
in the browser (`go run .`, then reload; assets are embedded, so restart the
server after changing files in `web/`). `scripts/firefox_test.py` drives an
installed Firefox through the main flows with mouse, keyboard and touch; run
it against a server with a scratch database (see `docs/BUILDING.md`) and
extend it along with the frontend.

## CI and release

Every push to `main` runs `gofmt -l`, `go vet` and `go test` in
`.github/workflows/image.yml`; once they pass, it builds the container image
and publishes it to ghcr.io as `:latest` and `:main`. A tag `v*` also
publishes `:1.2.3` and `:1.2`. Pull requests are only tested. So every push
to `main` ships: run the commands above before pushing, and tag only when
asked.

## Rules

- **The server owns the rules.** Frequencies, the status of each day, streaks,
  statistics and totals are computed only in `internal/domain`. The client
  reads `days` (the day statuses), `stats` and `streakRuns` from the API, or
  loads a view's statistics with `remote()`; it never judges a day or counts
  anything itself.
- **`internal/domain` has no I/O.** It must not import the store or HTTP
  packages and is tested without them.
- **Migrations are append-only.** Add the next one to `migrations` in
  `internal/store/schema.go`, raise `latestVersion` and make the same change to
  `schema`. Never edit a released migration.
- **One transaction per request.** Handlers read, check and write in one
  `store.View` or `store.Update`; they never call the store outside of it.
  The statistics of the answer are computed after it, from what it loaded
  (`habitData` in `internal/httpapi/handlers_habits.go`): `Update` writes on
  a single connection that every other write waits for, and `View` reads on
  a small pool of read-only connections.
- **Every user-owned query is scoped to the user.** Rows refer to `users` with
  `ON DELETE CASCADE`.
- **Undo lives on the server.** A change that can be undone calls
  `tx.Record(label, params...)` in its `store.Update` and answers with
  `writeChange`; every store write method registers its rows with `watch`
  before changing them (`internal/store/changes.go`). In the frontend, every
  data change goes through `web/assets/js/data/actions.js`, which offers the
  undo with `offerUndo(changeId, text)`.
- **Export is a full backup.** A new field of a habit or category also goes
  into `exportHabit` or `exportCategory` in
  `internal/httpapi/handlers_transfer.go` and back out on import, or exports
  silently lose it. Older files lack the field, so it needs a sensible zero
  value. Raise `exportVersion` only when older files can no longer be read;
  the import accepts only its own version.
- **Errors** are created with `domain.Invalid(code, template, params...)`. Each
  new `code` needs a German entry in `DE_ERRORS` in
  `web/assets/js/util/i18n.js`, and a removed one takes its entry along;
  `TestEveryProblemCodeIsTranslated` and `TestEveryTranslatedCodeIsSent`
  enforce this.
- **UI text** is written in English and wrapped in `t('...')`; the English text
  is the key. Add the German translation to `DE` in `i18n.js`.
- **Writing endpoints** require `Content-Type: application/json` (CSRF
  protection). Keep it that way. On top, `http.CrossOriginProtection` refuses
  changing requests from other origins and `HABITS_ALLOWED_HOSTS` other host
  names, for every route behind `authenticate` (`internal/httpapi/server.go`).
- **Logging** in a handler goes through `s.logFor(ctx)`, which adds the
  request's ID and user; `writeStoreError` does so for errors.
- **CSP** forbids inline scripts and external origins; it allows eval only
  for Vue's template compiler. Put JS in `web/assets/js/`, and embed fonts,
  images and libraries (`web/assets/vendor/`) instead of loading them.
- **Vue** is the embedded ESM browser build (`web/assets/vendor/`), imported
  through `web/assets/js/vue.js`. The state in `state.js` is reactive; views
  read it and render again by themselves. Do not build DOM by hand; DOM code
  is left for measuring, focus, drag and drop and animations.
- **Colours** are stored as palette names (`red`, `teal`, …), not CSS values.
  Use the tokens in `web/assets/css/base.css`.
- No new dependencies (Go modules or frontend libraries) without asking.

## Style

- Match the surrounding code: small functions, a doc comment on each exported
  Go identifier and on every JS function (see below), comments that explain
  why.
- Go follows the [Google Go style
  guide](https://google.github.io/styleguide/go/guide): standard library
  first, `gofmt`, tests in `_test.go` files next to the code.
- JS: ES modules, no classes unless the file already uses them. File names in
  kebab-case, with a suffix for views (`-view`) and dialogs (`-editor`,
  `-picker`, `-dialog`). Modules live in a folder by their role: `data/`
  (state, server, navigation), `views/`, `dialogs/`, `ui/` (building blocks
  shared by views and dialogs) and `util/` (helpers); `app.js` and `vue.js`
  stay at the top. A part only one view uses stays with it in `views/`. See
  `docs/STRUCTURE.md`.
- Vue components are plain objects (`export const TheHabitView = {…}`) with
  `setup()` (Composition API) and a `template` string in the same file, next
  to the functions they use. Components used by one module stay in it;
  shared state and the function that opens a dialog live at module level.
  `app.js` registers `AppIcon`, `AppIconBadge` and `t` for every template.
- Vue code follows the [Vue style guide](https://vuejs.org/style-guide/).
  Component names: `The…` for views and dialogs that exist once
  (`TheBoardView`, `TheHabitEditor`), `App…` for shared presentational
  components (`AppStatRow`), and a child used by one parent starts with the
  parent's name (`BoardHabitRow`, `SettingsMenuItem`). In templates, tags are
  kebab-case and self-closing without content; an element with more than one
  attribute has one attribute per line and its closing bracket on a line of
  its own; attributes follow the guide's order (`v-for`, `v-if`, `id`, `ref`
  and `:key`, `v-model`, other attributes, `@events`); expressions stay
  simple, anything longer goes into a `computed` or a function in `setup()`.
  Format the templates with `uv run scripts/format_templates.py
  web/assets/js/*.js web/assets/js/*/*.js`, after clang-format.
- JS follows the [Google JavaScript style
  guide](https://google.github.io/styleguide/jsguide.html): single quotes,
  80 columns (templates included), braces around every block except a
  one-line `if` without `else`, a trailing comma in wrapped array and object
  literals, `CONSTANT_CASE` for module constants that are never changed
  (`ICONS`, `HABIT_ICONS`), an `@enum` in `UpperCamelCase` with
  `CONSTANT_CASE` members (`Status.OFF_DONE`), a JSDoc comment on every
  module constant (with `@const {type}` for objects and arrays), and no import
  cycles between modules: a module that must call back into one that imports
  it gets the function passed in (see `initSync` in `loader.js`). Format with
  `uvx clang-format -i web/sw.js web/assets/js/*.js web/assets/js/*/*.js`
  (`.clang-format`; a developer tool, not a build step). Long UI texts in
  `t('…')` and `i18n.js` stay on one line, so they can be searched for.
- Every module starts with a `@fileoverview` JSDoc comment. Every function,
  `setup()` included, has a JSDoc comment with Closure types (`@param
  {string}`, `@return {?Habit}`); the shared data types are typedefs in
  `state.js`. Prefer a typedef or record type to a bare `Object`.
- HTML (`index.html` and the templates) and CSS follow the [Google HTML/CSS
  style guide](https://google.github.io/styleguide/htmlcssguide.html):
  lowercase, double quotes around attribute values, no entity references
  besides the characters HTML reserves, no `style` attributes (custom
  properties bound with `:style`, and those the server writes into
  `index.html`, excepted), IDs only where needed and with a hyphen. In CSS:
  class selectors instead of ID and type-qualified ones, three-digit hex
  colours where possible, lowercase values outside strings, no data URIs
  (images go into `web/assets/images/`), and no `!important` besides the one
  for `[hidden]`. Format with `uv run scripts/format_css.py
  web/assets/css/*.css`: one selector and one declaration per line,
  declarations in alphabetical order (custom properties first, grouped by
  meaning), a blank line between rules, single quotes, a leading `0`.
- Element IDs in the templates follow the same names: a view or dialog has
  the name of its module (`habit-view`, `day-editor`), and the elements inside
  it are prefixed with that name, without a trailing `-dialog`
  (`habit-editor-title`, `settings-look-title`).
- CSS classes stand in for the scoped styles of the Vue style guide, which
  need single-file components: a class used by one component starts with its
  name in kebab-case, without `The` (`board-block-head`, `app-stat-row-tile`);
  views and dialogs use the prefix of their element IDs (`habit-view-year-nav`,
  `settings-menu`). Classes without such a prefix are shared: the app shell
  and buttons in `base.css` (`topbar`, `view`, `button`), form controls in
  `forms.css` (`field`, `segmented`), what several views show in `ui.css`
  (`habit-icon`, `color-dot`, `heatmap-day`, `panel`), the dialog frame in
  `dialogs.css` (`dialog`), and the states `is-…` and `has-…`.
- A rule goes into the stylesheet of the first component its selector names,
  read from the left, as the context owns its overrides: `base.css` (no
  component), `forms.css` (form controls), `ui.css` (`app-…` and the shared
  classes of `web/assets/js/ui/`), `dialogs.css`, `board.css` (`board-…`) or
  `views.css`. They load in this order (`index.html`, `sw.js`), so a later
  file may override an earlier one; raise `CACHE` in `sw.js` when adding or
  removing one. Hover, pressed (`:active`) and touch-screen rules of a
  component sit at the end of its file, after its other rules.
- Prose in docs and comments uses British spelling ("colour"); identifiers use
  American spelling (`color`).

## Documentation

Keep `docs/` in sync with the code:

- a new endpoint or request body → `docs/API.md`
- a new table or column → `docs/DATAMODEL.md`
- a new setting, control or view → `docs/USAGE.md`
- a change to loading, writing, undo or offline → `docs/DATAFLOW.md`
- a new file → `docs/STRUCTURE.md`
- a new environment variable → `docs/DEPLOYMENT.md`
- a new build, formatting or test step → `docs/BUILDING.md`
- a new extension point → `docs/EXTENDING.md`

Keep `README.md` short.

## Commits

One logical change per commit. The subject is a short imperative English
sentence without a prefix or trailing period, e.g. `Add import and export of
the habits`. Dependabot's pull requests are the exception: their subjects
start with `deps:` (`.github/dependabot.yml`); leave them as they are, but do
not copy the prefix.
