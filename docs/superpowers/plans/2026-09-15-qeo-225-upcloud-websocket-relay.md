# QEO-225 Authenticated UpCloud WebSocket Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Realtime as the member-facing Market Board and Orderbook hot path with one authenticated, multiplexed WebSocket relay hosted by the existing UpCloud Go realtime worker while retaining Supabase only for bootstrap/recovery checkpoints.

**Architecture:** The existing Go worker remains the sole upstream market-data owner. It exposes a bounded authenticated WebSocket hub, publishes low-latency in-memory `market` and `orderbook:<SYMBOL>` messages, and persists Supabase checkpoints asynchronously. Browser code owns one physical WebSocket per tab and keeps existing Market Board/Orderbook domain APIs intact through transport adapters.

**Tech Stack:** Go 1.23, gorilla/websocket, Next.js 16 / TypeScript, Supabase Auth/Postgres for entitlement + checkpoint recovery, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-qeo-225-upcloud-websocket-relay-design.md`

## Global Constraints

- No browser-direct provider WebSocket, provider URL, provider credentials, service-role credentials, signing secret, UpCloud IP, or secret-bearing URL may reach member-facing code/UI.
- One physical browser relay socket per tab; multiplex `market` and `orderbook:<UPPERCASE_SYMBOL>` logical topics.
- Relay auth token TTL is at most 60 seconds and is sent only as the first WebSocket application frame, never in query parameters.
- `market_board` feature entitlement is required before token minting.
- Production relay origin allowlist is fail-closed; no wildcard origin.
- Slow consumers are disconnected and recover from snapshots; ordered `te` execution frames are never silently dropped.
- Supabase checkpoint requests are recovery-only and must never block live relay delivery.
- Market Board UI paint cadence remains independent of transport cadence.
- Target production orderbook provider-event -> browser receive p95 < 300 ms.
- Runtime validation stays in GitHub Actions unless production/remote execution is separately authorized.
- Public browser relay address is exposed only as `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL`; the shared signing secret remains server-only as `QEO_MARKET_REALTIME_SIGNING_SECRET`.

---

### Task 1: Add short-lived relay capability token

**Files:**
- Create: `modules/market/realtime/relay-token.ts`
- Create: `app/api/market/realtime-token/route.ts`
- Modify: `.env.example`
- Modify: `tests/auth-api-contract.test.ts`
- Create: `tests/market-realtime-relay-contract.test.ts`

**Interfaces:**
- Produces: `mintMarketRealtimeToken(userId: string, secret: string, nowMs?: number): { token: string; expiresAt: string }`
- Produces route: `POST /api/market/realtime-token` -> `{ ok: true, token, expiresAt }`

- [ ] **Step 1: Add RED route/security contracts.** Assert the route uses `requireApiFeature("market_board")`, rejects cross-origin requests, reads `QEO_MARKET_REALTIME_SIGNING_SECRET`, sets `Cache-Control: no-store`, and never returns a provider URL/service credential.
- [ ] **Step 2: Add RED deterministic token tests.** Parse `<claims>.<signature>`, verify claims `{v:1,aud:"qeo-market-realtime",sub,iat,exp}`, verify `exp-iat <= 60`, and verify HMAC-SHA256 with Node `createHmac`.
- [ ] **Step 3: Implement `relay-token.ts`.** Use `createHmac("sha256", secret)`, `Buffer.from(JSON.stringify(claims)).toString("base64url")`, and a default TTL of 60 seconds; reject empty subject/secret.
- [ ] **Step 4: Implement POST route.** Perform feature auth first, same-origin check second, require signing secret, mint token, return no-store JSON. Do not accept GET.
- [ ] **Step 5: Document only the public WSS URL and server signing key names in `.env.example`:** `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL=` and `QEO_MARKET_REALTIME_SIGNING_SECRET=`.
- [ ] **Step 6: Verify in GitHub Actions.** Expected relevant Node contracts PASS; no source-level secret scan regression.

### Task 2: Add Go relay configuration and compatible token verification

**Files:**
- Modify: `services/market-realtime-worker/internal/config/config.go`
- Modify: `services/market-realtime-worker/.env.example`
- Create: `services/market-realtime-worker/internal/relay/token.go`
- Create: `services/market-realtime-worker/internal/relay/token_test.go`

**Interfaces:**
- Produces config fields: `RelayListenAddr string`, `RelaySigningSecret string`, `RelayAllowedOrigins []string`, `RelayAuthTimeout time.Duration`, `RelayPingInterval time.Duration`, `RelaySendQueue int`, `RelayMarketFlushInterval time.Duration`, `RelayOrderbookFlushInterval time.Duration`.
- Produces: `VerifyToken(token string, secret string, now time.Time) (Claims, error)` where `Claims` contains `Version int`, `Subject string`, `Audience string`, `IssuedAt int64`, `ExpiresAt int64`.

- [ ] **Step 1: Add RED Go tests** for valid Node-compatible HMAC token, bad signature, wrong audience/version, expired token, >60-second lifetime, and malformed base64/JSON.
- [ ] **Step 2: Add RED config tests/contracts** for defaults: `:8787`, auth timeout 5000 ms, ping 15000 ms, send queue 64, market flush 100 ms, orderbook flush 50 ms; production-required signing secret + origins cannot be silently empty.
- [ ] **Step 3: Implement token verifier** with standard library `crypto/hmac`, `crypto/sha256`, `encoding/base64`, `encoding/json`; use constant-time `hmac.Equal`.
- [ ] **Step 4: Implement bounded config parsing.** Normalize/trim origin list and reject wildcard `*`.
- [ ] **Step 5: Verify Go unit tests/vet/build in GitHub Actions.**

### Task 3: Build authenticated in-memory WebSocket hub

**Files:**
- Create: `services/market-realtime-worker/internal/relay/protocol.go`
- Create: `services/market-realtime-worker/internal/relay/hub.go`
- Create: `services/market-realtime-worker/internal/relay/server.go`
- Create: `services/market-realtime-worker/internal/relay/hub_test.go`
- Create: `services/market-realtime-worker/internal/relay/server_test.go`

**Interfaces:**
- Produces: `NewHub(epoch string, sendQueue int, logger *slog.Logger) *Hub`
- Produces: `(*Hub).SetUniverse(symbols []string)`
- Produces: `(*Hub).Publish(topic string, message any)` (non-blocking with bounded per-client queues)
- Produces: `NewServer(cfg Config, hub *Hub, logger *slog.Logger) *Server`
- Produces: `(*Server).Run(ctx context.Context) error`

- [ ] **Step 1: Add RED hub tests** proving topic isolation, exact canonical-symbol validation, one client can subscribe to `market` + one orderbook topic, unsubscribe works, and full send queue causes slow-consumer removal rather than publisher blocking.
- [ ] **Step 2: Add RED HTTP/WebSocket tests** with `httptest.Server`: disallowed Origin rejected before upgrade; first frame must be `auth`; expired/bad tokens rejected; valid auth gets `{type:"ready",protocol:1}`; subscribe before auth closes; invalid/universe-external topic returns sanitized error.
- [ ] **Step 3: Implement protocol structs** for `auth`, `subscribe`, `unsubscribe`, `ready`, `subscribed`, `market`, `orderbook`, and sanitized `error` messages.
- [ ] **Step 4: Implement Hub** with `map[string]map[*client]struct{}` topic index, bounded send channel per client, and metrics counters. Publishing must encode once then enqueue without blocking.
- [ ] **Step 5: Implement Server** using gorilla/websocket origin gate, 5-second auth deadline, one reader + one writer goroutine per client, control ping/pong deadlines, payload/read limits, graceful context shutdown, and no token logging.
- [ ] **Step 6: Verify race-safe behavior through Go tests/vet/build in Actions.**

### Task 4: Integrate relay into worker hot path and make Supabase persistence asynchronous

**Files:**
- Create: `services/market-realtime-worker/internal/realtime/symbol_orderbook_buffer.go`
- Create: `services/market-realtime-worker/internal/realtime/symbol_orderbook_buffer_test.go`
- Create: `services/market-realtime-worker/internal/worker/checkpoint_writer.go`
- Create: `services/market-realtime-worker/internal/worker/checkpoint_writer_test.go`
- Modify: `services/market-realtime-worker/internal/worker/run.go`
- Modify: `services/market-realtime-worker/internal/supabase/client.go`

**Interfaces:**
- Produces `SymbolOrderbookBuffer.Push(frame Frame)`, `DrainReady() map[string]OrderbookBatch`, `MarkContinuityGapAll()` with latest-wins `t/q/f/e` and ordered `te` semantics per symbol.
- Produces `CheckpointWriter.Submit(stream string, sequence int64, frames []map[string]any)` where submit never waits on network I/O and each stream retains only the newest pending checkpoint while one write is active.
- Relay messages use one worker opaque epoch; `market` sequence monotonic per epoch; orderbook sequence monotonic per symbol per epoch.

- [ ] **Step 1: Add RED symbol-buffer tests** proving exact-symbol separation, state coalescing, execution ordering, bounded execution queue/continuity gap, and payload cap without O(n²) whole-batch remarshal.
- [ ] **Step 2: Add RED checkpoint writer tests** with a blocked fake writer proving relay/publisher calls proceed and later submissions coalesce to newest recovery state.
- [ ] **Step 3: Start Hub/Server at worker startup.** Generate opaque epoch from `crypto/rand`; set canonical universe; shutdown with worker context.
- [ ] **Step 4: Add a separate 100 ms `marketRelayBuffer`.** Push tick/index frames into both existing checkpoint buffer and relay buffer. Relay drain publishes `{type:"market",epoch,sequence,publishedAt,frames}` directly to topic `market`.
- [ ] **Step 5: Add per-symbol 50 ms orderbook relay buffer.** Push canonical `t` plus supplemental `q/f/e/te`; drain publishes one `{type:"orderbook",symbol,epoch,sequence,publishedAt,continuityGap,frames}` to `orderbook:<SYMBOL>`.
- [ ] **Step 6: Remove Supabase private Broadcast from the member live path.** `PublishPrivateBroadcast` must no longer be called by `Run`; existing `market_realtime_bus` rows remain checkpoint/recovery storage.
- [ ] **Step 7: Route all checkpoint writes through asynchronous `CheckpointWriter`.** A timeout/429/5xx can update logs/metrics but cannot block relay flush tickers.
- [ ] **Step 8: On universe refresh, call `hub.SetUniverse(next)` before accepting new subscriptions and propagate continuity gaps for affected live orderbook data.
- [ ] **Step 9: Add heartbeat fields for relay clients/subscriptions/slow-consumer closes and checkpoint lag/errors without logging topology or secrets.
- [ ] **Step 10: Verify Realtime Worker unit tests/vet/binary/container jobs in GitHub Actions.**

### Task 5: Add singleton browser relay transport

**Files:**
- Create: `modules/market/realtime/relay-client.ts`
- Create: `tests/market-realtime-relay-client.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `subscribeMarketRelay(topic: "market" | `orderbook:${string}`, onMessage, onState): () => void`
- Physical connection count: at most one per browser tab/module instance.

