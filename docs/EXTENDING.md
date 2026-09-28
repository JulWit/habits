# Extending

## New migration

Append a string to `migrations` in `internal/store/schema.go` and make the
same change to `schema`, which creates new databases. Never change released
migrations. `PRAGMA user_version` stores the schema version: 1 plus the number
of migrations applied.

## New habit field

1. Field and validation in `domain.Habit` (or in `domain.Schedule` if the
   field should be versioned, like the target)
2. Column via migration
3. Read and write in `internal/store/habits.go`
4. Pointer field in `habitInput` (`internal/httpapi/handlers_habits.go`)
5. Input in `web/assets/js/editor.js`
6. Add it to `writableFields()` in `web/assets/js/actions.js`, otherwise undo
   does not restore it

## New habit kind

Add it to `AllKinds` in `internal/domain/habit.go` and handle it in `Scale`,
`Step`, `MaxTarget` and `Unit`. The client receives these values via `kinds`;
the editor needs its input fields. Also handle it in `domain.ConvertKind`
(see [DATAMODEL.md](DATAMODEL.md#kinds)).

## New frequency

Implement the rule in `domain.Schedule.IsScheduled`. The client only reads the
due days the server sends (see [DATAFLOW.md](DATAFLOW.md#due-days)), so it
needs no change beyond the editor.

## New language

A dictionary in `i18n.js`, an entry under `"language"` in `store.Options` and
the day and month names in `dates.js`.

## New validation error

Use `domain.Invalid(code, template, params...)` and add an entry to
`deErrors` in `i18n.js`; `TestEveryProblemCodeIsTranslated` checks that every
code has one.

## New setting

A field in `store.Settings` with its default in `DefaultSettings` and its
rule: an entry in `store.Options` for a choice (the settings page renders its
options from it) or a check function, called in both `Settings.Validate` and
`Settings.resetInvalid`. Then its control in `index.html` and `settings.js`.
No migration is needed; stored documents without the field get the default.

## Undo for a new action

Perform the action in `web/assets/js/actions.js`, then call
`record({label, undo, redo})`. `undo` and `redo` are server calls.

## New tool

A new tool (e.g. kanban, pomodoro) goes in a separate `internal/<tool>`
package with its own domain and tables, sharing `config`, `auth`, the store,
the routing and the CSS tokens in `web/assets/css/base.css`.
