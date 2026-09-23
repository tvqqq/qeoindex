# QEO-216 Centralized Orderbook Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move popup orderbook realtime from browser-direct DNSE WebSockets to a bounded UpCloud Go worker plus authenticated Supabase Realtime Broadcast fanout, while preserving depth/trade/foreign/mini-chart behavior and guaranteeing at least 100 simultaneously viewed unique tickers without increasing provider socket count above the approved six-socket design.

**Architecture:** Reuse the existing canonical `tick.G1.json` socket for popup quote/mini-chart frames; add four deterministic supplemental DNSE sockets for `top_price.G1.json`, `tick_extra.G1.json`, and `foreign.G1.json`; batch per-symbol frames into ten stable private Supabase Broadcast shards every 500 ms. Browser startup and every restart hydrate the Supabase auth session and call `realtime.setAuth()` before any private channel subscription; continuity gaps recover through the existing orderbook session/snapshot authority and never fall back to direct DNSE.

**Tech Stack:** Go 1.23 worker with Gorilla WebSocket, Next.js 16.3 / React 19 / TypeScript 5.7, `@supabase/supabase-js` 2.112.3, Supabase Realtime Broadcast + RLS, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-qeo-216-centralized-orderbook-realtime-design.md`

## Global Constraints

- Exactly six target provider sockets: one canonical stock tick socket, one index socket, four supplemental orderbook sockets.
- Each supplemental socket owns at most 50 symbols × 3 feeds = 150 memberships.
- Ten stable private Broadcast topics: `orderbook:v1:00` through `orderbook:v1:09`.
- Default orderbook fanout cadence is 500 ms.
- Broadcast payload target is <= 192 KiB; larger batches split without reordering execution frames.
- `t`, `q`, and `f` are latest-wins within the pending window; every `te` frame is preserved in arrival order until published or an explicit continuity gap is raised.
- Browser must not call `/api/market/stream-auth`, instantiate a DNSE WebSocket, or receive DNSE auth material for popup realtime.
- Every private Realtime join/rejoin must execute `auth.getSession()` → `realtime.setAuth(access_token)` before `.channel(...).subscribe()`.
- No public UpCloud port is introduced.
- Existing Market Board `dnse-market` contract and 1 Hz behavior remain intact.
- Runtime verification is through GitHub Actions only under the QeoIndex inline-only policy; no shell/UpCloud execution unless separately authorized.

---

### Task 1: Lock QEO-216 regression contracts before production code

**Files:**
- Modify: `tests/dnse-request-windows.test.ts`
- Create: `services/market-realtime-worker/internal/realtime/orderbook_buffer_test.go`
- Create: `services/market-realtime-worker/internal/worker/orderbook_plan_test.go`
- Create: `services/market-realtime-worker/internal/supabase/broadcast_test.go`

**Interfaces:**
- Consumes: approved design constants and existing source paths.
- Produces: failing contracts for `PlanOrderbookShards`, `NewOrderbookBuffer`, `DrainShard`, `CommitShard`, `RequeueShard`, `PublishPrivateBroadcast`, browser transport removal, auth-before-subscribe ordering, and private Realtime RLS migration.

- [ ] **Step 1: Add the TypeScript source-contract tests**

Add assertions that `components/orderbook/live-orderbook-panel.tsx` no longer contains `new WebSocket(authJson.url)` or `/api/market/stream-auth`, that it imports/uses the centralized orderbook stream transport, that the new transport creates `private: true` Broadcast channels, and that `getSession`/`setAuth` precede channel subscription.

- [ ] **Step 2: Add Go shard-planning RED tests**

Test a 200-symbol deterministic universe and assert exactly four supplemental shards, max 50 symbols per shard, and channels exactly `top_price.G1.json`, `tick_extra.G1.json`, `foreign.G1.json`.

- [ ] **Step 3: Add Go buffering RED tests**

Assert latest-wins for `t/q/f`, ordered preserve-all for `te`, bounded execution queue raises an explicit gap marker, failed publish/requeue does not advance committed sequence, and successful commit does.

- [ ] **Step 4: Add Go Broadcast publisher RED tests**

Use an `httptest.Server` and assert private REST Broadcast requests use `/realtime/v1/api/broadcast/<topic>/events/orderbook?private=true`, service-role `apikey`, JSON content type, and return an error on non-2xx including 429.

- [ ] **Step 5: Commit the RED tests**

Commit only tests/contracts first so GitHub Actions proves the intended implementation is missing before production code is added.

### Task 2: Add deterministic provider sharding and orderbook buffering

**Files:**
- Modify: `services/market-realtime-worker/internal/dnse/stream.go`
- Create: `services/market-realtime-worker/internal/realtime/orderbook_buffer.go`
- Create: `services/market-realtime-worker/internal/worker/orderbook_plan.go`
- Modify: `services/market-realtime-worker/internal/config/config.go`

**Interfaces:**
- Consumes: canonical uppercase universe from `supabase.Client.Universe()`.
- Produces:
  - `dnse.OrderbookChannels(symbols []string) []dnse.Channel`
  - `worker.PlanOrderbookShards(symbols []string) [][]string`
  - `realtime.OrderbookEnvelope`
  - `realtime.NewOrderbookBuffer(shardCount, maxPayloadBytes, maxExecutionFrames int)`
  - buffer methods `Push`, `DrainShard`, `RequeueShard`, `CommitShard`, `Len`, `GapCount`.

- [ ] **Step 1: Implement `OrderbookChannels` minimally**

Return only the three supplemental feeds and copy the symbol slice defensively.

- [ ] **Step 2: Implement deterministic four-way provider planning**

Normalize/dedupe symbols, preserve canonical ordering, cap at 200, and split into four contiguous shards of at most 50 symbols. Reject/flag any plan requiring more than four shards instead of opening extra provider sockets.

- [ ] **Step 3: Implement the orderbook buffer**

Route symbols to ten fanout shards using FNV-1a 32-bit hashing shared with TypeScript. Keep latest state map entries for `t/q/f`; append every `te`; bound execution frames per shard at 2,000; when the queue truncates, increment a shard epoch/gap counter and mark the next envelope `continuityGap=true`.

- [ ] **Step 4: Add explicit config values**

Add `ORDERBOOK_REALTIME_FLUSH_MS` default 500 (bounded 250–2000), `ORDERBOOK_REALTIME_MAX_PAYLOAD_BYTES` default 196608, and `ORDERBOOK_REALTIME_MAX_EXECUTION_FRAMES` default 2000.

- [ ] **Step 5: Keep existing Market Board buffer/config behavior unchanged**

Do not alter `MARKET_REALTIME_FLUSH_MS=1000`, the existing 512 KiB board payload limit, or index/tick channel contracts.

### Task 3: Add Supabase private Broadcast publishing and checkpoint rows

**Files:**
- Modify: `services/market-realtime-worker/internal/supabase/client.go`
- Create: `supabase/migrations/20260914090000_qeo216_orderbook_realtime_broadcast.sql`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Produces:
  - `CurrentSequenceFor(ctx context.Context, stream string) (int64, error)` while preserving existing `CurrentSequence(ctx)` behavior for `dnse-market`.
  - `PublishCheckpoint(ctx, stream string, sequence int64, frames []map[string]any) error`.
  - `PublishPrivateBroadcast(ctx, topic, event string, payload any) error`.
- Database checkpoint keys: `orderbook-v1-00` ... `orderbook-v1-09`.
- Private topics: `orderbook:v1:00` ... `orderbook:v1:09`.

- [ ] **Step 1: Generalize sequence/checkpoint helpers without changing `dnse-market` callers**

Keep the original `CurrentSequence(ctx)` and `Publish(ctx, sequence, frames)` as wrappers around stream-aware helpers.

- [ ] **Step 2: Implement private Broadcast REST publishing**

POST JSON directly to `/realtime/v1/api/broadcast/<escaped-topic>/events/<escaped-event>?private=true` with service-role `apikey`. Treat every non-2xx status, including 429, as a publish failure.

- [ ] **Step 3: Add private Broadcast RLS policy migration**

Create a SELECT policy on `realtime.messages` for role `authenticated` that permits only `extension = 'broadcast'` and topics matching `^orderbook:v1:[0-9]{2}$`. Do not grant authenticated INSERT/Broadcast send permission. Keep existing `market_realtime_bus` authenticated SELECT policy unchanged.

- [ ] **Step 4: Add migration/source contracts**

Assert private topic pattern, broadcast-only extension guard, and absence of authenticated INSERT policy for orderbook topics.

### Task 4: Orchestrate six fixed DNSE streams and ten bounded fanout shards

**Files:**
- Modify: `services/market-realtime-worker/internal/worker/run.go`
- Modify: `services/market-realtime-worker/README.md`
- Modify: `services/market-realtime-worker/.env.example`

**Interfaces:**
- Canonical tick callback feeds both the existing Market Board buffer and orderbook fanout buffer.
- Supplemental socket callbacks feed only orderbook fanout.
- Four supplemental socket contexts are independently cancellable/restartable.

- [ ] **Step 1: Load per-shard checkpoint sequence state at worker start**

Read `orderbook-v1-00` ... `orderbook-v1-09` sequences independently; failure to load required checkpoint state fails startup rather than silently resetting continuity.

- [ ] **Step 2: Start the four supplemental streams**

Create stream names `orderbook-0` ... `orderbook-3`, each with <=50 symbols and exactly three supplemental channels. Log membership count per stream.

- [ ] **Step 3: Reuse canonical tick frames**

The existing `ticks` callback continues pushing into the board buffer and additionally pushes `T=t` frames into the orderbook buffer. Do not create another `tick.G1.json` subscription.

- [ ] **Step 4: Flush orderbook fanout every 500 ms**

For each non-empty fanout shard, build a monotonic envelope, publish private Broadcast event `orderbook`, then upsert the bounded checkpoint. Commit sequence only after Broadcast and checkpoint both succeed; otherwise requeue and retry with existing loop cadence while logging the failure.

- [ ] **Step 5: Restart only affected supplemental streams on universe changes**

Recompute deterministic provider shards after canonical refresh; cancel/restart only supplemental streams whose symbol membership changed, while keeping healthy tick/index streams alive.

- [ ] **Step 6: Extend heartbeat logging**

Include provider socket target count, supplemental memberships, pending frames/executions, continuity gaps, and per-shard committed sequences.

- [ ] **Step 7: Document new env controls and six-socket production gate**

Document the 500 ms flush, payload/queue bounds, required Supabase >=500 events/sec budget, and the requirement to prove six concurrent DNSE subscriptions before enabling production cutover.

### Task 5: Share the QEO-196 authenticated Realtime startup boundary

**Files:**
- Create: `modules/shared/supabase/authenticated-realtime.ts`
- Modify: `modules/market/providers/dnse/market-stream.ts`
- Modify: `modules/shared/supabase/browser-orderbook.ts`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Produces `getAuthenticatedSupabaseRealtimeClient(): Promise<SupabaseClient>` which obtains the singleton client, awaits `auth.getSession()`, requires `access_token`, calls `realtime.setAuth(access_token)`, then returns the authenticated client.

- [ ] **Step 1: Add auth-boundary RED contract**

Assert the shared helper contains `getSession` before `setAuth`, and both Market Board and orderbook transports call the helper before `.channel(...).subscribe()`.

- [ ] **Step 2: Implement the helper**

Throw recoverable errors for missing configuration, auth error, or missing session token. Do not cache a promise permanently so failed hydration can be retried.

- [ ] **Step 3: Refactor Market Board startup onto the helper**

Preserve QEO-196 ordering and all existing `dnse-market` behavior; only remove duplicated auth bootstrap code.

- [ ] **Step 4: Auth-gate the existing snapshot Realtime subscription**

Change `subscribeToOrderbookRealtime` to join asynchronously through the helper and make cleanup safe when unsubscribe happens before channel creation finishes.

### Task 6: Add centralized browser orderbook Broadcast transport

**Files:**
- Create: `modules/market/providers/dnse/orderbook-stream.ts`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Produces:
  - `orderbookFanoutShard(symbol: string): number` using the same FNV-1a algorithm as Go.
  - `subscribeDnseOrderbookFrames(symbol, onFrame, onState): () => void`.
  - state values `CONNECTING | LIVE | RECOVERING | STALE | ERROR | CLOSED`.
  - version-1 envelope parser with `sequence`, `continuityGap`, `frames`, `publishedAt`.

- [ ] **Step 1: Implement cross-language stable shard hashing**

Uppercase/trim the symbol, apply FNV-1a 32-bit bytes, and modulo 10. Add fixed ticker vectors in TS and Go tests so mappings cannot drift.

- [ ] **Step 2: Bootstrap the matching checkpoint after auth**

Read only `market_realtime_bus.stream = orderbook-v1-XX`; accept frames for the exact requested symbol and seed the local sequence/epoch before Broadcast join.

- [ ] **Step 3: Join the private Broadcast topic**

Create `supabase.channel(topic, { config: { private: true } })`, listen for `broadcast` event `orderbook`, filter exact symbol, and emit raw DNSE-compatible frames to the popup reducer.

- [ ] **Step 4: Detect continuity failures**

If sequence is non-contiguous after the first accepted envelope or `continuityGap` is true, publish `RECOVERING` and require a fresh checkpoint/session recovery before returning to `LIVE`.

- [ ] **Step 5: Implement bounded reconnect with shared auth gate**

For `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, visibility resume, and online resume, clean up the current channel and restart through `getAuthenticatedSupabaseRealtimeClient()` with exponential backoff + jitter. Never create a DNSE WebSocket fallback.