- [ ] **Step 1: Add RED browser transport contracts** asserting one module-level `WebSocket`, token fetched from `/api/market/realtime-token`, token sent inside `{type:"auth"}` only after socket open, URL comes only from `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL`, and token never appears in the constructor URL.
- [ ] **Step 2: Add RED multiplex contracts** for reference-counted topic subscriptions, resubscribe after `ready`, unsubscribe when final listener leaves, and no reconnect when there are no listeners.
- [ ] **Step 3: Implement singleton state machine** `CLOSED -> CONNECTING -> AUTHENTICATING -> READY`, bounded exponential reconnect with jitter, fresh token for every physical connection, stale/online/visibility recovery, and shared subscriber maps.
- [ ] **Step 4: Parse only protocol-v1 `market`/`orderbook`/`ready`/`error` frames.** Unknown/malformed server data must not crash the app.
- [ ] **Step 5: Record internal receive timestamps for latency telemetry; do not render topology/member-visible diagnostics.
- [ ] **Step 6: Verify TypeScript/contracts in GitHub Actions.**

### Task 6: Cut Market Board and Orderbook adapters to the relay

**Files:**
- Modify: `modules/market/providers/dnse/market-stream.ts`
- Modify: `modules/market/providers/dnse/orderbook-stream.ts`
- Modify: `tests/market-board-visual-contract.test.ts`
- Modify: `tests/dnse-request-windows.test.ts`
- Modify: `tests/orderbook-clustering-cache.test.ts`

