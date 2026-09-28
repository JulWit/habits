# API

All endpoints are under `/api` and return JSON. They require an authenticated
user (see [DEPLOYMENT.md](DEPLOYMENT.md#authentication-through-a-reverse-proxy));
only `/healthz` outside `/api` does not.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Complete state for the client; `?archived=0`/`1` overrides the `showArchived` setting, `?from=YYYY-MM-DD` loads entries further back |
| `POST` | `/api/habits` | Create a habit |
| `GET` | `/api/habits/{id}` | A habit with its full history |
| `PATCH` | `/api/habits/{id}` | Update the given fields; `retroactive: true` applies a new target or frequency to past days, `schedules` replaces the schedule history (used by undo) |
| `DELETE` | `/api/habits/{id}` | Soft delete |
| `POST` | `/api/habits/{id}/restore` | Restore |
| `POST` | `/api/habits/reorder` | Set the order; missing habits keep their relative order after the given ones, duplicate IDs are rejected |
| `PUT` | `/api/habits/{id}/entries/{date}` | Change a day's value or skip (from 2000-01-01 to one year ahead; recording needs a due day, removing works on any day); with `expect`, only while the day still holds that entry (409 `entry_changed` otherwise) |
| `POST` | `/api/skips` | Skip the days `from` to `to` (up to 366) of the habits `habitIds`, or of all that are not archived; see [Skipping days](#skipping-days) |
| `POST` | `/api/entries` | Write whole entries of several days at once, each only while its day still holds `expect` (undo and redo of skipped days) |
| `POST` | `/api/categories` | Create a category |
| `PATCH` | `/api/categories/{id}` | Update name, icon, colour or progress display |
| `DELETE` | `/api/categories/{id}` | Soft delete |
| `POST` | `/api/categories/{id}/restore` | Restore |
| `POST` | `/api/categories/reorder` | Set the order (same rules as for habits) |
| `GET`/`PATCH` | `/api/settings` | Settings, see [USAGE.md](USAGE.md#settings) |
| `GET` | `/api/export` | Habits (archived ones included) and categories with their settings and current schedule, as a file; no entries or statistics |
| `POST` | `/api/import` | Add the habits and categories of an export (up to 1 MB); habits whose name exists are skipped, categories are matched by name, schedules start today; all or nothing |
| `DELETE` | `/api/data` | Delete all of the user's data (habits, entries, categories, settings); cannot be undone |

Writing endpoints require `Content-Type: application/json`. This forces a CORS
preflight and protects against CSRF.

## Errors

Errors are problem details (RFC 9457, `application/problem+json`) with two
extension members: `code` identifies the problem and stays stable when the
wording changes, `params` holds the values of its message. `detail` is the
English message:

```json
{"title": "Unprocessable Entity", "status": 422, "code": "name_too_long",
 "detail": "name is longer than 80 characters", "params": {"max": 80}}
```

The client translates by `code` (`deErrors` in `i18n.js`) and fills in
`params`; without a translation it shows `detail`. A new validation error uses
`domain.Invalid(code, template, params...)` and needs an entry in `deErrors`;
`TestEveryProblemCodeIsTranslated` checks that every code has one.

## `/api/state`

Besides the habits, categories and settings, the state contains:

- `colors`: the colour palette as names (`red`, `teal`, …); see
  [DATAMODEL.md](DATAMODEL.md#colours)
- `kinds`: `scale`, `step`, `max` and `unit` per kind
- `icons`: valid icon names (`domain.HabitIcons`); `""` means no icon. The
  drawings are in `web/assets/js/icons.js`.
- `today`: the current day in the user's time zone, and `nextDayIn`: the
  milliseconds until the next day begins there. The client reloads the state
  then (see [DATAFLOW.md](DATAFLOW.md#loading-the-state)).

Entries cover the last 200 days; the detail view loads the full history via
`GET /api/habits/{id}`.

## Habits

Every habit carries `schedules` (`[{from, targetValue, targetType,
frequency}]`, oldest first); the last one is the current schedule.
`targetType` is `at_least` or, for a limit, `at_most` (see
[DATAMODEL.md](DATAMODEL.md#targets-and-limits)). The client takes each day's
target from them. `PATCH /api/habits/{id}` accepts `targetValue`, `targetType`
and `frequency` to change the current schedule.

Each habit also carries its due days as `due`, one character per day from
`dueFrom` (`1` due, `0` not), up to one year ahead, and its streak runs as
`streakRuns`. What is recorded comes in two maps keyed by date: `entries`
(the values) and `skipped` (`true` for skipped days). The full view of
`GET /api/habits/{id}` has due days from 1 January of the history's first
year, as the detail view shows whole years.

Each habit's `stats` hold its streaks and the completion rate over the days of
the `rateWindow` setting.

## Entries

`PUT …/entries/{date}` changes a day's entry. The body sets `value`,
`skipped` or both; a field left out stays as it is. A value ends a skip, and
`skipped: true` clears the value:

```json
{"value": 30}
{"skipped": true}
```

The answer carries the entry after the change (`value`, `skipped`) and
the replaced one as `previous`. Undo writes the previous entry back with
`expect` set to the entry it takes back, so it does not overwrite a change made
on another device in the meantime; on 409 the undo step is dropped.

## Skipping days

`POST /api/skips` skips a range of days, e.g. a holiday:

```json
{"from": "2026-10-01", "to": "2026-10-14", "habitIds": ["…"]}
```

Without `habitIds`, it covers all habits that are not archived. Only due days
without a value and not yet skipped change (`domain.DaysToSkip`). The answer
lists the changed days
as `changes`, each with `habitId`, `date`, `previous` and `entry`.

`POST /api/entries` undoes and redoes that: its `changes` hold `habitId`,
`date`, `expect` and `entry`, and each is written only while the day still
holds `expect`. The answer counts them as `applied` and `conflicts`.
