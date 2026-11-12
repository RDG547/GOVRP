# Build on ARM64 (Ampere A1) or AMD64. The SQLite driver uses CGO.
FROM --platform=$BUILDPLATFORM golang:1.27.2-bookworm AS build
ARG TARGETOS TARGETARCH
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY *.go ./
RUN CGO_ENABLED=1 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/govrp-bot .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 bot && mkdir /data && chown bot:bot /data
COPY --from=build /out/govrp-bot /usr/local/bin/govrp-bot
USER bot
ENV BOT_SESSION_DB=/data/session.db
VOLUME /data
ENTRYPOINT ["/usr/local/bin/govrp-bot"]
