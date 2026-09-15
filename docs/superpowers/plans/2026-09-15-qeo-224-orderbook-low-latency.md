# QEO-224 Orderbook Low-Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce centralized popup Orderbook latency by removing synchronous checkpoint head-of-line blocking, publishing active shards concurrently, lowering the fanout cadence, making payload sizing linear, and adding end-to-end latency telemetry.

**Architecture:** Keep DNSE provider ownership centralized in the Go worker and keep Supabase private Broadcast as the browser transport. Move durable checkpoint persistence off the live broadcast critical path, bound concurrent network work, and preserve per-shard sequence order. Attach internal timestamps to frames/envelopes so the browser can measure upstream-to-worker, worker queue, Realtime delivery, and end-to-end latency without rendering backend topology to members.

**Tech Stack:** Go worker, Supabase Realtime Broadcast/PostgREST, TypeScript/React browser transport, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-qeo-216-centralized-orderbook-realtime-design.md` plus Linear `QEO-224` root-cause/acceptance criteria.

## Global Constraints

- No browser-direct provider WebSocket or provider credential exposure.
- Preserve ordered `te` execution delivery and latest-wins `t/q/f/e` semantics.
- Preserve continuity-gap recovery; a failed live Broadcast must not advance the live shard sequence.
- Checkpoint persistence is recovery-only and must not block a live Broadcast for another shard.
- Default orderbook flush cadence becomes 200 ms, bounded 100–1000 ms. The 200 ms default is intentionally quota-aware while the current Realtime capacity gate is unresolved.
- Concurrent live Broadcast requests are bounded to four.
- Member-facing UI must not show backend topology labels.
- Runtime verification is GitHub Actions only unless remote execution is explicitly authorized.

---

### Task 1: Lock the low-latency contract and cadence

**Files:**
- Modify: `services/market-realtime-worker/internal/config/config.go`
- Modify: `services/market-realtime-worker/.env.example`

**Interfaces:**
- Produces: `ORDERBOOK_REALTIME_FLUSH_MS` default 200 ms, min 100 ms, max 1000 ms.

- [x] Establish TDD RED through failing low-latency worker tests in GitHub Actions.
- [x] Change config and env example to a low-latency cadence within the 100–200 ms target range.
- [x] Choose 200 ms rather than 100–150 ms to avoid unnecessarily increasing producer event pressure before the Realtime capacity gate is resolved.

### Task 2: Make orderbook payload sizing linear

**Files:**
- Modify: `services/market-realtime-worker/internal/realtime/orderbook_buffer.go`
- Modify: `services/market-realtime-worker/internal/realtime/orderbook_buffer_test.go`

**Interfaces:**
- Produces: incremental JSON-array byte accounting that marshals each candidate frame once while preserving the existing payload cap.

- [x] Add boundary tests proving exact JSON byte accounting and overflow rejection.
- [x] Replace repeated whole-slice `json.Marshal(candidate)` calls with incremental encoded-frame byte accounting.
- [x] Keep state selection order and ordered execution semantics unchanged.

### Task 3: Decouple live Broadcast from checkpoint persistence and publish shards concurrently

**Files:**
- Create: `services/market-realtime-worker/internal/worker/orderbook_publisher.go`
- Create: `services/market-realtime-worker/internal/worker/orderbook_publisher_test.go`
- Modify: `services/market-realtime-worker/internal/worker/run.go`

**Interfaces:**
- Consumes: `realtime.OrderbookBatch`, existing Supabase `PublishPrivateBroadcast` and `PublishCheckpoint` methods.
- Produces: a publisher that preserves one ordered live stream per shard, limits global Broadcast concurrency to four, retries failed live batches without advancing sequence, and coalesces recovery checkpoint work off the live path.

- [x] Add tests proving a blocked checkpoint cannot delay a later live Broadcast.
- [x] Add tests proving different shard Broadcasts can overlap while each shard remains ordered.
- [x] Add tests proving a Broadcast failure retries the same sequence and does not commit it.
- [x] Implement per-shard live queues plus a global four-request semaphore.
- [x] Implement asynchronous per-shard checkpoint workers that keep the latest successful live envelope while checkpoint I/O is in flight.
- [x] Replace the synchronous Broadcast/checkpoint loop in `Run` with non-blocking publisher submission and bounded requeue.
- [x] Keep heartbeat visibility for committed live sequences, queue depth, checkpoint lag/errors, and continuity gaps.

### Task 4: Add end-to-end latency telemetry without member-facing topology

**Files:**
- Modify: `services/market-realtime-worker/internal/worker/run.go`
- Modify: `services/market-realtime-worker/internal/worker/orderbook_publisher.go`
- Modify: `modules/market/providers/dnse/orderbook-stream.ts`

**Interfaces:**
- Frame metadata: `_qeoWorkerReceivedAt` as Unix milliseconds.
- Envelope `publishedAt`: UTC timestamp captured immediately before the live Broadcast request.
- Browser telemetry: rolling samples for `providerToWorker`, `workerQueue`, `delivery`, and `endToEnd`, summarized as p50/p95/p99 in developer console only.

- [x] Stamp accepted tick/orderbook frames at worker ingress before buffering.
- [x] Set `publishedAt` at Broadcast attempt time rather than buffer-drain time.
- [x] Parse provider timestamps from numeric/string/protobuf `{Seconds,Nanos}` forms in the browser transport.
- [x] Record rolling latency samples and emit a structured summary every 100 relevant frames without rendering it in member UI.
- [x] Treat checkpoint sequence as hydration-only so intentionally asynchronous checkpoints do not create a reconnect loop; strict gap/epoch checks begin after the first newer live Broadcast establishes a baseline.

### Task 5: Review and production-readiness handoff

**Files:**
- Modify: `services/market-realtime-worker/README.md`

**Interfaces:**
- Produces: documented low-latency defaults, telemetry interpretation, and explicit remaining Realtime capacity gate.

- [x] Document the 200 ms fanout cadence, async checkpoint behavior, four-way live publish bound, hydration baseline semantics, and telemetry fields.
- [x] State that QEO-224 points 1–5 reduce code-path latency but do not remove the Free-plan 100 messages/sec capacity risk.
- [x] Review sequence safety, goroutine lifecycle, bounded queues, checkpoint lag semantics, and no secret exposure.
- [ ] Require green Verify + Realtime Worker GitHub Actions on the final head before marking the PR merge-ready.
