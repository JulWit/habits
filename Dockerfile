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
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/habits .

# The data directory is created here because scratch has no mkdir and
# store.Open does not create the path itself. Ownership travels with the COPY
# into the second stage.
RUN install -d -o 65532 -g 65532 /data

# No base image. The binary is statically linked, the timezone database is
# compiled in via time/tzdata, and the application opens no outbound TLS
# connections - so there is nothing a base image could contribute but attack
# surface.
FROM scratch

COPY --from=build /out/habits /habits
COPY --from=build /data /data

# Numeric, because scratch has no /etc/passwd in which a name could be
# resolved.
USER 65532:65532

# The default in config.go is a relative path; inside the container it has to
# point at the volume, or the database lands in the read-only top layer.
ENV HABITS_ADDR=:8080 \
    HABITS_DB=/data/habits.db

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/habits"]
