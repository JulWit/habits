# Data flow

The server owns all rules and computes everything derived from the data:
the status of each day, statistics, streaks and totals. The client shows what
it is sent and writes changes back; it never judges a day or counts anything
beyond what it displays.

```
browser                                      server
───────                                      ──────
loader.js ─load──> api.js ── GET /api/state ──> httpapi ── View ──> store (SQLite)
                     │                             │
state.js, reactive <─┘                          domain (schedules, statuses,
  │                                              streaks, statistics)
  └─> Vue components (board-view.js, habit-view.js …) render again

tap ─> actions.js ─> state.js (shown as pending)
            │
            └─> api.js ── PUT …/entries/{date} ──> httpapi ── Update ──> store
                  │                                                   └─ undo step
                  └─ no connection ─> outbox.js (localStorage)
```

## Request path on the server

Every request passes through panic recovery, request logging and security
headers (CSP, `nosniff`, `no-referrer`). `/healthz` is answered before
authentication; everything else goes through `authenticate` in
`internal/httpapi/server.go`, which identifies the user with `auth.Resolve`
(single-user or trusted headers) before routing to the handlers, and answers
a refused request like any other error.

A handler works in one transaction of the user: `store.View` for reading,
`store.Update` for changing. Within it, the handler loads the user's settings
once (`basis`: today in their time zone and the completion rate's window),
reads what it needs, checks the change with `internal/domain` and writes it.
Nothing another request changes in between can slip through between check and
write.

## Loading the state

On start, `loader.js` requests `/api/state` with the last 200 days of entries
and keeps it in `state.js`. The state is reactive: the Vue components read it
and render again when it changes. The detail view loads a habit's full
history via `/api/habits/{id}`; `?from=` loads older entries for the board.
The state also carries what the client offers to choose from: the colours,
icons and kinds, and the choices of the enumerated settings (`options`).

Statistics cover a habit's whole history, so the server loads all entries
and computes them on every request (`computeHistory` in
`internal/httpapi/handlers_habits.go`); only the window's entries are sent.
Nothing is cached, so no write can leave the statistics stale.

The time zone is resolved on the server, which sends `today`, so all devices
of a user agree on the current day. It also sends `nextDayIn`, the time
until that day ends, and the client reloads the state then, so a board left
open over midnight moves on to the new day. When the page becomes visible
again, the client reloads the state if the day has changed or it was loaded
more than 10 seconds before, e.g. to show changes made on another device.
A device asleep at midnight delays the timer; that reload covers it.

## Day statuses

Each habit carries the status of every day as `days`, one character per day
from `daysFrom` up to one year ahead (`domain.DayStatus`):

| | |
|---|---|
| `-` | not due |
| `+` | not due, but the value meets the target |
| `o` | due and open (nothing yet, or below the target, or ahead) |
| `c` | due and complete |
| `x` | due, up to today, over its limit |
| `s` | skipped |
| `f` | not due, as its week or month has enough completed days, but can be completed as a bonus |
| `b` | done as a bonus beyond what its week or month needs; not due |

The client reads them in `habit-helpers.js` (`statusOn`, `isDue`, `isDone`,
…) and draws each day from its status and value. The frequency rules, targets,
limits and the history's start exist only in `internal/domain`, so a new rule
needs no client change beyond the editor.

The views that summarise many days load what they show from the server when
they open: the day statistics (`/api/days`), also of a category's habits
(`/api/days?category=`), and a habit's totals per day, week or month
(`/api/habits/{id}/totals`). `remote-stats.js` keeps the last answer and loads
it again once the state has changed. A hidden view renders nothing, so it
loads nothing either.

## Writing an entry

A tap or the day dialog is handled in `actions.js`:

1. The new value (or skip) is shown at once as pending (`showPending` in
   `state.js`): the cell shows the value with a dashed outline, as only the
   server knows whether it completes the day. Writes to the same day wait for
   each other, so they reach the server in order.
2. `api.js` sends `PUT /api/habits/{id}/entries/{date}` with the changed
   parts only.
3. The answer is the habit with its full history: the statuses of all days,
   the statistics and the streak runs (`applyEntryAnswer`).

If the server rejects a write, the client drops the pending value, shows the
error and reloads the state.

The state replaces a habit object on every change instead of changing it in
place, so the board, which memoises its rows by their habit (`v-memo`), only
renders the rows of the habits that changed.

## Other changes

Every other change also goes through `actions.js`, but nothing is shown
before the server has answered, and nothing waits in the outbox:

- **Habits and categories**: the editor sends its input and stays open until
  the answer arrives; an error is shown in the dialog. The answer is the
  saved habit (with its full history) or category, which replaces the one in
  the state (`upsertHabit`, `upsertCategory`). Deleting removes it from the
  state once the server has confirmed it.
- **Skipping days, undo and import**: they can change many habits at once,
  so the client reloads the state afterwards.
- **Order and settings**: the new order or setting is shown at once and put
  back if the server rejects it. A change of the time zone or of the
  completion rate's window reloads the state, as it changes the statuses and
  statistics.

A change that can be undone is offered for undo in a toast (see
[Undo](#undo)).

## Undo

The server keeps the undo steps (`internal/store/changes.go`). An `Update`
that calls `tx.Record(label, params…)` stores the rows it replaced and wrote.
The answer names the step in the `Change-Id` header; `api.js` adds it to the
answer as `changeId`, and the toast offers to undo that step
(`offerUndo` in `undo.js`). `Ctrl+Z` and `Ctrl+Y` undo the latest step and
redo the one undone last.

Undoing writes the replaced rows back, redoing the written ones, but only
where the rows still hold what the step left there, column by column: a
change made since, e.g. on another device, is never overwritten. Such a step
is dropped (409 `changed_since`). Rows that go along with a removed one are
kept as well: undoing the creation of a habit takes the entries recorded since
with it, and redoing it brings them back. A new step drops the undone ones;
the latest 100 steps per user are kept, for 30 days.

Deleting a habit or a category removes it; undo brings it back with its
history, or puts a category's habits back into it.

## Offline

The service worker (`sw.js`) caches the app shell, and the client keeps the
last loaded state in `localStorage`, so the app starts without a connection.

Writes of a value that cannot reach the server wait in an outbox
(`outbox.js`); a skip needs a connection. They are laid over every loaded
state as pending writes, so they stay visible, and are sent once the
connection is back: on the `online` event, when the page becomes visible, and
every 30 seconds. A write sets an absolute value, so for each day the last
one wins. Writes the server rejects are dropped with a message. The header
shows how many changes are waiting. Undo needs a connection.

The same happens when the session at the reverse proxy has expired: the proxy
refuses the request (401, 403), redirects to its login page or serves it. The
client does not follow redirects of API requests (`redirect: "manual"`), since
a redirect to a login page on another origin would fail like a lost
connection. The writes wait until the page is reloaded and the user has
signed in again.

Other changes (habits, categories, settings) still need a connection.