**Interfaces:**
- Preserve existing exported Market Board listener/state API.
- Preserve `subscribeDnseOrderbookFrames(symbol, onFrame, onState)` API consumed by `LiveOrderBookPanel`.
- Supabase reads may remain for initial checkpoint/bootstrap only; no Supabase Realtime channel may remain on the live path.

- [ ] **Step 1: Add RED contracts** asserting Market Board no longer creates `postgres_changes` realtime channels and Orderbook no longer creates private Broadcast channels.
- [ ] **Step 2: Market Board adapter:** bootstrap existing `dnse-market` row once, then subscribe to relay `market`; synthetic OHLC compatibility and current reducer behavior stay unchanged.
- [ ] **Step 3: Orderbook adapter:** bootstrap the current shard checkpoint once for recovery compatibility, then subscribe to `orderbook:<SYMBOL>` relay messages and filter/validate exact symbol.
- [ ] **Step 4: Implement continuity rules:** first relay batch establishes baseline; changed epoch, sequence gap, explicit continuity gap, socket recovery, stale visibility/network resume -> state `RECOVERING` and authoritative bootstrap before returning to `LIVE`.
- [ ] **Step 5: Ensure no fallback to browser-direct provider WebSocket or Supabase Realtime hot path exists.
- [ ] **Step 6: Preserve `REALTIME LIVE` member copy and verify no backend/provider topology text is introduced.
- [ ] **Step 7: Verify current contracts, touched lint, typecheck and production build through GitHub Actions.**

