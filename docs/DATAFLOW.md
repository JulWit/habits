# Data flow

The server owns all rules; the client renders what it is sent and writes
changes back. Statistics, streaks and due days are always computed by the
server over the full history.

```
browser                                      server
───────                                      ──────
app.js ── load ──> api.js ── GET /api/state ──> httpapi ──> store (SQLite)
                     │                             │
state.js <───────────┘                          domain (schedules,
  │                                              streaks, stats)
  └─> overview.js, cells.js, detail.js … render

tap ─> actions.js ─> state.js (shown at once)
            │
            ├─> api.js ── PUT …/entries/{date} ──> httpapi ──> store
            │     └─ no connection ─> outbox.js (localStorage)
            └─> undo.js (undo/redo steps)
```

## Request path on the server

Every request passes through panic recovery, request logging and security
headers (CSP, `nosniff`, `no-referrer`). `/healthz` is answered before
authentication; everything else goes through `auth.Middleware`, which
identifies the user (single-user or trusted headers) before routing to the
handlers in `internal/httpapi`. Handlers validate input with
`internal/domain` and read and write through `internal/store`.

## Loading the state

On start, the client requests `/api/state` with the last 200 days of entries
and keeps it in `state.js`. The views subscribe to the state and re-render on
changes. The detail view loads a habit's full history via
`/api/habits/{id}`; `?from=` loads older entries for the board.

The time zone is resolved on the server, which sends `today`, so all devices
of a user agree on the current day. It also sends `nextDayIn`, the time
until that day ends, and the client reloads the state then, so a board left
open over midnight moves on to the new day. When the page becomes visible
again, the client reloads the state if the day has changed or it was loaded
more than 10 seconds before, e.g. to show changes made on another device.
A device asleep at midnight delays the timer; that reload covers it.

## Due days

The frequency rules exist only on the server (`domain.Schedule.IsScheduled`).
Each habit carries its due days as `due`, one character per day from `dueFrom`
(`1` due, `0` not), up to one year ahead. The client reads them in
`isScheduled` in `habit.js` and never evaluates a frequency itself, so a new
frequency rule needs no client change beyond the editor.

## Writing an entry

A tap or long press is handled in `actions.js`:

1. The new value is set in `state.js` and shown immediately.
2. `api.js` sends `PUT /api/habits/{id}/entries/{date}`. Writes to the same
   day wait for each other, so they reach the server in order.
3. The answer (with the replaced value as `previous`) updates the state.
4. An undo step is recorded in `undo.js`. Undo and redo write the value back
   with `expect`, so they do not overwrite a change made on another device in
   the meantime; on 409 the undo step is dropped.

If the server rejects a write, the client shows the error and reloads the
state.

Other changes (habits, categories, order, settings) follow the same pattern:
perform the change in `actions.js`, update the state and record the undo step
with `record({label, undo, redo})`.

## Offline

The service worker (`sw.js`) caches the app shell, and the client keeps the
last loaded state in `localStorage`, so the app starts without a connection.

Entry writes that cannot reach the server wait in an outbox (`outbox.js`).
They are laid over every loaded state, so they stay visible, and are sent
once the connection is back: on the `online` event, when the page becomes
visible, and every 30 seconds. A write sets an absolute value, so for each day
the last one wins. Writes the server rejects are dropped with a message. The
header shows how many changes are waiting.

The same happens when the session at the reverse proxy has expired: the proxy
refuses the request (401, 403), redirects to its login page or serves it. The
client does not follow redirects of API requests (`redirect: "manual"`), since
a redirect to a login page on another origin would fail like a lost
connection. The writes wait until the page is reloaded and the user has
signed in again.

Other changes (habits, categories, settings) still need a connection.
