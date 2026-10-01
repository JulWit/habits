# Extending

## New migration

Add the statements to `migrations` in `internal/store/schema.go`, keyed by
the version they start from, raise `latestVersion` and make the same change to
`schema`, which creates new databases. Never change released migrations.
`PRAGMA user_version` stores the schema version; databases older than
`oldestVersion` are refused. `TestMigrationFromVersion3` checks that a
migrated database ends up with the schema of a new one.

## New habit field

1. Field and validation in `domain.Habit` (or in `domain.Schedule` if the
   field should be versioned, like the target)
2. Column via migration
3. Read and write in `internal/store/habits.go`
4. Pointer field with a JSON tag in `domain.HabitEdit` (the request body of
   creating and editing) and its `applyFields`
5. Input in `web/assets/js/dialogs/habit-editor.js`
6. Export and import: a field in `exportHabit` (`internal/httpapi/handlers_transfer.go`),
   filled in `exportHabitOf` and read back on import; a field of
   `domain.Schedule` is exported with the schedules already
7. The column in [DATAMODEL.md](DATAMODEL.md#habits) and the body in
   [API.md](API.md#habits)

Undo restores it without further work, as undo steps keep whole rows (see
[DATAFLOW.md](DATAFLOW.md#undo)).

## New habit kind

Add it to `allKinds` in `internal/domain/habit.go` and handle it in `Scale`,
`Step`, `MaxTarget` and `Unit`. The client receives these values via `kinds`;
the editor needs its input fields. Also handle it in `domain.ConvertKind`
(see [DATAMODEL.md](DATAMODEL.md#kinds)).

## New frequency

Implement the rule in `domain.Schedule.IsScheduled`. The client only reads the
status of each day the server sends (see
[DATAFLOW.md](DATAFLOW.md#day-statuses)), so it needs no change beyond the
editor. A frequency that counts completed days per
period, like `times_per_week` and `times_per_month`, also needs its period in
`domain.periodOf` (`internal/domain/period.go`), which the statistics and
streaks use.

## New language

A dictionary in `i18n.js`, an entry under `"language"` in `options`
(`internal/settings/settings.go`) and the day and month names in `dates.js`.

## New icon

Add its name to `habitIcons` in `internal/domain/habit.go`, at the place the
editor should offer it, and its drawing to `HABIT_ICONS` in
`web/assets/js/ui/icons.js`. Its English name for screen readers and tooltips
goes into `ICON_LABELS` there, with the German one in `DE` in `i18n.js`. The
client receives the list via `icons` in the state.

## New colour

Add its name to `colors` in `internal/domain/habit.go`, its shade as
`--c-<name>` in `web/assets/css/base.css`, and its English name to
`COLOR_LABELS` in `icons.js`, with the German one in `DE` in `i18n.js`. The
client receives the palette via `colors` in the state. No migration is
needed, as habits and categories store the name (see
[DATAMODEL.md](DATAMODEL.md#colours)).

## New validation error

Use `domain.Invalid(code, template, params...)` and add an entry to
`DE_ERRORS` in `i18n.js`; `TestEveryProblemCodeIsTranslated` checks that every
code has one. Removing a code removes its entry too, which
`TestEveryTranslatedCodeIsSent` checks. The template is an error string: lower
case and without a trailing full stop. The client capitalises it when it shows
it.

## New endpoint

1. Route in `New` in `internal/httpapi/server.go`, wrapped in `withUser`
2. Handler in the `handlers_*.go` file of the data it serves (see
   [STRUCTURE.md](STRUCTURE.md)): decode the body with `decodeJSON`, which
   also enforces `Content-Type: application/json`, and work in one
   `store.View` or `store.Update`
3. Errors as `domain.Invalid` (see below) or through `writeStoreError`
4. A change that can be undone: see [Undo for a new action](#undo-for-a-new-action)
5. A method in the `api` object of `web/assets/js/data/api.js`; data changes
   go through `actions.js`
6. A row in the table of [API.md](API.md#endpoints), and in
   [STRUCTURE.md](STRUCTURE.md) if it gets a file of its own

## New setting

A field in `settings.Settings` (`internal/settings`), its default in
`Default` and, unless any value is fine, its check in `Validate`:
`checkOption(key, value)` with an entry in `options` for a choice (sent with
the state as `options`; the settings page renders its choices from it), or a
check function of its own. Then its control in the template of
`settings-dialog.js`, and, if it changes the look before the state is loaded,
an attribute in `index.html` and in `initAppearance` in `app.js`. No
migration is needed; stored documents without the field get the default.

Removing an option, or narrowing what a check accepts, needs a migration that
rewrites the stored values (e.g. with `json_set` on `user_settings.data`):
stored settings are not repaired when they are read, and an invalid stored
value would make every later save of the settings fail.

## Undo for a new action

Write in a `store.Update` and call `tx.Record(template, params...)` with an
English label (translated by the client like any text). The store keeps the
rows the write changed as the undo step, as long as every write method
registers its rows with `watch` before changing them (`internal/store/changes.go`).
Answer with `writeChange(w, changeID)`, so the client can offer to undo it with
`offerUndo(changeId, text)` in `web/assets/js/data/actions.js`. A new table that
undo should cover needs its primary key in `primaryKeys`.

## New statistic

Compute it in `internal/domain` and send it from the server, in the habit view
or an endpoint of its own (see `handlers_stats.go`); a view loads the latter
with `remote()` (`web/assets/js/data/remote-stats.js`). The client shows
statistics, it does not compute them.

## New view or dialog

A component in a module of its own (`*-view.js`, or `*-editor.js`,
`*-picker.js`, `*-dialog.js`), exported and placed in the template of `App` in
`app.js`. A view shows itself when `route.view` names it (`route.js`, which
also needs its hash) and renders nothing while hidden. A dialog renders its
own `<dialog>`, keeps its input in reactive state at module level and exports
the function that fills it and opens it with `openPage` (`page-stack.js`).

## New tool

A new tool (e.g. kanban, pomodoro) goes in a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
