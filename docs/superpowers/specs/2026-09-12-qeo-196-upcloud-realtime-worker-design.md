# QEO-196 UpCloud Realtime Worker Design

## Goal

Cut the QEO-175 centralized DNSE Market Board ingestion runtime over to the UpCloud Docker host without changing the existing `market_realtime_bus` or browser consumer contract.

## Decision

Use a small Go worker for production instead of carrying the Laravel/Railway runtime forward. The QEO-175 worker is bounded to authentication, two DNSE WebSocket subscriptions, a latest-frame buffer, a Supabase universe lookup, and a Supabase bus upsert, so the rewrite is small enough to justify the lower runtime footprint and simpler single-binary operations on a 1 CPU / 2 GB host.

The QEO-196 branch is stacked on the current QEO-175 PR head because `market_realtime_bus`, the browser Supabase transport, and the migration are not on `main` yet.

## Preserved contract

- Load canonical `vn_top_stocks`, bounded to 200 symbols.
- Subscribe one stock socket to `tick.G1.json` and one index socket to VNINDEX/VN30/HNX/UPCOM market-index channels.
- Refresh canonical membership every five minutes and reconnect the stock stream only when membership changes.
- Coalesce to the latest frame per `(T, symbol/index)` and keep the payload below 524288 bytes.
- Flush approximately once per second to the single `dnse-market` row in `market_realtime_bus`.
- Preserve increasing sequence values, including across worker restarts by reading the current bus sequence before the first publish.
- Do not change the browser Market Board transport or downstream reducers.

## Runtime behavior

The worker uses `Asia/Ho_Chi_Minh` as the market timezone and is allowed to run only on weekdays from 08:55 through 14:50 ICT. It exits cleanly outside that window and derives a deadline for the current trading day so a started process cannot run beyond the intended close.

Each DNSE socket owns authentication, subscription, heartbeat, frame timestamps, stale-stream detection, exponential reconnect backoff with jitter, and graceful WebSocket close. Stale market-frame reconnects apply only during active trading sub-windows and do not churn during lunch or the 08:55–09:00 pre-open interval.

SIGINT/SIGTERM cancels the worker context, closes sockets, and stops flush/universe loops. Logs use Go `slog` JSON output and never emit DNSE or Supabase credentials.

## UpCloud container and scheduling

The worker is built as a multi-stage Docker image and runs as an unprivileged user. It exposes no port and starts no HTTP listener.

`docker-compose.upcloud.yml` applies a 384 MB memory limit, a sub-1-CPU quota, read-only root filesystem, tmpfs `/tmp`, dropped Linux capabilities, and no-new-privileges. Credentials come from `/etc/qeoindex/market-realtime-worker.env`, outside Git.

Systemd owns scheduling:

- start timer: 01:55 UTC = 08:55 ICT, Monday–Friday;
- stop timer: 07:50 UTC = 14:50 ICT, Monday–Friday;
- both timers use `Persistent=true` for reboot recovery;
- the worker's own market-window gate remains the final safety boundary.

Automatic timers must not be enabled until the manual container smoke and browser E2E checks pass.

## Production gate

As of 2026-09-12, Supabase production does not contain `public.market_realtime_bus` and the QEO-175 migration `20260912074500_qeo175_market_realtime_bus` is absent from the migration ledger. Therefore QEO-196 implementation may be built and reviewed, but production scheduling remains disabled until QEO-175 migration/application and E2E verification are complete.

## Verification

- Node acceptance/source-contract test locks the runtime and infra invariants.
- Go unit tests cover auth signing shape, market-window handling, frame coalescing/bounds, monotonic sequencing, and backoff behavior.
- `go test ./...` and `go vet ./...` must pass.
- Docker image must build from the service directory.
- Manual UpCloud smoke must validate DNSE auth/subscriptions, Supabase writes, increasing sequences, reconnect after interruption, browser Supabase Realtime delivery, and measured CPU/RAM before timers are enabled.
