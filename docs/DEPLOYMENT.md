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
| `HABITS_GROUPS_HEADER` | `Remote-Groups` | Groups (optional) |

In the default `single-user` mode there is no authentication and all data
belongs to the user `local`.

The time zone is resolved on the server, so all devices of a user agree on the
current day.

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
        copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
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
