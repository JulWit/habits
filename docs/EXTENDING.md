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
4. Pointer field in `habitInput` (`internal/httpapi/handlers_habits.go`)
5. The same field in `domain.HabitEdit` and its `applyFields`
6. Input in `web/assets/js/habit-editor.js`

Undo restores it without further work, as undo steps keep whole rows (see
[DATAFLOW.md](DATAFLOW.md#undo)).

## New habit kind

Add it to `AllKinds` in `internal/domain/habit.go` and handle it in `Scale`,
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

A dictionary in `i18n.js`, an entry under `"language"` in `settings.Options` and
the day and month names in `dates.js`.

## New validation error

Use `domain.Invalid(code, template, params...)` and add an entry to
`deErrors` in `i18n.js`; `TestEveryProblemCodeIsTranslated` checks that every
code has one.

## New setting

A field in `settings.Settings` (`internal/settings`), its default in
`Default` and, unless any value is fine, its rule in `rules`: `option(key)`
with an entry in `Options` for a choice (the settings page renders its options
from it), or a check function. Validation and the repair of stored values both
follow that one list. Then its control in `index.html` and
`settings-dialog.js`. No migration is needed; stored documents without the
field get the default.

## Undo for a new action

Write in a `store.Update` and call `tx.Record(template, params...)` with an
English label (translated by the client like any text). The store keeps the
rows the write changed as the undo step, as long as every write method
registers its rows with `watch` before changing them (`internal/store/changes.go`).
Answer with `writeChange(w, changeID)`, so the client can offer to undo it with
`offerUndo(changeId, text)` in `web/assets/js/actions.js`. A new table that
undo should cover needs its primary key in `primaryKeys`.

## New statistic

Compute it in `internal/domain` and send it from the server, in the habit view
or an endpoint of its own (see `handlers_stats.go`); a view loads the latter
with `remote()` (`web/assets/js/remote-stats.js`). The client shows
statistics, it does not compute them.

## New tool

A new tool (e.g. kanban, pomodoro) goes in a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
