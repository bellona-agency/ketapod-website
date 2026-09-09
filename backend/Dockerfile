# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────
# One build stage produces all four binaries. They share almost every
# package, so building them together reuses one compile of the module
# instead of paying for it four times in four images.
FROM golang:1.25-alpine AS build

WORKDIR /src

# Dependencies first: this layer is invalidated only by go.mod/go.sum, so
# an ordinary code change rebuilds in seconds rather than re-downloading
# the module cache.
# The module proxy is reachable from here but not reliably: builds on this
# team's connection fail partway through the download with "unexpected
# EOF" often enough that a single attempt is not a build step, it is a coin
# flip. Retrying is what makes the image buildable at all; GOPROXY is an
# argument because the proxy that works is a property of where you are
# sitting, not of this project.
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY

COPY go.mod go.sum ./
RUN for attempt in 1 2 3 4 5; do \
        go mod download && break; \
        echo "go mod download failed (attempt $attempt), retrying..."; \
        sleep 5; \
    done; \
    go mod download

COPY . .

# CGO off keeps the binaries static, which is what lets them run on a
# bare alpine image with no glibc.
ENV CGO_ENABLED=0

# No BuildKit cache mounts on purpose: they need a builder that not every
# machine on this team has (colima ships without buildx by default), and an
# image that only builds on some laptops is worse than one that rebuilds
# slowly on all of them. Layer order still does the caching that matters —
# dependencies above, source below.
RUN go build -ldflags="-s -w" -o /out/api       ./cmd/api      && \
    go build -ldflags="-s -w" -o /out/worker    ./cmd/worker   && \
    go build -ldflags="-s -w" -o /out/scheduler ./cmd/scheduler && \
    go build -ldflags="-s -w" -o /out/migrate   ./cmd/migrate  && \
    go build -ldflags="-s -w" -o /out/seed      ./cmd/seed

# ── runtime ──────────────────────────────────────────────────────────────
FROM alpine:3.21

# ca-certificates: the payment gateway and the AI service are reached over
# TLS, and a scratch image trusts nothing.
# ffmpeg: the worker joins per-chapter narration into the single continuous
#   file the player expects (internal/ingest/audio.go). It is ~80MB and only
#   the worker uses it, but one image for all four binaries is worth more
#   than the megabytes — four images drift.
# tzdata: every calendar boundary in the product (the kids daily limit,
#   streaks, weekly reports) is evaluated in Asia/Tehran.
RUN apk add --no-cache ca-certificates ffmpeg tzdata

# Nothing here needs root, and a container that writes books to object
# storage is exactly the one you do not want running as it.
RUN adduser -D -u 10001 ketapod

COPY --from=build /out/ /usr/local/bin/
# migrate reads the .sql files at runtime rather than embedding them.
COPY --from=build /src/migrations /app/migrations
COPY --from=build /src/seed /app/seed

WORKDIR /app
USER ketapod

EXPOSE 8080
CMD ["api"]