### Task 7: Cut `LiveOrderBookPanel` over without changing domain semantics

**Files:**
- Modify: `components/orderbook/live-orderbook-panel.tsx`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Consumes raw DNSE-compatible frames from `subscribeDnseOrderbookFrames`.
- Existing reducers for `T=t`, `T=q`, `T=te`, `T=f` remain the source of UI behavior.
- `T=t` also updates the mini-chart by the existing 5-minute bucket logic, replacing the old `T=b` live dependency.

- [ ] **Step 1: Remove direct stream-auth/WebSocket lifecycle**

Delete browser fetch of `/api/market/stream-auth`, `new WebSocket`, DNSE auth/subscribe messages, ping/pong timers, and socket reconnect ownership from this component.

- [ ] **Step 2: Feed centralized frames into the existing reducers**

Keep quote normalization, depth sorting, execution ID preference (`transId`, `tradeId`, `sequence`, `seqNo`, `id`), foreign totals/events, session trade merging, and whale behavior unchanged.

- [ ] **Step 3: Derive mini-chart updates from `T=t`**

Use tick price/time to maintain the current one-value-per-five-minute-bucket behavior; no `ohlc.1.json` realtime subscription remains.

- [ ] **Step 4: Map centralized transport state to popup state**

`LIVE` clears errors; `RECOVERING/STALE` preserves last-known data and triggers the existing session-history refresh path; `ERROR/CLOSED` remains visible without direct-provider fallback.

