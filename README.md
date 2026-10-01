# Habits

A self-hosted habit tracker in a single binary: HTTP server, frontend and SQLite
driver are compiled in. At runtime it only creates its database file.

The layout follows [Loop Habit Tracker](https://github.com/isoron/uhabits): one
row per habit, one column per day, today on the right.

## Features

- Habits to tick off, or to measure as a count, time or distance, each with
  a daily target or a limit (e.g. at most 2 cups of coffee)
- Daily, x times per week or month, on certain weekdays (also every few
  weeks or the first Monday of the month), or every few days
- Categories, skipped days for illness or holidays, archiving
- Streaks, completion rates, heatmaps and statistics per habit, category and
  day
- Undo and redo kept on the server, shared by all devices
- Installable as an app; starts offline and records values until the
  connection is back
- Several users behind a reverse proxy, export and import, English and German

It is tested in Firefox on desktop and Android and uses no features specific
to one browser engine.

## Quick start

Requires Go 1.26 or newer.

```bash
go build -o habits .
./habits
```

The app listens on <http://localhost:8080> in `single-user` mode: no
authentication, all data belongs to the user `local`.

Or with Docker:

```bash
docker run -p 8080:8080 -v habits-data:/data -e HABITS_TZ=Europe/Berlin ghcr.io/julwit/habits:latest
```

`HABITS_TZ` sets the time zone that decides when a new day begins. The image
has no local time zone, so without it the day changes at midnight UTC; each
user can also choose one in the settings.

For multiple users, run it behind a reverse proxy in `trusted-header` mode;
see [Deployment](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [BUILDING.md](docs/BUILDING.md) | Building, tests, cross-compiling, version stamping |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, container image, authentication through a reverse proxy |
| [USAGE.md](docs/USAGE.md) | Controls, shortcuts, habit editor, views, offline use, settings |
| [DATAMODEL.md](docs/DATAMODEL.md) | Tables with a schema diagram, kinds, frequencies, schedules, streaks |
| [API.md](docs/API.md) | HTTP endpoints, request bodies, error format, state contents, export format |
| [DATAFLOW.md](docs/DATAFLOW.md) | How data moves between client and server, undo, offline outbox |
| [STRUCTURE.md](docs/STRUCTURE.md) | Code layout of the Go packages and the frontend |
| [EXTENDING.md](docs/EXTENDING.md) | Adding migrations, fields, kinds, icons, colours, endpoints, settings |
| [AGENTS.md](AGENTS.md) | Principles, rules and conventions for contributors (people and coding agents) |

## Known limitations

- The SQLite pool uses a single connection. If read throughput becomes an
  issue, add a separate read-only pool.
