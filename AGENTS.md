# Agent guide

A self-hosted habit tracker: Go server with SQLite and an embedded frontend of
plain ES modules, compiled into a single binary. Details are in `docs/`; read
the relevant file before changing an area:

- `docs/STRUCTURE.md`: where things live
- `docs/DATAFLOW.md`: how client and server exchange data, undo, offline
- `docs/DATAMODEL.md`: kinds, frequencies, schedules, streaks, schema
- `docs/API.md`: endpoints and error format
- `docs/EXTENDING.md`: checklists for new fields, kinds, settings, migrations

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
- **Always a single binary.** Server, frontend, fonts and icons are embedded;
  at runtime only the database file is created. Ideally `go build` is the only
  build step: no npm, bundler, code generation or asset pipeline in the
  regular build. No CGO, so cross-compiling keeps working.
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
server after changing files in `web/`).

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
- **Every user-owned query is scoped to the user.** Rows refer to `users` with
  `ON DELETE CASCADE`.
- **Undo lives on the server.** A change that can be undone calls
  `tx.Record(label, params...)` in its `store.Update` and answers with
  `writeChange`; every store write method registers its rows with `watch`
  before changing them (`internal/store/changes.go`). In the frontend, every
  data change goes through `web/assets/js/actions.js`, which offers the undo
  with `offerUndo(changeId, text)`.
- **Errors** are created with `domain.Invalid(code, template, params...)`. Each
  new `code` needs a German entry in `deErrors` in `web/assets/js/i18n.js`;
  `TestEveryProblemCodeIsTranslated` enforces this.
- **UI text** is written in English and wrapped in `t("...")`; the English text
  is the key. Add the German translation to `de` in `i18n.js`.
- **Writing endpoints** require `Content-Type: application/json` (CSRF
  protection). Keep it that way.
- **CSP** forbids inline scripts and external origins. Put JS in
  `web/assets/js/`, and embed fonts and images instead of loading them.
- **Colours** are stored as palette names (`red`, `teal`, …), not CSS values.
  Use the tokens in `web/assets/css/base.css`.
- No new dependencies (Go modules or frontend libraries) without asking.

## Style

- Match the surrounding code: small functions, a doc comment on each exported
  Go identifier and on non-obvious JS functions, comments that explain why.
- Go: standard library first, `gofmt`, tests in `_test.go` files next to the
  code.
- JS: ES modules, no framework, no classes unless the file already uses them.
  File names in kebab-case, with a suffix for views (`-view`) and dialogs
  (`-editor`, `-picker`, `-dialog`); see `docs/STRUCTURE.md`.
- Prose in docs and comments uses British spelling ("colour"); identifiers use
  American spelling (`color`).

## Documentation

Keep `docs/` in sync with the code. A new endpoint goes into `docs/API.md`, a
new setting into `docs/USAGE.md`, a new file into `docs/STRUCTURE.md`, and a
new extension point into `docs/EXTENDING.md`. Keep `README.md` short.

## Commits

One logical change per commit. The subject is a short imperative English
sentence without a prefix or trailing period, e.g. `Add import and export of
the habits`.
