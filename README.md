# Habits

A self-hosted habit tracker in a single binary: HTTP server, frontend and SQLite
driver are compiled in. At runtime it only creates its database file.

The layout follows [Loop Habit Tracker](https://github.com/isoron/uhabits): one
row per habit, one column per day, today on the right.

## Building

Requires Go 1.26 or newer (the minimum of `modernc.org/libc`).

```bash
go mod tidy
go build -o habits .
```

Run the tests (they use a temporary SQLite file and need no setup):

```bash
go test ./...
```

The SQLite driver [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite)
is pure Go, so the binary is statically linked and cross-compiles without a C
toolchain:

```bash
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-amd64 .
GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-arm64 .
```

`-trimpath` removes local paths, `-s -w` removes debug symbols (about a third
of the size).

The version page in the settings shows the commit and time `go build` stamps
from a Git checkout. A release version is set at link time, as the image
workflow does through the Dockerfile's `VERSION`, `REVISION` and `BUILD_TIME`
arguments:

```bash
go build -ldflags="-X github.com/JulWit/habits/internal/httpapi.Version=1.2.3" -o habits .
```

## Running

```bash
./habits
```

The app listens on <http://localhost:8080> in `single-user` mode: no
authentication, all data belongs to the user `local`.

## Configuration

All configuration is done through environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `HABITS_ADDR` | `:8080` | Listen address |
| `HABITS_DB` | `habits.db` | Path to the SQLite file |
| `HABITS_TZ` | `Local` | Default time zone for "today" (e.g. `Europe/Berlin`); users can override it in the settings |
| `HABITS_AUTH_MODE` | `single-user` | `single-user` or `authelia` |
| `HABITS_DEFAULT_USER` | `local` | User in `single-user` mode |
| `HABITS_TRUSTED_PROXIES` | — | **Required** in `authelia` mode: comma-separated IPs/CIDRs |
| `HABITS_USER_HEADER` | `Remote-User` | Header with the user ID |
| `HABITS_NAME_HEADER` | `Remote-Name` | Display name (optional) |
| `HABITS_EMAIL_HEADER` | `Remote-Email` | Email (optional) |
| `HABITS_GROUPS_HEADER` | `Remote-Groups` | Groups (optional) |

The time zone is resolved on the server, so all devices of a user agree on the
current day.

## Container

Every push to `main` builds an image for `linux/amd64` and `linux/arm64` and
publishes it to the GitHub Container Registry:

```bash
docker pull ghcr.io/julwit/habits:latest
```

The package has the repository's visibility; for a private repository, pulling
requires a token with `read:packages`.

The image is `FROM scratch` and contains only the binary and an empty `/data`
directory. There is no shell, so there is no `HEALTHCHECK`; use `/healthz` from
outside instead.

The image sets no `USER` and runs as root. To run as another user, set `user:`
in the compose file (or `--user`) and make `/data` writable for that UID.

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

There is no `ports:` mapping on purpose, see the next section.

## Authelia

The app has no user accounts. In `authelia` mode it reads the user from the
`Remote-User` header set by the reverse proxy after Authelia's `/api/verify`.
Each user only sees their own data. User IDs are stored in lower case, so
`Alice` and `alice` are the same user.

> **Important:** Anyone who can reach the port directly can send any
> `Remote-User` header. Therefore `authelia` mode requires
> `HABITS_TRUSTED_PROXIES` and answers requests from other peers with 403. Only
> expose the port on the internal network (Docker: no `ports:` mapping, only a
> shared network).

Traefik:

```yaml
labels:
  - "traefik.http.routers.habits.rule=Host(`habits.example.com`)"
  - "traefik.http.routers.habits.middlewares=authelia@docker"
  - "traefik.http.services.habits.loadbalancer.server.port=8080"
```

Caddy:

```caddyfile
habits.example.com {
    forward_auth authelia:9091 {
        uri /api/verify?rd=https://auth.example.com
        copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
    }
    reverse_proxy habits:8080
}
```

Environment for either:

```bash
HABITS_AUTH_MODE=authelia
HABITS_TRUSTED_PROXIES=172.18.0.0/16
HABITS_TZ=Europe/Berlin
HABITS_DB=/data/habits.db
```

`/healthz` requires no authentication.

## Usage

| Action | How |
|---|---|
| Tick off | Tap the day; tap again to undo |
| Increase count/time/distance | Tap: adds one step (default: count 1, time 5 min, distance 500 m; configurable per habit), also beyond the target |
| Set an exact value | Long press or right-click |
| Clear a value | Long press or right-click, then "Delete" or 0 |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or "Undo" in the toast |
| Select a day | Click the day in the day header; click today to go back |
| Back to today | Floating button at the bottom of the screen |
| Show only open habits | Filter in the header |
| New habit | `N` |
| Search habits and categories | Magnifier in the header, `/` or `Ctrl+K` |
| Settings | Gear in the header |
| Assign or create a category | "Category" field in the habit editor |
| Edit or delete a category | Click the category heading, then "Edit" or "Delete" |
| Close the detail view | `Esc` |

**Active day**: The board has one active day, today by default. The day
marker in the header, the band in the cards, the day summary, the categories'
progress bars and the "only open" filter all refer to it. The filter shows the
habits due on the active day that are not yet complete. While another day is
active, today's date is underlined in the header. The selection is not saved;
it resets to today on reload and with "Back to today". Tapping a cell still
writes to that cell's day, whichever day is active.

Deleted habits and categories can be restored for 30 days. After that, they are
removed permanently on the next start.

## Data model

**Categories** group habits into blocks on the overview. Habits without a
category are shown in a "No category" block; without any categories, the board
is a single block without headings. When a category is deleted, its habits keep
their category ID and appear under "No category" until it is restored.

**Frequencies**

- `daily`
- `times_per_week`: x times per week (weeks start on Monday)
- `weekdays`: selected weekdays (bitmask, bit 0 = Monday), optionally only every
  n-th week from an anchor date, or only the n-th or last occurrence in the
  month
- `custom_interval`: every n days from an anchor date

**Kinds**

- `check`: done or not
- `count`: a number, e.g. 8 glasses
- `time`: minutes
- `distance`: stored in metres, shown in kilometres

Each entry is one integer per day; counts and minutes are stored in tenths. A
day is done when `value >= target`. Days without a value have no row in
`entries`.

**Streaks**: An open today does not break a streak. For `times_per_week`, the
streak counts weeks.

**Streak colours**: A completed day is coloured by how long its run had lasted
on that day: one week, two weeks, a month, three months, six months, a year.
The longer the run, the more of a gradient around the habit colour shows. Run
lengths are in calendar days. The server sends the runs as `streakRuns`
(`domain.StreakRuns`); the colouring is in `habit.js`.

## API

All endpoints are under `/api` and return JSON.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Complete state for the client; `?archived=0`/`1` overrides the `showArchived` setting, `?from=YYYY-MM-DD` loads entries further back |
| `POST` | `/api/habits` | Create a habit |
| `GET` | `/api/habits/{id}` | A habit with its full history |
| `PATCH` | `/api/habits/{id}` | Update the given fields |
| `DELETE` | `/api/habits/{id}` | Soft delete |
| `POST` | `/api/habits/{id}/restore` | Restore |
| `POST` | `/api/habits/reorder` | Set the order; missing habits keep their relative order after the given ones, duplicate IDs are rejected |
| `PUT` | `/api/habits/{id}/entries/{date}` | Set a day's value (from 2000-01-01 to one year ahead; 0 clears and works on any day) |
| `POST` | `/api/categories` | Create a category |
| `PATCH` | `/api/categories/{id}` | Update name, icon, colour or progress display |
| `DELETE` | `/api/categories/{id}` | Soft delete |
| `POST` | `/api/categories/{id}/restore` | Restore |
| `POST` | `/api/categories/reorder` | Set the order (same rules as for habits) |
| `GET`/`PATCH` | `/api/settings` | Settings, see below |
| `GET` | `/api/background` | Background image (404 if none) |
| `PUT` | `/api/background` | Upload an image (raw body, JPEG or PNG, max. 12 MB) |
| `DELETE` | `/api/background` | Remove the image |

Writing endpoints require `Content-Type: application/json`. This forces a CORS
preflight and protects against CSRF.

Errors are returned as `{"error": "..."}` in English. Validation errors also
include the message template and its parameters, which the client uses for
translation:

```json
{"error": "name is longer than 80 characters",
 "message": "name is longer than {max} characters",
 "params": {"max": 80}}
```

New validation messages therefore use `domain.Invalid` with placeholders and
need an entry in `i18n.js`.

`/api/state` also contains:

- `colors`: the colour palette
- `kinds`: `scale`, `step`, `max` and `unit` per kind
- `icons`: valid icon names (`domain.HabitIcons`); `""` means no icon. The
  drawings are in `web/assets/js/icons.js`.

`PUT …/entries/{date}` returns the replaced value as `previous`. Undo writes it
back.

## Structure

```
main.go                     Startup, signal handling, embedded frontend
internal/config             Configuration from environment variables
internal/auth               User identification (single-user or Authelia)
internal/domain             Habits, schedules, streaks, statistics (no I/O)
internal/store              SQLite: schema, migrations, queries
internal/httpapi            Routing, JSON API, frontend delivery
scripts/genicons.go         Generates the PNG app icons
web/                        Frontend (ES modules, no build step)
  index.html                  App shell, rendered as a Go template
  sw.js                       Service worker for offline start
  assets/css/                 Design tokens, components, forms, fonts
  assets/fonts/               Embedded woff2 fonts and their licences
  assets/images/              App icon (SVG and PNG)
  assets/js/app.js            Entry point, routing, appearance, shortcuts
  assets/js/state.js          Client-side state
  assets/js/api.js            API client
  assets/js/actions.js        All data changes with their undo steps
  assets/js/undo.js           Undo/redo and toasts
  assets/js/overview.js       Board with category blocks, day header and active day
  assets/js/cells.js          Habit row and day cell
  assets/js/habit.js          Schedule, value and streak helpers
  assets/js/detail.js         Habit detail view
  assets/js/category.js       Category detail view
  assets/js/editor.js         Habit dialog
  assets/js/categoryeditor.js Category dialog
  assets/js/categorypicker.js Category picker
  assets/js/value.js          Exact value dialog
  assets/js/search.js         Search dialog
  assets/js/settings.js       Settings dialog
  assets/js/i18n.js           Translations and time zone
  assets/js/dates.js          Date helpers
  assets/js/icons.js          Inline SVG icons
  assets/js/reorder.js        Drag and drop reordering
  assets/js/styleguide.js     Style guide at #/styleguide
```

`internal/domain` depends neither on the database nor on HTTP and is tested
without either.

The frontend has no build step (no npm, no bundler); `go build` is all that is
needed for a release.

## Extending

**New migration**: Append a string to `migrations` in
`internal/store/store.go`. Never change released migrations; `PRAGMA
user_version` stores the schema version.

**New habit field**:

1. Field and validation in `domain.Habit`
2. Column via migration
3. Read and write in `internal/store/habits.go`
4. Pointer field in `habitInput` (`internal/httpapi/handlers_habits.go`)
5. Input in `web/assets/js/editor.js`
6. Add it to `writableFields()` in `web/assets/js/actions.js`, otherwise undo
   does not restore it

**New habit kind**: Add it to `AllKinds` in `internal/domain/habit.go` and
handle it in `Scale`, `Step`, `MaxTarget` and `Unit`. The client receives these
values via `kinds`; the editor needs its input fields.

**New language**: A dictionary in `i18n.js`, an entry in `store.Languages`, an
`<option>` in `index.html` and the day and month names in `dates.js`.

**Undo for a new action**: Perform the action in `web/assets/js/actions.js`,
then call `record({label, undo, redo})`. `undo` and `redo` are server calls.

**New tool** (e.g. kanban, pomodoro): A separate `internal/<tool>` package
with its own domain and tables, sharing `config`, `auth`, the store, the
routing and the CSS tokens in `web/assets/css/base.css`.

**Entry history**: `/api/state` contains the last 200 days of entries. The
detail view loads the full history via `/api/habits/{id}`. Statistics are
always computed by the server over the full history.

## Settings

Settings are stored per user on the server and saved immediately.

| Key | Values | Meaning |
|---|---|---|
| `theme` | `system`, `light`, `dark` | Colour scheme; `system` follows the device |
| `font` | `system`, `inter`, `roboto`, `geist`, `opensans`, `montserrat`, `poppins`, `lato` | Font (all embedded) |
| `density` | `compact`, `standard`, `comfortable` | Spacing and font weights |
| `overviewDays` | 0 (automatic) or 3–90 | Day columns on the board |
| `alignWeeks` | bool | Align the board to calendar weeks |
| `showArchived` | bool | Show archived habits |
| `reorderMode` | `drag`, `buttons` | Reorder by drag and drop or with arrow buttons |
| `pattern` | `none`, `dots`, `grid`, `diagonal`, `cross`, `lines`, `checks`, `gradient`, `glow`, `image` | Page background; `image` is the uploaded image |
| `bandColor` | `neutral` or a palette colour | Colour of the day marker and band (on the active day) |
| `bandOpacity` | 0–100 | Opacity of the day marker in the header |
| `bandFillOpacity` | 0–100 | Opacity of the band in the cards |
| `showBand` | bool | Show the band in the cards |
| `backgroundDim` | 0–100 | Dimming of the background image |
| `backgroundBlur` | 0–100 | Blur of the background image |
| `surfaceOpacity` | 20–100 | Opacity of the cards over the image |
| `surfaceBlur` | 0–100 | Blur behind the cards |
| `language` | `system`, `en`, `de` | UI language; `system` uses the browser's `Accept-Language`, falling back to English |
| `timeZone` | `""` or an IANA name | Time zone for "today"; `""` uses `HABITS_TZ` |

**Day columns**: "Automatic" shows as many days as fit. A fixed number is an
upper limit; the dialog shows how many are actually displayed. At least seven
days are shown: if they do not fit, the board is compacted (`data-tight`, set
in `overview.js`). A fixed number below seven is respected.

**Language**: The server sets `<html lang>`; `web/assets/js/i18n.js`
translates using the English text as key (`t("New habit")`). Untranslated
texts are shown in English. Changing the language reloads the page.

**Time zone**: Determines the server's `today`, and thus the last day of the
board, the day a tap writes to and the open day for streaks.

## Known limitations

- The SQLite pool uses a single connection. If read throughput becomes an
  issue, add a separate read-only pool.
- The scheduling logic exists in both `internal/domain/habit.go` and
  `web/assets/js/habit.js`. Changes to frequency rules must be made in both.
- The lists of fonts, densities and patterns exist in
  `internal/store/settings.go`, `web/assets/js/app.js` and `index.html`.
  Unknown values fall back to the default.
- The kind of a habit cannot be changed once it has entries, since stored
  values depend on the kind.
- The detail view only shows the current calendar year.
