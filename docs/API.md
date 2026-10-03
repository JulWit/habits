# API

All endpoints are under `/api` and return JSON. They require an authenticated
user (see [DEPLOYMENT.md](DEPLOYMENT.md#authentication-through-a-reverse-proxy));
only `/healthz` outside `/api` does not.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Complete state for the client, archived habits included (the client hides them unless `showArchived` is on); `?from=YYYY-MM-DD` loads entries further back |
| `GET` | `/api/days` | Day statistics of `?year=` (default: this year) over the habits that are not archived, or those of `?category=`, see [Statistics](#statistics) |
| `POST` | `/api/habits` | Create a habit |
| `GET` | `/api/habits/{id}` | A habit with its full history |
| `PATCH` | `/api/habits/{id}` | Save what the editor shows: name, colour, icon, kind, category, step, unit, target, target type and frequency; `retroactive: true` applies a new target or frequency to past days; the kind cannot change (422 `kind_unchangeable`); `archived: true` archives the habit, `false` reactivates it |
| `DELETE` | `/api/habits/{id}` | Delete a habit with its history (undo brings it back) |
| `GET` | `/api/habits/{id}/totals` | The habit's values of `?year=` summed per `?grain=` (`day`, `week`, `month`), see [Statistics](#statistics) |
| `POST` | `/api/habits/reorder` | Set the order; missing habits keep their relative order after the given ones, duplicate IDs are rejected |
| `PUT` | `/api/habits/{id}/entries/{date}` | Change a day's value or skip (from 2000-01-01 to one year ahead; recording needs a due day, removing works on any day) |
| `POST` | `/api/skips` | Skip the days `from` to `to` (up to 366) of the habits `habitIds`, or of all that are not archived; see [Skipping days](#skipping-days) |
| `POST` | `/api/categories` | Create a category |
| `PATCH` | `/api/categories/{id}` | Update name, icon, colour or progress display |
| `DELETE` | `/api/categories/{id}` | Delete a category; its habits stay, without one (undo puts them back). Answers with the undo step (`id`, `label`, `params`), whose label says how many habits were kept |
| `POST` | `/api/categories/reorder` | Set the order (same rules as for habits) |
| `POST` | `/api/undo` | Undo the step `id`, or the latest; see [Undo](#undo) |
| `POST` | `/api/redo` | Redo the step `id`, or the one undone last |
| `GET`/`PATCH` | `/api/settings` | Settings, see [USAGE.md](USAGE.md#settings) |
| `GET` | `/api/export` | Habits (archived ones included) with their schedules and entries, and the categories, as a file |
| `POST` | `/api/import` | Add the habits and categories of an export (up to 16 MB) with their history; habits whose name exists are skipped, categories are matched by name, each existing one to one category of the file; all or nothing, one undo step |
| `DELETE` | `/api/data` | Delete all of the user's data (habits, entries, categories, settings, undo steps); cannot be undone |

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

The client translates by `code` (`DE_ERRORS` in `i18n.js`) and fills in
`params`; without a translation it shows `detail` with its first letter in
upper case. A new validation error uses `domain.Invalid(code, template,
params...)` with a template in lower case and without a trailing full stop, as
it is an error string, and needs an entry in `DE_ERRORS`;
`TestEveryProblemCodeIsTranslated` checks that every code has one, and
`TestEveryTranslatedCodeIsSent` that no message outlives its code.

## `/api/state`

Besides the habits, categories and settings, the state contains:

- `colors`: the colour palette as names (`red`, `teal`, …); see
  [DATAMODEL.md](DATAMODEL.md#colours)
- `kinds`: `scale`, `step`, `max` and `unit` per kind
- `icons`: valid icon names (`domain.HabitIcons()`); `""` means no icon. The
  drawings are in `web/assets/js/ui/icons.js`.
- `options`: the choices of the enumerated settings, keyed by the setting's
  JSON name, in the order the settings pages offer them:
  `[{value, label, icon?, lang?}]` (`settings.Options()`). The label is
  English; the client translates it.
- `today`: the current day in the user's time zone, and `nextDayIn`: the
  milliseconds until the next day begins there. The client reloads the state
  then (see [DATAFLOW.md](DATAFLOW.md#loading-the-state)).

Entries cover the last 200 days; the detail view loads the full history via
`GET /api/habits/{id}`.


## Habits

Every habit carries `schedules` (`[{from, targetValue, targetType,
frequency}]`, oldest first); the last one is the current schedule.
`targetType` is `at_least` or, for a limit, `at_most` (see
[DATAMODEL.md](DATAMODEL.md#targets-and-limits)). In `frequency`,
`timesAtMost` makes `timesPerWeek` or `timesPerMonth` an exact number
("Exactly" in the editor) instead of a minimum (see
[DATAMODEL.md](DATAMODEL.md#frequencies)). The client describes
the target of a day from them. `PATCH /api/habits/{id}` accepts `targetValue`,
`targetType` and `frequency` to change the current schedule.

`POST /api/habits` and `PATCH /api/habits/{id}` take the same body
(`domain.HabitEdit`); a field left out stays as it is. Creating needs `name`,
`kind` and `frequency`; the target defaults to 1, and the first schedule
starts today. Editing may repeat the `kind`, but not change it. Values are in stored units (see
[DATAMODEL.md](DATAMODEL.md#kinds)):

```json
{"name": "Drink water", "color": "sky", "icon": "droplet", "kind": "count",
 "categoryId": "", "stepValue": 10, "unit": "glasses",
 "targetValue": 80, "targetType": "at_least",
 "frequency": {"kind": "weekdays", "weekdays": 31, "weekInterval": 1,
               "weekOfMonth": 0, "anchorDate": "", "timesPerWeek": 0,
               "timesPerMonth": 0, "timesAtMost": false, "intervalDays": 0}}
```

`categoryId: ""` and `icon: ""` remove the category and the icon.
`weekdays` is a bitmask (bit 0 = Monday), `weekOfMonth` 1 to 4, -1 for the
last, or 0 for every occurrence. `retroactive` only matters when editing;
`archived` archives or reactivates. Creating answers 201, editing 200, both
with the habit as
`GET /api/habits/{id}` sends it.

`POST /api/habits/reorder` and `POST /api/categories/reorder` take
`{"ids": ["…"]}` and answer 204.

Each habit also carries the status of each day as `days`, one character per
day from `daysFrom` up to one year ahead (see
[DATAFLOW.md](DATAFLOW.md#day-statuses)), the values of its days as `entries`
(keyed by date), its streak runs as `streakRuns` and the first day of its
history as `historyStart`. The full view of `GET /api/habits/{id}` covers
every year of the history from its 1 January, as the detail view shows whole
years.

Each habit's `stats` hold its streaks, the completion rate over the days of
the `rateWindow` setting, the total and `lastDone`, the latest complete day.

## Entries

`PUT …/entries/{date}` changes a day's entry. The body sets `value`,
`skipped` or both; a field left out stays as it is. A value ends a skip, and
`skipped: true` clears the value. Instead, `add` raises the stored value by a
step, up to the kind's maximum, and ends a skip; a tap sends it, so taps on
two devices both count. A body with none of them is 422 `entry_change_empty`,
a value above 0 with `skipped: true` is 422 `skipped_with_value`, and an
`add` below 1 or with another field is 422 `entry_add_invalid`:

```json
{"value": 30}
{"skipped": true}
{"add": 10}
```

The answer is the habit with its full history, as `GET /api/habits/{id}`
sends it: an entry before the history's start moves it, which can change the
status of other days too.

## Categories

`POST /api/categories` and `PATCH /api/categories/{id}` take
`domain.CategoryEdit`; a field left out stays as it is, and creating needs a
`name`:

```json
{"name": "Health", "icon": "heart", "color": "red", "showProgress": true}
```

`icon: ""` removes the icon, `color: ""` resets it to the default colour.
Creating answers 201, editing 200, both with the category.

## Settings

`GET /api/settings` answers with all settings (see
[USAGE.md](USAGE.md#settings)). `PATCH /api/settings` takes the settings to
change, e.g. `{"theme": "dark"}`, and answers with all of them. An unknown
setting or a value of the wrong type is 400 `invalid_body`, an invalid value
422.

## Export and import

`GET /api/export` sends a file named `habits-YYYY-MM-DD.json`, and
`POST /api/import` takes the same document:

```json
{"format": "habits", "version": 2, "exportedAt": "2026-10-01T08:00:00Z",
 "categories": [{"key": "…", "name": "Health", "icon": "heart",
                 "color": "red", "showProgress": true}],
 "habits": [{"name": "Drink water", "color": "sky", "icon": "droplet",
             "kind": "count", "category": "…", "stepValue": 10,
             "unit": "glasses", "archived": false,
             "createdAt": "2026-01-01T07:00:00Z",
             "schedules": [{"from": "2026-01-01", "targetValue": 80,
                            "targetType": "at_least", "frequency": {…}}],
             "entries": {"2026-01-01": 80}, "skipped": ["2026-01-02"]}]}
```

`key` identifies a category within the file, and a habit's `category` refers
to it (`""` for none). `entries` holds the value of each day with one,
`skipped` the skipped days; values are in stored units. Their dates are
bounded like recorded ones (422 `entry_too_early`, `entry_too_far_ahead`), and
so is the `from` of each schedule (422 `schedule_start_out_of_range`), as the
first one starts the history, and the date of `createdAt` (422
`created_out_of_range`); a missing `createdAt` becomes the time of the
import. A file of another
`format` or `version` is 422 `import_format`. The import answers with the
numbers of `habits` and `categories` added and of the habits `skipped`, as
one of that name exists.

## Skipping days

`POST /api/skips` skips a range of days, e.g. a holiday:

```json
{"from": "2026-10-01", "to": "2026-10-14", "habitIds": ["…"]}
```

Without `habitIds`, it covers all habits that are not archived. Only due days
without a value and not yet skipped change (`domain.DaysToSkip`). The answer
counts them as `skipped`; undo takes them back as one step.

## Undo

A write that can be undone names its undo step in the header `Change-Id`.
`POST /api/undo` with `{"id": 12}` undoes that step, with `{}` the latest;
`POST /api/redo` works alike. Both answer with the step:

```json
{"id": 12, "label": "\"{name}\" deleted", "params": {"name": "Read"}}
```

`label` is an English template the client translates like its own texts,
`params` its values; a `date` is an ISO date. Nothing to undo is 404
`nothing_to_undo`. A step whose data was changed since (e.g. on another
device) is dropped: 409 `changed_since`. Reordering and settings are not undo
steps. See [DATAFLOW.md](DATAFLOW.md#undo).

## Statistics

`GET /api/days?year=2026` answers with `totals`, the habits due and done on
each day of the year (`{date, due, done, bonus}`; `bonus` counts the habits
done beyond what their week or month needs, which are not due), and `stats`
over the days up to today: perfect days (`perfect` of `counted`), the current and best run of
them, the average share per day, completed habits, days without progress,
a group per weekday (Monday first) and per month from `firstMonth` on
(`{rate, perfect}`, `rate` null without due habits), and the best weekday
(0 = Monday, -1 for none) and month (1 = January, 0 for none). It also
counts the `habits` and adds up the `expected` and `achieved` of their
completion rates. `?category={id}` limits all of it to the habits of that
category; the category view shows this year's.

`GET /api/habits/{id}/totals?year=2026&grain=week` answers with `buckets`
(`{start, sum, cumulative}`) from 1 January up to today, the `total`, the
`best` day and the number of `activeDays`.