- [ ] **Step 5: Keep existing Supabase snapshot recovery as secondary authority**

Snapshot updates must not overwrite a healthy centralized `LIVE` stream, matching current behavior.

### Task 8: Review diff, verify CI, and prepare production rollout gates

**Files:**
- Modify: `.github/workflows/qeo196-realtime-worker.yml` only if needed so worker tests run for every new worker file path (existing `services/market-realtime-worker/**` path already covers them).
- Modify: PR #484 body / Linear QEO-216 comment/status.

**Interfaces:**
- GitHub Actions `Verify` and `QEO-196 Realtime Worker` are the runtime/build verification authority for source implementation.

- [ ] **Step 1: Review the complete PR diff against the approved spec**

Check no browser DNSE path remains in popup code, no duplicate `tick.G1` provider subscription was introduced, and Market Board contract changes are limited to shared auth helper refactoring.

- [ ] **Step 2: Wait for GitHub Actions on the exact implementation head**

Required green evidence: repository Verify plus QEO-196 worker unit tests, vet, worker build, and production container build.

- [ ] **Step 3: Keep PR draft until source CI is green**

Do not merge or deploy automatically. Runtime UpCloud/Supabase production acceptance remains a separate explicitly authorized step.

- [ ] **Step 4: Record remaining production gates**

Document that source completion does not prove: Supabase effective >=500 events/sec, six concurrent DNSE sockets on the production API key, browser Network absence of DNSE WS, 100-unique-ticker capacity, or controlled continuity-gap recovery. Those require authorized production acceptance.