### Task 7: Source-controlled UpCloud deployment boundary and active docs

**Files:**
- Modify: `services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml`
- Modify: `services/market-realtime-worker/.env.example`
- Create: `services/market-realtime-worker/deploy/upcloud/realtime-proxy.example.conf`
- Modify: `services/market-realtime-worker/README.md`
- Modify: `docs/market-board.md`
- Modify: `docs/HANDOVER.md`
- Modify: `tests/dnse-request-windows.test.ts`

**Interfaces:**
- Container relay `:8787` publishes only as `127.0.0.1:8787:8787` on the host.
- Public TLS/WSS termination is reverse-proxy/DNS configuration, not a direct container public bind.

- [ ] **Step 1: Add RED deployment contract** asserting loopback-only port binding and no `0.0.0.0`/bare public port mapping.
- [ ] **Step 2: Add reverse-proxy example** with WebSocket Upgrade headers and no secret/token logging; use placeholder hostname only.
- [ ] **Step 3: Update worker README and active architecture docs** to state hot path `worker -> authenticated WSS -> browser` and Supabase checkpoint-only recovery role.
- [ ] **Step 4: Add production rollout checklist**: provision identical signing secret in Vercel server + worker env, configure allowed origin, set `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL`, provision TLS/DNS reverse proxy, restart worker, then deploy browser cutover.
- [ ] **Step 5: Explicitly state remote production activation is not performed by source merge alone.
- [ ] **Step 6: Verify docs/contracts and secret scan in GitHub Actions.**

### Task 8: Final review, CI and rollout handoff

**Files:**
- Review all files changed by QEO-225.
- Update: PR #499 body and Linear QEO-225 status/evidence.

**Interfaces:**
- Produces a merge-ready source release; production WSS activation remains a separate authorized runtime operation.

- [ ] **Step 1: Review diff** for token leakage, URL leakage beyond public WSS hostname, goroutine lifecycle, unbounded queues, race-prone maps, silent execution loss, and accidental managed-Realtime fallback.
- [ ] **Step 2: Require green exact-head GitHub Actions:** Verify/current contracts/lint/typecheck/build plus Realtime Worker unit/vet/binary/container jobs.
- [ ] **Step 3: Close/supersede PR #498 if its Supabase Broadcast-specific implementation is no longer applicable; port only generic performance work actually needed by QEO-225.
- [ ] **Step 4: Update PR #499 from design-only draft to implementation PR and attach it to QEO-225.
- [ ] **Step 5: Do not claim production acceptance until remote rollout has WSS TLS/DNS/env configured and live-session p50/p95/p99 is measured against broker/provider tape.
