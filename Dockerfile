# Two stages. The build runs on the runner's own architecture and
# cross-compiles from there for the target - hence --platform=$BUILDPLATFORM.
# The SQLite driver is pure Go, so this costs neither a C toolchain nor QEMU;
# an arm64 image takes as long on an amd64 runner as the native one.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build

WORKDIR /src

# The module list first, the rest after: as long as go.mod and go.sum do not
# change, the download layer stays cached - even when every line of
# application code has changed.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Set by buildx, once per target platform.
ARG TARGETOS
ARG TARGETARCH
# Shown on the settings' version page. Passed by the workflow, as .git is not
# in the build context; empty for a local build.
ARG VERSION=""
ARG REVISION=""
ARG BUILD_TIME=""
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -o /out/habits \
    -ldflags="-s -w \
      -X github.com/JulWit/habits/internal/httpapi.Version=$VERSION \
      -X github.com/JulWit/habits/internal/httpapi.Revision=$REVISION \
      -X github.com/JulWit/habits/internal/httpapi.BuildTime=$BUILD_TIME" .

# The data directory is created here because scratch has no mkdir and
# store.Open does not create the path itself. It belongs to the unprivileged
# user the server runs as (see USER below).
RUN install -d -o 65534 -g 65534 /data

# No base image. The binary is statically linked, the timezone database is
# compiled in via time/tzdata, and the application opens no outbound TLS
# connections - so there is nothing a base image could contribute but attack
# surface.
FROM scratch

COPY --from=build /out/habits /habits
# COPY would hand the directory to root; --chown keeps it writable for the
# server.
COPY --from=build --chown=65534:65534 /data /data

# The default in config.go is a relative path; inside the container it has to
# point at the volume, or the database lands in the read-only top layer.
ENV HABITS_ADDR=:8080 \
    HABITS_DB=/data/habits.db

EXPOSE 8080
VOLUME ["/data"]

# The server needs no privileges: the port is above 1024 and it only writes
# to /data. 65534 is "nobody"; scratch has no /etc/passwd, so it is numeric.
USER 65534:65534

# There is no shell or curl in the image, so the binary asks its own /healthz
# (see healthcheck in main.go).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/habits", "healthcheck"]

ENTRYPOINT ["/habits"]
