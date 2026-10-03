# Deployment

## Configuration

All configuration is done through environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `HABITS_ADDR` | `:8080` | Listen address |
| `HABITS_DB` | `habits.db` | Path to the SQLite file |
| `HABITS_TZ` | `Local` | Default time zone for "today" (e.g. `Europe/Berlin`); users can override it in the settings |
| `HABITS_AUTH_MODE` | `single-user` | `single-user` or `trusted-header` |
| `HABITS_DEFAULT_USER` | `local` | User in `single-user` mode |
| `HABITS_TRUSTED_PROXIES` | — | **Required** in `trusted-header` mode: comma-separated IPs/CIDRs |
| `HABITS_USER_HEADER` | `Remote-User` | Header with the user ID |
| `HABITS_NAME_HEADER` | `Remote-Name` | Display name (optional) |
| `HABITS_EMAIL_HEADER` | `Remote-Email` | Email (optional) |
| `HABITS_ALLOWED_HOSTS` | `localhost` in `single-user` mode, any in `trusted-header` mode | Comma-separated host names the app answers on (e.g. `habits.example.com,nas.local`), or `*` for any; IP addresses are always allowed |

In the default `single-user` mode there is no authentication and all data
belongs to the user `local`.

### Allowed hosts

Without authentication, any page the browser opens could make its own name
resolve to this server's address (DNS rebinding) and then read, export or
delete the data as if it were the app. So the server answers only on the host
names in `HABITS_ALLOWED_HOSTS`, and on IP addresses, which such a page cannot
use as its name; other names get 421 `host_not_allowed`, and the log names
the refused host. `/healthz` answers on any host.

In `single-user` mode only `localhost` is allowed by default. Reaching the app
under another name, e.g. `http://nas.local:8080` or through a reverse proxy at
`https://habits.example.com`, needs that name in the list:

```bash
HABITS_ALLOWED_HOSTS=habits.example.com,nas.local
```

In `trusted-header` mode any host is allowed by default, as the reverse proxy
signs in and routes by host name; setting the variable restricts it all the
same.

The time zone is resolved on the server, so all devices of a user agree on the
current day.

## Commands

Without arguments, the binary runs the server. Its subcommands are
`healthcheck`, `backup PATH` and `move-user FROM TO` (see below);
`habits help` lists them. An unknown subcommand prints the list and exits
with 2 instead of starting the server.

## Container

Every push to `main` runs `gofmt`, `go vet` and the tests, and once they pass
builds an image for `linux/amd64` and `linux/arm64` and publishes it to the
GitHub Container Registry. Pull requests are only tested.

```bash
docker pull ghcr.io/julwit/habits:latest
```

The package has the repository's visibility; for a private repository, pulling
requires a token with `read:packages`.

The image is `FROM scratch` and contains only the binary and an empty `/data`
directory. There is no shell and no curl, so its `HEALTHCHECK` runs
`/habits healthcheck`: the binary asks its own `/healthz` on the loopback
interface and exits with 1 if the answer is not 200. Successful health checks
are not written to the request log, so a check every 30 seconds does not fill
it; a failing one is.

The image runs as UID and GID 65534 (`nobody`), not as root. A named volume
takes over the ownership of the image's `/data`. A bind mount must be
writable for that UID (`chown 65534:65534 /path/to/data`), and so must the
data of an older image that ran as root. To run as another user, set `user:`
in the compose file (or `--user`) and make `/data` writable for that UID.

```yaml
services:
  habits:
    image: ghcr.io/julwit/habits:latest
    environment:
      HABITS_TZ: Europe/Berlin
      HABITS_AUTH_MODE: trusted-header
      HABITS_TRUSTED_PROXIES: 172.18.0.0/16
    volumes:
      - habits-data:/data
    networks: [proxy]

volumes:
  habits-data:
```

There is no `ports:` mapping on purpose, see the next section.

## Authentication through a reverse proxy

The app has no user accounts. In `trusted-header` mode it reads the user from
the `Remote-User` header set by the reverse proxy after its authentication. The
examples use Authelia (`/api/verify`); Authentik, oauth2-proxy and others work
the same way, with the header names adjusted if needed.
Each user only sees their own data. User IDs are stored in lower case, so
`Alice` and `alice` are the same user.

> **Important:** Anyone who can reach the port directly can send any
> `Remote-User` header. Therefore `trusted-header` mode requires
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
        copy_headers Remote-User Remote-Name Remote-Email
    }
    reverse_proxy habits:8080
}
```

Environment for either:

```bash
HABITS_AUTH_MODE=trusted-header
HABITS_TRUSTED_PROXIES=172.18.0.0/16
HABITS_TZ=Europe/Berlin
HABITS_DB=/data/habits.db
```

`/healthz` requires no authentication.

### Switching from single-user mode

Data belongs to a user ID. After switching to `trusted-header`, the data of
single-user mode still belongs to `local` and the signed-in user starts empty.
`habits move-user FROM TO` hands all data of one user (settings, categories,
habits and their entries) to another, who must not have data of their own.
`TO` is lower-cased, as the IDs read from the header are. The undo history of
`FROM` is dropped. The command does not migrate the database: it has to be
in the schema version of the binary, so start the server of a new release
once before. Stop the server first and back up the database:

```bash
docker compose stop habits
docker compose run --rm habits move-user local julian
docker compose up -d habits
```

## Backups and upgrades

The database is a single SQLite file (`HABITS_DB`, with its `-wal` and `-shm`
files while the server runs). Copying it while the server runs can catch a
half-written state; `habits backup PATH` writes a consistent copy instead
(SQLite's `VACUUM INTO`), also while the server runs, and refuses to overwrite
an existing file. It opens the database read-only and neither creates nor
migrates it, so the binary of a new release can back up the database of the
old server before the upgrade. In the container, write it to the volume and
copy it out:

```bash
docker compose exec habits /habits backup /data/backup-2026-10-01.db
docker compose cp habits:/data/backup-2026-10-01.db .
```

To restore, stop the server and put the copy in place of the database file,
without its old `-wal` and `-shm` files. Each user can also export their
habits with their whole history under Settings → "Data" and import the file
into another server; see [USAGE.md](USAGE.md).

A new release migrates the database on start. It migrates databases from
schema version 3 on; an older database has to be opened once with a release
from before the undo history (which migrates it to version 3) first.
