# QEO-224 Orderbook Low-Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce centralized popup Orderbook latency by removing synchronous checkpoint head-of-line blocking, publishing active shards concurrently, lowering the fanout cadence, making payload sizing linear, and adding end-to-end latency telemetry.

**Architecture:** Keep DNSE provider ownership centralized in the Go worker and keep Supabase private Broadcast as the browser transport. Move durable checkpoint persistence off the live broadcast critical path, bound concurrent network work, and preserve per-shard sequence order. Attach internal timestamps to frames/envelopes so the browser can measure upstream-to-worker, worker queue, Realtime delivery, and end-to-end latency without rendering backend topology to members.

**Tech Stack:** Go 1.23 worker, Supabase Realtime Broadcast/PostgREST, TypeScript/React browser transport, Node contract tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-qeo-216-centralized-orderbook-realtime-design.md` plus Linear `QEO-224` root-cause/acceptance criteria.

## Global Constraints

- No browser-direct provider WebSocket or provider credential exposure.
- Preserve ordered `te` execution delivery and latest-wins `t/q/f/e` semantics.
- Preserve continuity-gap recovery; a failed live Broadcast must not advance the live shard sequence.
- Checkpoint persistence is recovery-only and must not block a live Broadcast for another shard.
- Default orderbook flush cadence becomes 150 ms, bounded 100–1000 ms.
- Concurrent live Broadcast requests are bounded to four.
- Member-facing UI must not show DNSE/UpCloud/Supabase/topology labels.
- Runtime verification is GitHub Actions only unless remote execution is explicitly authorized.

---

### Task 1: Lock the low-latency contract and cadence

**Files:**
- Modify: `services/market-realtime-worker/internal/config/config.go`
- Modify: `services/market-realtime-worker/.env.example`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Produces: `ORDERBOOK_REALTIME_FLUSH_MS` default 150 ms, min 100 ms, max 1000 ms.

- [ ] Add a failing contract asserting the 150 ms default and low-latency publisher structure.
- [ ] Verify the contract fails on the current 500 ms implementation in GitHub Actions.
- [ ] Change config and env example to 150 ms with the new bounds.
- [ ] Re-run current contracts in GitHub Actions.

### Task 2: Make orderbook payload sizing linear

**Files:**
- Modify: `services/market-realtime-worker/internal/realtime/orderbook_buffer.go`
- Modify: `services/market-realtime-worker/internal/realtime/orderbook_buffer_test.go`

**Interfaces:**
- Produces: incremental JSON-array byte accounting that marshals each candidate frame once while preserving the existing payload cap.

- [ ] Add boundary tests proving selected frames stay within `maxPayloadBytes` and overflow remains queued.
- [ ] Replace repeated whole-slice `json.Marshal(candidate)` calls with incremental encoded-frame byte accounting (`2` array brackets plus comma separators).
- [ ] Keep state selection order and ordered execution semantics unchanged.
- [ ] Run worker unit tests in GitHub Actions.

### Task 3: Decouple live Broadcast from checkpoint persistence and publish shards concurrently

**Files:**
- Create: `services/market-realtime-worker/internal/worker/orderbook_publisher.go`
- Create: `services/market-realtime-worker/internal/worker/orderbook_publisher_test.go`
- Modify: `services/market-realtime-worker/internal/worker/run.go`

**Interfaces:**
- Consumes: `realtime.OrderbookBatch`, existing Supabase `PublishPrivateBroadcast` and `PublishCheckpoint` methods.
- Produces: a publisher that preserves one ordered live stream per shard, limits global Broadcast concurrency to four, retries failed live batches without advancing sequence, and coalesces recovery checkpoint work off the live path.

- [ ] Add tests with a fake client proving a blocked checkpoint cannot delay a later live Broadcast.
- [ ] Add tests proving multiple shard Broadcasts can overlap while the same shard remains ordered.
- [ ] Add tests proving a Broadcast failure retries the same sequence and does not commit it.
- [ ] Implement per-shard live queues plus a global four-request semaphore.
- [ ] Implement asynchronous per-shard checkpoint workers that keep only the latest successful live envelope while one checkpoint write is in flight.
- [ ] Replace the synchronous Broadcast/checkpoint loop in `Run` with non-blocking publisher submission; requeue a drained batch if that shard queue is full.
- [ ] Keep heartbeat visibility for committed live sequences, queue depth, and checkpoint lag/errors.
- [ ] Run worker tests/vet/build in GitHub Actions.

### Task 4: Add end-to-end latency telemetry without member-facing topology

**Files:**
- Modify: `services/market-realtime-worker/internal/worker/run.go`
- Modify: `services/market-realtime-worker/internal/worker/orderbook_publisher.go`
- Modify: `modules/market/providers/dnse/orderbook-stream.ts`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Frame metadata: `_qeoWorkerReceivedAt` as Unix milliseconds.
- Envelope `publishedAt`: UTC timestamp captured immediately before the live Broadcast request.
- Browser telemetry: rolling samples for `providerToWorker`, `workerQueue`, `delivery`, and `endToEnd`, summarized as p50/p95/p99 in developer console only.

- [ ] Stamp accepted tick/orderbook frames at worker ingress before buffering.
- [ ] Set `publishedAt` at Broadcast attempt time rather than buffer-drain time.
- [ ] Parse provider timestamps from numeric/string/protobuf `{Seconds,Nanos}` forms in the browser transport.
- [ ] Record rolling latency samples and emit a structured summary every 100 relevant frames without rendering it in the member UI.
- [ ] Add contract coverage for metadata/percentile telemetry and absence of member-facing topology text.
- [ ] Run TypeScript/contracts/build in GitHub Actions.

### Task 5: Review and production-readiness handoff

**Files:**
- Modify: `services/market-realtime-worker/README.md`

**Interfaces:**
- Produces: documented low-latency defaults, telemetry interpretation, and explicit remaining Supabase capacity gate.

- [ ] Document the 150 ms fanout cadence, async checkpoint behavior, four-way live publish bound, and telemetry fields.
- [ ] State that QEO-224 points 1–5 reduce code-path latency but do not remove the Free-plan 100 messages/sec capacity risk.
- [ ] Review the final diff for sequence safety, goroutine lifecycle, bounded queues, and no secret exposure.
- [ ] Require green Verify + Realtime Worker GitHub Actions on the final head before marking the PR merge-ready.
