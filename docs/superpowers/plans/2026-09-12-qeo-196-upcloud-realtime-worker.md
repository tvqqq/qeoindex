# QEO-196 UpCloud Realtime Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the QEO-175 Laravel/Railway worker runtime with a bounded Go/Docker runtime for UpCloud while preserving the Supabase realtime bus and browser contracts.

**Architecture:** A single Go process loads the canonical Top-200 universe, owns separate DNSE tick/index WebSockets, coalesces latest frames, and upserts the existing `dnse-market` bus row at about 1 Hz. UpCloud systemd timers start/stop an unprivileged resource-capped Docker Compose service during the Vietnam market window, with production enablement gated on QEO-175 migration and manual E2E smoke evidence.

**Tech Stack:** Go, gorilla/websocket, Supabase PostgREST + Realtime, Docker Compose, systemd.

**Spec:** `docs/superpowers/specs/2026-09-12-qeo-196-upcloud-realtime-worker-design.md`

## Global Constraints

- Preserve the existing `market_realtime_bus` schema and browser contract.
- Maximum canonical stock membership: 200.
- Default flush cadence: 1000 ms; clamp to 250–5000 ms.
- Realtime frame payload cap: 524288 bytes.
- Market runtime: weekdays 08:55–14:50 Asia/Ho_Chi_Minh.
- UpCloud host budget: 1 CPU / 2 GB; worker memory ceiling: 384 MB initially.
- No public listening ports.
- DNSE and Supabase service-role secrets must remain outside Git and logs.
- Do not enable production timers before manual E2E smoke passes.

---

### Task 1: Lock QEO-196 acceptance contract

**Files:**
- Modify: `tests/dnse-request-windows.test.ts`

**Produces:** deterministic source-level guardrails for the Go runtime and UpCloud deployment artifacts.

- [x] Add a failing test requiring a Go worker, JSON logging, signal-aware graceful shutdown, stale detection, monotonic sequence bootstrap, Docker no-port contract, 384 MB memory cap, and start/stop systemd timers.
- [x] Commit the RED contract before adding production implementation.

### Task 2: Implement Go worker core

**Files:**
- Create: `services/market-realtime-worker/go.mod`
- Create: `services/market-realtime-worker/cmd/market-realtime-worker/main.go`
- Create: `services/market-realtime-worker/internal/config/config.go`
- Create: `services/market-realtime-worker/internal/config/config_test.go`
- Create: `services/market-realtime-worker/internal/dnse/auth.go`
- Create: `services/market-realtime-worker/internal/dnse/auth_test.go`
- Create: `services/market-realtime-worker/internal/dnse/stream.go`
- Create: `services/market-realtime-worker/internal/realtime/buffer.go`
- Create: `services/market-realtime-worker/internal/realtime/buffer_test.go`
- Create: `services/market-realtime-worker/internal/realtime/sequence.go`
- Create: `services/market-realtime-worker/internal/realtime/sequence_test.go`
- Create: `services/market-realtime-worker/internal/supabase/client.go`
- Create: `services/market-realtime-worker/internal/worker/run.go`

**Interfaces:**
- `config.Load() (Config, error)` loads secrets/runtime bounds without logging secret values.
- `dnse.NewAuth(apiKey, apiSecret string) Auth` and `Auth.Payload(time.Time) Payload` preserve QEO-175 HMAC authentication.
- `realtime.Buffer.Push(map[string]any)`, `Drain()`, and `Requeue()` preserve latest-frame coalescing and the 512 KiB cap.
- `realtime.NextSequence(last int64, now time.Time) int64` guarantees strictly increasing sequence values.
- `supabase.Client.Universe(ctx)`, `CurrentSequence(ctx)`, and `Publish(ctx, sequence, frames)` preserve the existing bus boundary.
- `worker.Run(ctx, cfg, logger) error` owns the lifecycle.

- [ ] Write/verify unit tests for config market-window behavior, auth shape/signature, frame coalescing/payload bound, and sequence monotonicity.
- [ ] Implement the minimal core to satisfy those tests.
- [ ] Implement DNSE socket auth/subscribe/ping/stale/reconnect behavior and five-minute universe refresh.
- [ ] Implement one-second Supabase flush with publish-failure requeue.
- [ ] Run `go test ./...` and `go vet ./...`.

### Task 3: Add reproducible UpCloud container runtime

**Files:**
- Create: `services/market-realtime-worker/Dockerfile`
- Create: `services/market-realtime-worker/.dockerignore`
- Create: `services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml`
- Create: `services/market-realtime-worker/deploy/upcloud/qeo-market-realtime.service`
- Create: `services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-start.timer`
- Create: `services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-stop.service`
- Create: `services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-stop.timer`

- [ ] Build a static Linux binary in a multi-stage Docker image and run it as non-root with no `EXPOSE` instruction.
- [ ] Add Compose resource/security limits and an external env-file reference.
- [ ] Add Monday–Friday 08:55 ICT start and 14:50 ICT stop timers with reboot-safe persistence.
- [ ] Keep timers disabled by default; installation/enabling is an explicit post-smoke operator step.

### Task 4: Remove obsolete Railway/Laravel runtime and document cutover

**Files:**
- Delete: `services/market-realtime-worker/artisan`
- Delete: `services/market-realtime-worker/composer.json`
- Delete: `services/market-realtime-worker/railway.json`
- Delete: `services/market-realtime-worker/bootstrap/app.php`
- Delete: `services/market-realtime-worker/config/app.php`
- Delete: `services/market-realtime-worker/app/**`
- Modify: `services/market-realtime-worker/.env.example`
- Modify: `services/market-realtime-worker/README.md`
- Modify: `docs/market-board.md`
- Modify: `docs/HANDOVER.md`

- [ ] Replace Railway/Laravel instructions with UpCloud Docker/systemd runbook and rollback steps.
- [ ] Document that Supabase remains the persistence/realtime boundary and frontend contract is unchanged.
- [ ] Record the production gate: `market_realtime_bus` migration + manual E2E + old-path inactivity proof before timers are enabled.

### Task 5: Verify and open stacked PR

- [ ] Run QEO-196 source contract and Go tests.
- [ ] Build the Docker image.
- [ ] Run repository PR gates available in CI.
- [ ] Open a draft PR targeting `tvq9612/qeo-175-central-dnse-realtime` so QEO-196 remains explicitly stacked on QEO-175.
- [ ] Record production migration status and remaining UpCloud smoke steps in Linear.
- [ ] Do not mark QEO-196 Done until actual UpCloud/DNSE/Supabase/browser E2E and CPU/RAM measurements are available.
