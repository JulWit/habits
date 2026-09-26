# Habits

A habit tracker as **a single file**: HTTP server, frontend and SQLite driver
are all compiled into the binary. At runtime the only thing that appears is the
database file.

The layout follows [Loop Habit Tracker](https://github.com/isoron/uhabits):
one row per habit, one column per day, today on the far right.

## Building

```bash
go mod tidy
go build -o habits .
```

Needs Go 1.26 or newer — that is the floor `modernc.org/libc` brings with it.
Tests run without any preparation at all:

```bash
go test ./...
```

For them `internal/store` creates a real SQLite file in the temp directory and
plays in every migration; because the driver is pure Go, that needs no toolchain
either.

The result is statically linked — the SQLite driver is
[`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite), a pure Go port
without cgo. That is why cross-compiling works without a C toolchain too:

```bash
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-amd64 .
GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-arm64 .
```

`-trimpath` strips local paths out of the binary, `-s -w` the debug symbols
(saving about a third of its size).

## Running

```bash
./habits
```

It then runs on <http://localhost:8080> in `single-user` mode — without
authentication, all data belonging to the user `local`. That is the development
mode.

## Configuration

Everything through environment variables, so no configuration file has to sit
next to the binary.

| Variable | Default | Meaning |
|---|---|---|
| `HABITS_ADDR` | `:8080` | Listen address |
| `HABITS_DB` | `habits.db` | Path to the SQLite file |
| `HABITS_TZ` | `Local` | Time zone that decides what "today" is (e.g. `Europe/Berlin`) |
| `HABITS_AUTH_MODE` | `single-user` | `single-user` or `authelia` |
| `HABITS_DEFAULT_USER` | `local` | User in `single-user` mode |
| `HABITS_TRUSTED_PROXIES` | — | **Required** in `authelia` mode: comma-separated list of IPs/CIDRs |
| `HABITS_USER_HEADER` | `Remote-User` | Header carrying the user identifier |
| `HABITS_NAME_HEADER` | `Remote-Name` | Display name (optional) |
| `HABITS_EMAIL_HEADER` | `Remote-Email` | Email (optional) |
| `HABITS_GROUPS_HEADER` | `Remote-Groups` | Groups (optional) |

`HABITS_TZ` is deliberately server-side: a self-hosted instance should have
exactly one idea of which day is currently running.

## Container

Every push to `main` builds an image for `linux/amd64` and `linux/arm64` and
puts it in the GitHub Container Registry:

```bash
docker pull ghcr.io/julwit/habits:latest
```

The package inherits the repository's visibility. While that is private,
pulling needs a login too; a token with `read:packages` is enough.

The image is `FROM scratch`: the binary and an empty `/data`, nothing else. No
shell, no package manager — `docker exec` has nothing to do in there, and a
`HEALTHCHECK` in the Dockerfile would have no executable to run. `/healthz`
still answers the question, just from the outside.

The image sets no `USER`, so the process runs as root and writes to `/data`
whatever that directory belongs to. To run it as somebody else, set `user:` in
the compose file (or `--user`) — the directory has to be writable for that UID
then, which with a bind mount to the host means a `chown` of your own.

```yaml
services:
  habits:
    image: ghcr.io/julwit/habits:latest
    environment:
      HABITS_TZ: Europe/Berlin
      HABITS_AUTH_MODE: authelia
      HABITS_TRUSTED_PROXIES: 172.18.0.0/16
    volumes:
      - habits-data:/data
    networks: [proxy]

volumes:
  habits-data:
```

Deliberately without `ports:` — see the next section: header auth does not
survive a directly reachable port.

## Authelia

The application has **no accounts of its own**. It reads the identity from the
`Remote-User` header the reverse proxy sets after Authelia's `/api/verify` has
confirmed the request. Every user sees only their own habits; the identifier is
stored lower-cased so that `Alice` and `alice` do not end up as two separate
sets of data.

> **Important:** header auth is only as secure as the network path. Anyone who
> can reach the port directly could otherwise pass themselves off as any user
> with `Remote-User: admin`. That is why `authelia` mode only starts with
> `HABITS_TRUSTED_PROXIES` set, and requests from other peers are refused with
> 403. On top of that the port should only be reachable on the internal network
> (Docker: no `ports:` mapping, just a shared network).

Example for Traefik:

```yaml
labels:
  - "traefik.http.routers.habits.rule=Host(`habits.example.com`)"
  - "traefik.http.routers.habits.middlewares=authelia@docker"
  - "traefik.http.services.habits.loadbalancer.server.port=8080"
```

Example for Caddy:

```caddyfile
habits.example.com {
    forward_auth authelia:9091 {
        uri /api/verify?rd=https://auth.example.com
        copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
    }
    reverse_proxy habits:8080
}
```

And to go with it:

```bash
HABITS_AUTH_MODE=authelia
HABITS_TRUSTED_PROXIES=172.18.0.0/16
HABITS_TZ=Europe/Berlin
HABITS_DB=/data/habits.db
```

`/healthz` sits outside the authentication, so a container health check manages
without identity headers.

## Using it

| Action | How |
|---|---|
| Tick off | Tap the day |
| Increase count/time/distance | Tapping adds one step (time: 5 min, distance: 500 m), back to 0 once past the target |
| Set an exact value | Long press or right-click |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, or the "Undo" button in the toast |
| New habit | `N` |
| Find a habit or category | Magnifier in the header, `/` or `Ctrl+K`; arrow keys and `Enter` open a result |
| Settings | Cog in the header |
| Theme, days in the overview, archive | all in the settings dialog |
| Assign or create a category | The "Category" field in the habit editor |
| Rename a category, set its icon, delete it | "Edit" and "Delete" on the category screen (click the block heading) |
| Close the detail view | `Esc` |
| Read a day in the year view | Hover over the square |

Deleted habits are only marked as deleted for 30 days. Only after that does
starting the binary clear them away for good — until then "Undo" brings them
back with their entire history.

## Data model

**Categories** — habits can be grouped into categories; the overview draws its
own block per category. A habit without a category lands in the "No category"
block. If there is no category at all, the board is a single block without
headings.

Categories — like habits — are only marked as deleted. Their habits keep their
assignment while that happens and merely slip into the "No category" block. An
"Undo" therefore restores the block exactly as it was, without touching a single
habit.

**Frequencies** — `daily`, `times_per_week` (x times per week, the week starting
on Monday), `weekdays` (bitmask, bit 0 = Monday), `every_n_days` (interval plus
anchor date, so that an edit does not shift the phase).

**Kinds** — `check` (a tick), `count` (a count, e.g. 8 glasses), `time` (time in
minutes) and `distance` (distance in metres). Internally every entry is one
integer per day; "done" means `value >= target`. A day without an entry has *no*
row in `entries` at all, rather than a row holding the value 0 — so no analysis
has to tell "not recorded" apart from "recorded as 0".

**Streaks** — a today that is still open does not break a streak. With
`times_per_week` the streak counts in weeks rather than days, because there it is
the week and not the individual day that is the target.

**Streak colours** — the board paints a completed day by how long the run it
belongs to had been going *by that day*, so a row shows a streak building up and
starting over. Six levels, and each one leaves less of the habit's own colour
over a spectrum underneath: one week, two weeks, a month, three months, six
months, a year — at a year the circle is the full rainbow.

The levels are measured in calendar days rather than in the days a habit is due
on, so a Mon–Fri habit reaches "a week" after a week rather than after seven of
its own days. The server sends the runs behind this as `streakRuns` per habit
(`domain.StreakRuns`), each with its true first day even when that day is older
than the shipped history; how a run is then coloured is the client's business
and lives in `habit.js` next to `heatLevel`.

## API

All endpoints live under `/api` and answer with JSON.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Complete state for a cold start (one request); follows the `showArchived` setting, `?archived=0`/`1` overrides it |
| `POST` | `/api/habits` | Create |
| `GET` | `/api/habits/{id}` | A single habit with its **full** history |
| `PATCH` | `/api/habits/{id}` | Change (only the fields sent) |
| `DELETE` | `/api/habits/{id}` | Soft delete |
| `POST` | `/api/habits/{id}/restore` | Undo a soft delete |
| `POST` | `/api/habits/reorder` | Set the order |
| `PUT` | `/api/habits/{id}/entries/{date}` | Set a day's value |
| `POST` | `/api/categories` | Create a category |
| `PATCH` | `/api/categories/{id}` | Rename, set the icon |
| `DELETE` | `/api/categories/{id}` | Soft delete |
| `POST` | `/api/categories/{id}/restore` | Undo a soft delete |
| `POST` | `/api/categories/reorder` | Set the order |
| `GET`/`PATCH` | `/api/settings` | Settings, see below |
| `GET` | `/api/background` | Serve the background image (404 if none is stored) |
| `PUT` | `/api/background` | Upload an image (raw body, JPEG or PNG, at most 12 MB) |
| `DELETE` | `/api/background` | Remove the image |

Every writing endpoint demands `Content-Type: application/json`. That is not
mere formality: without this condition a `POST` would be reachable from a
foreign page, because a form is allowed to send `text/plain` and such a body can
be valid JSON. With the condition the browser has to send a preflight first,
which the same-origin policy refuses.

Alongside the habits, `/api/state` also delivers the tables the client needs in
order to read a stored value: `colors` (the palette) and `kinds` (per kind
`scale`, `step`, `max`, `unit`). They are sent rather than written out a second
time in JavaScript — these numbers decide whether 5000 means five kilometres or
five hundred repetitions, and a second copy could drift apart without anything
breaking.

`icons` names the icons a habit or a category may wear (`domain.HabitIcons`); the server
validates every `icon` against it, and `""` means none. A category's icon is drawn
in neutral ink, since categories have no colour of their own. Only the names live
on the server — the drawings are in `web/assets/js/icons.js` (`habitIcons`), and
a name without a drawing there is simply not offered.

`PUT …/entries/{date}` returns the value it overwrote in the `previous` field.
That is exactly what the frontend builds its undo stack out of: undoing simply
means writing `previous` back. Which is why undo works without any local
persistence.

## Structure

```
main.go                     Startup, signal handling, //go:embed of the frontend
internal/config             Configuration from the environment
internal/auth               Authelia forward auth as middleware
internal/domain             Habits, frequencies, streaks — without I/O
internal/store              SQLite: schema, migrations, queries
internal/httpapi            Routing, JSON, serving the frontend
web/                        Frontend (ES modules, no build step)
  assets/css/                 Stylesheets: tokens, components, forms, @font-face
  assets/fonts/               Self-hosted woff2 files and their licences
  assets/images/              App icon as SVG and the manifest's PNG sizes
  assets/js/overview.js       Board: blocks per category, shared day header
  assets/js/cells.js          Habit row and day cell
  assets/js/actions.js        All mutations, each with its undo step
  assets/js/icons.js          Inline SVG icons for buttons
  assets/js/categorypicker.js Nested dialog for choosing a category
  assets/js/categoryeditor.js Edit dialog for a category: name and icon
  assets/js/settings.js       Settings dialog, writes every change immediately
```

`internal/domain` knows neither database nor HTTP. The rules — when a habit is
due, when a day counts as done, how a streak counts — live there and are
testable without a server. That is not a statement of intent: `stats_test.go`,
`habit_test.go` and `date_test.go` test them exactly like that, without a
database and without a network.

The frontend is deliberately built without a build step: native ES modules, no
npm, no bundler. `go build` thereby stays the only command needed for a release.

## Extending

**A new migration** — append another string to `migrations` in
`internal/store/store.go`. Never change entries that have already shipped;
`PRAGMA user_version` tracks where things stand.

**A new field on a habit** — the field in `domain.Habit` and its `Validate()`, a
column by migration, reading/writing in `internal/store/habits.go`, an optional
pointer in `habitInput` (`internal/httpapi/handlers_habits.go`), an input in
`web/assets/js/editor.js`. And finally in `writableFields()` in
`web/assets/js/actions.js`: PATCH reads a missing field as "unchanged", so a field
forgotten there is not taken back by its own undo.

**A new habit kind** — add it to `AllKinds` in `internal/domain/habit.go` and
serve the four methods `Scale`, `Step`, `MaxTarget`, `Unit`. The client gets
that through `kinds` in `/api/state` and needs no table of its own; in the
editor only the input fields are added.

**A new tool (kanban, pomodoro, to-do)** — as its own `internal/<tool>` with its
own domain package and its own tables. What is shared is the infrastructure:
`config`, `auth`, the store connection, the routing and the CSS tokens in
`web/assets/css/base.css`.

**Undo for a new action** — carry the action out in `web/assets/js/actions.js` and
then call `record({label, undo, redo})`. `undo` and `redo` are server calls, not
local state changes; that is why the history stays correct even when a second
device is writing in parallel.


**History and reloading** — `/api/state` delivers only the last 200 days of
entries per habit; that is enough for the board and keeps the response small.
The detail view draws a whole calendar year and therefore fetches the full
history once through `/api/habits/{id}` when it opens. Streaks and the best
streak are computed by the server over everything anyway.

## Settings

The cog in the header opens the settings dialog. It is split into tabs; all the
values live server-side, per user.

| Key | Values | Meaning |
|---|---|---|
| `theme` | `system`, `light`, `dark` | Appearance; `system` follows the device |
| `font` | `system`, `inter`, `roboto`, `geist`, `opensans`, `montserrat`, `poppins`, `lato` | Typeface, all of them in the binary |
| `density` | `compact`, `standard`, `comfortable` | Spacing inside and around every element, line height and weight of emphasis |
| `overviewDays` | 0 = automatic, otherwise 3–90 | Day columns on the board |
| `alignWeeks` | bool | Align the board to whole calendar weeks |
| `showArchived` | bool | Show archived habits |
| `reorderMode` | `drag`, `buttons` | Dragging by the handle, or arrows per entry |
| `pattern` | `none`, `dots`, `grid`, `diagonal`, `cross`, `image` | Texture behind the page; `image` is the uploaded picture |
| `bandColor` | `neutral` or a habit colour | Colouring of the today column |
| `bandOpacity` | 0–100 | How strongly that marker is drawn |
| `bandFillOpacity` | 0–100 | How strongly the band through the cards is drawn, independent of `bandOpacity` |
| `backgroundDim` | 0–100 | Dimming of the uploaded image |
| `backgroundBlur` | 0–100 | Blurring of the same |
| `surfaceOpacity` | 20–100 | Opacity of the cards over an image |
| `surfaceBlur` | 0–100 | How softly they let it show through |

The number of days: **Automatic** fills the available width, otherwise you pick
a fixed number. A week is the least the board shows: where seven columns do
not fit at the usual sizes, it narrows the day columns and the name column,
hides the habit icons and steps the type down until they do (`data-tight`, set
in `overview.js`). A fixed number below seven is kept as chosen. The chosen number is an upper bound, not a guarantee — 28
columns do not fit on a phone. The dialog therefore always names the number
actually being shown and explains the difference, rather than silently clipping
the board.

With a fixed number the board shrinks to exactly those columns and stays centred
in the window while it does. In "Automatic" mode it fills the width and the name
column takes up the rest — that is the difference between "as many as possible"
and "exactly this many".

All settings live server-side per user and therefore apply on every device.
Every change is written immediately; there is no save button, because the
settings are independent of one another.

## Known limits

- The SQLite pool is limited to **one** connection. For a personal tracker that
  is the simplest correct choice; should read throughput ever become an issue,
  the answer would be a second, read-only pool — not a larger shared one.
- The due-date logic exists twice, in `internal/domain/habit.go` and in
  `web/assets/js/habit.js` — the server needs it for validation, the client in
  order to draw a whole grid without a round trip. Changes to frequency rules
  have to be made in both places. The *numbers* per kind (scale, step size,
  ceiling), on the other hand, are no longer duplicated: they arrive as `kinds`
  with `/api/state`.
- The lists of fonts, densities and patterns appear in `internal/store/settings.go`, in
  `web/assets/js/app.js` and in the `<option>` elements of `index.html`. A drift
  here only falls back to the default rather than reading data incorrectly —
  which is why it has been left as it is so far.
- A habit's kind can no longer be changed once days have been recorded. Every
  kind stores one integer per day, but not the same one: 5000 is either five
  kilometres or five hundred repetitions. There is no honest conversion, so the
  change is refused rather than silently reinterpreting the history. Without
  entries it stays possible — and that is when it is actually needed.
- The detail view always draws the *current* calendar year. Earlier years are
  not reachable through the interface.
