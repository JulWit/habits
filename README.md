# Habits

A self-hosted habit tracker in a single binary: HTTP server, frontend and SQLite
driver are compiled in. At runtime it only creates its database file.

The layout follows [Loop Habit Tracker](https://github.com/isoron/uhabits): one
row per habit, one column per day, today on the right.

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
docker run -p 8080:8080 -v habits-data:/data ghcr.io/julwit/habits:latest
```

For multiple users, run it behind a reverse proxy in `trusted-header` mode;
see [Deployment](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [BUILDING.md](docs/BUILDING.md) | Building, tests, cross-compiling, version stamping |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, container image, authentication through a reverse proxy |
| [USAGE.md](docs/USAGE.md) | Controls, shortcuts, active day, settings |
| [DATAMODEL.md](docs/DATAMODEL.md) | Categories, kinds, frequencies, schedules, streaks, database schema |
| [API.md](docs/API.md) | HTTP endpoints, error format, state contents |
| [DATAFLOW.md](docs/DATAFLOW.md) | How data moves between client and server, undo, offline outbox |
| [STRUCTURE.md](docs/STRUCTURE.md) | Code layout of the Go packages and the frontend |
| [EXTENDING.md](docs/EXTENDING.md) | Adding migrations, fields, kinds, languages, settings |

## Known limitations

- The SQLite pool uses a single connection. If read throughput becomes an
  issue, add a separate read-only pool.
- Changing the kind to check keeps only whether each day was completed; the
  recorded values are lost, so undoing it gives completed days their target.
- The detail view only shows the current calendar year.
