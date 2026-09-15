# QEO-225 Authenticated UpCloud WebSocket Relay Design

Date: 2026-09-15

## Goal

Move Market Board and popup Orderbook live delivery off Supabase Realtime and onto a single authenticated WebSocket relay owned by the existing UpCloud Go realtime worker.

The target hot path is:

```text
provider WebSocket
  -> UpCloud Go worker
  -> in-memory relay hub
  -> authenticated WSS
  -> browser
```

Supabase remains the durable bootstrap/recovery/checkpoint authority, but it is not part of member-facing tick/depth/execution delivery:

```text
UpCloud worker
  -> async Supabase checkpoint/snapshot
  -> browser bootstrap/recovery only
```

The member UI must not expose provider names, provider credentials, UpCloud host identity, Supabase topology, server IPs, or secret-bearing URLs.

## Why this replaces the current fanout

Current production live transport has two independent managed-Realtime hot paths:

- Market Board consumes `market_realtime_bus` through Supabase `postgres_changes`.
- Popup Orderbook consumes private Supabase Broadcast shards plus Supabase checkpoints for recovery.

That architecture centralizes provider ownership, but it also makes live latency and scaling depend on managed Realtime message accounting and inserts network I/O between provider ingress and browser delivery. QEO-224 additionally found synchronous Broadcast/checkpoint work and repeated payload serialization on the worker path.

QEO-225 removes Supabase Realtime from the hot path entirely. The browser receives live deltas directly from the centralized worker while existing Supabase persistence stays available for bootstrap and continuity recovery.

## Scope

QEO-225 covers the transport architecture for both realtime consumers:

1. Market Board live tick/index updates.
2. Popup Orderbook tick/depth/execution/foreign/auction updates.
3. Browser authentication, multiplexed subscriptions, reconnect and continuity handling.
4. Worker in-memory fanout, backpressure and low-latency telemetry.
5. Source-controlled UpCloud runtime configuration needed to expose a loopback relay listener.
6. Documentation and deterministic contract/unit tests.

Production DNS/TLS/reverse-proxy activation is a rollout step and requires explicit remote-machine authorization. Source implementation must not assume a specific DNS provider or expose the UpCloud origin IP to the browser application source.

## Explicit non-goals

QEO-225 does not:

- move provider credentials into the browser;
- remove Supabase Auth, database, snapshots, checkpoints, or session APIs;
- introduce Redis, NATS, Kafka, or another message broker for a single-node worker;
- guarantee durable replay of every provider event across arbitrary worker crashes;
- change Market Board visible paint cadence or Orderbook reducer semantics merely to make the transport faster;
- make the public relay hostname member-facing product copy;
- add per-user provider sockets.

## Architecture decision

### Recommended and approved approach: one Go process, one in-memory hub

The existing `market-realtime-worker` remains the sole owner of provider sockets. A new relay package inside the same Go process accepts browser WebSocket connections and fans out provider-derived batches from memory.

There is no internal Redis/NATS hop. This keeps latency, failure modes and operational cost low while the runtime is single-node.

```text
                    +---------------- Market Board subscriber(s)
provider sockets -> | Go worker + hub |
                    +---------------- Orderbook subscriber(s)
                              |
                              +---- async Supabase checkpoints
```

If QeoIndex later runs multiple relay nodes, a broker can be introduced behind the same hub interface without changing the browser protocol.

### Rejected alternative: keep Supabase Realtime and upgrade capacity

This is operationally simpler but retains managed message-rate dependence and an extra network hop on the critical path. It does not meet the chosen objective of making hot-path latency independent of Supabase Realtime tier.

### Rejected alternative: Redis/NATS now

A broker is unnecessary while provider ownership and relay execution are on one UpCloud node. It adds another process, queue, failure mode and deployment surface without solving a current multi-node problem.

## Browser connection model

A browser tab owns at most one relay connection. Domain consumers multiplex logical topics over that connection.

Supported logical subscriptions in v1:

- `market`
- `orderbook:<UPPERCASE_SYMBOL>`

Examples:

```text
Market Board mounts     -> subscribe market
Open MSN Orderbook      -> subscribe orderbook:MSN
Switch MSN -> FPT       -> unsubscribe orderbook:MSN; subscribe orderbook:FPT
Close Orderbook         -> unsubscribe orderbook:FPT
Board + popup together  -> still one physical WebSocket
```

The connection is owned by a narrow singleton browser transport module. Market Board and Orderbook adapters remain separate domain modules and must not share reducer/state internals.

## Authentication design

### Token minting

Add `POST /api/market/realtime-token` in the Next.js app.

The route must:

1. require the existing `market_board` feature with `requireApiFeature("market_board")`;
2. enforce same-origin request semantics;
3. require a server-only `QEO_MARKET_REALTIME_SIGNING_SECRET`;
4. mint a compact HMAC-SHA256 token with claims:
   - `v = 1`
   - `sub = authenticated user id`
   - `aud = qeo-market-realtime`
   - `iat = Unix seconds`
   - `exp <= iat + 60 seconds`
5. return only `{ ok, token, expiresAt }` with `Cache-Control: no-store`.

The token is a relay capability token, not a provider token and not a Supabase service credential.

To avoid introducing a new JavaScript dependency, token encoding/verification uses platform standard libraries:

```text
base64url(JSON claims) + "." + base64url(HMAC_SHA256(claimsPart, sharedSecret))
```

The Go relay verifies the same format with `crypto/hmac` + `crypto/sha256` and rejects invalid signature, audience, version or expiry.

### Token transport

The token must never appear in the WebSocket URL/query string.

Connection flow:

```text
browser fetches short-lived token
browser opens configured wss:// endpoint
browser immediately sends { type: "auth", token }
relay verifies token
relay sends { type: "ready", protocol: 1, epoch, serverTime }
only then may browser subscribe
```

Unauthenticated sockets have a 5-second auth deadline. Any `subscribe` before successful auth is rejected and the socket is closed.

### Origin policy

The relay has an explicit `QEO_MARKET_REALTIME_ALLOWED_ORIGINS` comma-separated allowlist. Production startup fails if the allowlist is empty.

The HTTP upgrade checks `Origin` before accepting the socket. Local-development origins are only permitted through explicit development configuration; there is no wildcard production origin.

## Public endpoint and deployment boundary

The worker adds an HTTP/WebSocket listener controlled by:

- `QEO_MARKET_REALTIME_LISTEN_ADDR`, default `:8787` inside the container;
- `QEO_MARKET_REALTIME_PUBLIC_URL`, consumed by the browser build as the public WSS endpoint only;
- `QEO_MARKET_REALTIME_ALLOWED_ORIGINS`;
- `QEO_MARKET_REALTIME_SIGNING_SECRET`.

The UpCloud compose publishes the relay only to a loopback host binding, for example:

```text
127.0.0.1:8787 -> container:8787
```

TLS termination and the public DNS name sit in front of that loopback listener. The implementation must not hard-code the UpCloud IP or a specific DNS vendor.

The source tree may include a deployment runbook/template for the reverse proxy, but production activation is performed only with explicit remote authorization. The browser source sees only the configured public WSS URL.

## Relay protocol v1

All application frames are JSON. Protocol messages are deliberately small and versioned.

### Browser -> server

Authenticate:

```json
{ "type": "auth", "token": "<short-lived token>" }
```

Subscribe:

```json
{ "type": "subscribe", "topics": ["market", "orderbook:MSN"] }
```

Unsubscribe:

```json
{ "type": "unsubscribe", "topics": ["orderbook:MSN"] }
```

Application pong is unnecessary because WebSocket control ping/pong is handled by the connection layer.

### Server -> browser

Ready:

```json
{
  "type": "ready",
  "protocol": 1,
  "epoch": "<worker-start-id>",
  "serverTime": "2026-09-15T04:30:00.000Z"
}
```

Subscription acknowledgement:

```json
{ "type": "subscribed", "topics": ["market", "orderbook:MSN"] }
```

Market batch:

```json
{
  "type": "market",
  "epoch": "<worker-start-id>",
  "sequence": 18292,
  "publishedAt": "2026-09-15T04:30:00.100Z",
  "frames": []
}
```

Orderbook batch:

```json
{
  "type": "orderbook",
  "symbol": "MSN",
  "epoch": "<worker-start-id>",
  "sequence": 8831,
  "publishedAt": "2026-09-15T04:30:00.120Z",
  "continuityGap": false,
  "frames": []
}
```

Error:

```json
{ "type": "error", "code": "INVALID_TOPIC", "message": "Subscription rejected." }
```

Error messages must not include provider names, credentials, host paths or secret-bearing details.

## Topic authorization and validation

Authenticated `market_board` users may subscribe to:

- the single `market` topic;
- `orderbook:<symbol>` only when `<symbol>` belongs to the current canonical universe loaded by the worker.

The relay does not accept arbitrary topic names and does not expose a generic publish operation to browsers.

Subscription count is bounded per connection. v1 permits `market` plus a small fixed number of orderbook topics; the UI normally uses one orderbook topic at a time. A malicious authenticated client cannot subscribe to an unbounded topic set.

## Worker integration

### Market Board live path

Provider tick/index ingress already flows through `onTickFrame` / `onBoardFrame` before the 1 Hz Supabase checkpoint drain.

QEO-225 adds a separate in-memory market relay buffer. It is independent of `market_realtime_bus` checkpoint cadence.

Semantics:

- state-like market frames are latest-wins by existing `(T, symbol/index)` identity;
- relay flush target: 100 ms by default;
- one encoded market batch is broadcast to current `market` subscribers;
- no Supabase network call is awaited before relay publish.

The existing 1 Hz `dnse-market` row remains a bounded recovery/current-state checkpoint until a later issue proves it can be simplified.

### Orderbook live path

Orderbook ingress keeps the existing semantics:

- `t`, `q`, `f`, `e` are latest-wins state frames inside the pending window;
- `te` execution frames remain ordered and are never latest-wins coalesced;
- provider continuity gaps are surfaced explicitly.

The relay uses per-symbol pending batches rather than Supabase shard delivery. Default flush target is 50 ms, configurable within a safe bounded range.

The relay does not need ten browser fanout shards because subscriptions are in-memory by exact symbol. Provider socket sharding remains unchanged and still protects upstream channel membership limits.

Each symbol has a monotonic relay sequence inside the worker epoch. A browser only compares continuity for symbols it actually subscribes to.

### Checkpoint path

Supabase persistence is strictly asynchronous relative to live delivery.

Checkpoint writes may run at their existing cadence or a slower bounded cadence suitable for recovery. A checkpoint timeout, 429 or 5xx must not delay or pause WebSocket fanout.

QEO-224's linear payload sizing and asynchronous checkpoint principles remain valid and should be reused where applicable. Supabase private Broadcast-specific code becomes unnecessary after the browser cutover.

## Hub and connection lifecycle

The relay package owns:

- client registration/unregistration;
- auth state;
- topic subscription sets;
- topic -> client indexes;
- one bounded send queue per connection;
- one writer goroutine per connection;
- one reader goroutine per connection;
- ping/pong and deadlines;
- server shutdown.

### Backpressure

Every client send queue is bounded.

The server must not block provider/relay publisher goroutines on a slow browser. If a client's queue is full, the client is closed as a slow consumer with an appropriate retryable close code. The browser then re-authenticates, rehydrates authoritative snapshot/checkpoint state and reconnects.

Ordered execution messages are never silently dropped to keep a slow socket alive.

### Ping/pong

The server sends WebSocket control pings on a bounded interval and requires pong/read progress. Dead connections are removed promptly so they do not retain subscription memory.

### Graceful shutdown

Worker cancellation:

1. stops accepting new relay connections;
2. sends a going-away close to active clients where practical;
3. stops relay flushers;
4. stops provider sockets;
5. waits for bounded goroutines;
6. exits before the existing systemd/docker stop timeout.

## Browser transport

Add a shared relay transport module under the market realtime/provider boundary. It owns the single physical WebSocket and exports subscription APIs, not React state.

Responsibilities:

- fetch short-lived relay token;
- open the configured public WSS URL;
- authenticate as the first application message;
- multiplex topic subscriptions;
- reconnect with bounded exponential backoff + jitter;
- re-fetch a fresh token for every new physical connection;
- expose connection state and parsed protocol messages to domain adapters;
- close on explicit logout/dispose when no consumers remain.

### Market Board adapter

`modules/market/providers/dnse/market-stream.ts` stops using Supabase `postgres_changes` as its live source.

It keeps its existing exported listener/state interface so `LiveMarketBoard` does not need a domain rewrite. Initial/current-state bootstrap may continue to use the existing Supabase row/API path, then relay `market` batches provide live deltas.

### Orderbook adapter

`modules/market/providers/dnse/orderbook-stream.ts` stops joining Supabase private Broadcast topics.

It subscribes to `orderbook:<symbol>` through the shared relay transport while preserving existing frame listener and stream-state behavior.

Snapshot/session recovery remains authoritative on startup and after continuity gaps.

## Continuity and recovery

The worker generates a new opaque `epoch` at process start.

Market sequences are monotonic per epoch. Orderbook sequences are monotonic per symbol per epoch.

Browser recovery is triggered by any of:

- worker epoch change;
- sequence gap after a live baseline has been established;
- relay socket close/error/timeout;
- slow-consumer close;
- tab/network resume after the configured stale threshold;
- explicit `continuityGap` from provider/worker state.

Recovery behavior:

1. mark domain state `RECOVERING`/`CONNECTING`, not false `LIVE`;
2. rehydrate the existing authoritative snapshot/session/current-state endpoint;
3. obtain a fresh relay token;
4. reconnect and re-subscribe;
5. establish a new live baseline;
6. return to `LIVE` only after receiving valid current-epoch data.

A recovery failure never falls back to browser-direct provider WebSocket or Supabase Realtime hot-path delivery.

## Performance budget

Target production transport budget during an active session:

- orderbook/trades provider-event -> browser receive p95 < 300 ms;
- worker relay queue time p95 < 100 ms;
- normal market relay publish interval <= 100 ms;
- normal orderbook relay publish interval <= 50 ms;
- no checkpoint network request on the relay critical path.

The browser's existing bounded React paint cadence is measured separately. A 250 ms UI commit policy may make the visible board paint later than WebSocket receive even when relay transport is healthy; telemetry must distinguish those stages.

## Telemetry

Internal logs/telemetry should capture without exposing topology in member UI:

- active relay connections;
- authenticated connection count;
- subscriptions per topic class;
- outbound batch count/bytes;
- slow-consumer disconnect count;
- reconnect/auth failure count;
- provider receive -> relay publish latency;
- relay publish -> browser receive latency when browser samples are available;
- p50/p95/p99 end-to-end measurements used during acceptance.

Provider credential values, relay tokens and signing-secret values must never be logged.

## Configuration

### UpCloud worker environment

New required production keys:

```text
QEO_MARKET_REALTIME_SIGNING_SECRET=<server-only shared secret>
QEO_MARKET_REALTIME_ALLOWED_ORIGINS=https://qeoindex.qeoqeo.com
```

New bounded settings:

```text
QEO_MARKET_REALTIME_LISTEN_ADDR=:8787
QEO_MARKET_REALTIME_AUTH_TIMEOUT_MS=5000
QEO_MARKET_REALTIME_PING_MS=15000
QEO_MARKET_REALTIME_SEND_QUEUE=64
QEO_MARKET_REALTIME_MARKET_FLUSH_MS=100
QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS=50
```

### Vercel server environment

Required server-only key:

```text
QEO_MARKET_REALTIME_SIGNING_SECRET=<same value as worker>
```

Public build/runtime configuration:

```text
NEXT_PUBLIC_MARKET_REALTIME_WS_URL=wss://<configured-public-relay-host>
```

The public URL is transport configuration, not a product-facing source label.

## Resource model

The relay is expected to fit the existing single-node Go worker model for the current member scale, but QEO-225 does not assume the existing 0.75 CPU / 384 MB limits are sufficient under all load.

Acceptance must measure:

- worker CPU;
- worker RSS;
- active connection count;
- outbound bytes/sec;
- send-queue pressure;
- p95/p99 latency.

Resource limits are increased only if measurement shows pressure after Supabase hot-path removal and O(n^2) payload work is removed. RAM is not increased pre-emptively.

## Source files expected to change

The implementation should stay close to existing boundaries.

Worker:

- `services/market-realtime-worker/internal/config/config.go`
- `services/market-realtime-worker/internal/relay/*` (new focused package)
- `services/market-realtime-worker/internal/worker/run.go`
- `services/market-realtime-worker/cmd/market-realtime-worker/main.go` only if lifecycle wiring requires it
- `services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml`
- `services/market-realtime-worker/.env.example`
- `services/market-realtime-worker/README.md`

Browser/server:

- `app/api/market/realtime-token/route.ts` (new)
- `modules/market/realtime/relay-token.ts` or equivalent server-only signer (new)
- `modules/market/realtime/relay-client.ts` (new browser singleton)
- `modules/market/providers/dnse/market-stream.ts`
- `modules/market/providers/dnse/orderbook-stream.ts`

Tests/docs:

- focused Go relay/auth/hub tests;
- existing DNSE/realtime contract tests;
- market-board visual/transport contract tests;
- auth API contract tests;
- `docs/market-board.md` and `docs/HANDOVER.md` because this is a material active-architecture change.

Do not rewrite the historical QEO-216/QEO-224 specs to make them look current. They remain historical decision records.

## TDD strategy

Implementation proceeds boundary by boundary with failing tests first.

### 1. Relay token contract

RED tests prove:

- unauthorized/feature-disabled requests cannot mint a token;
- token TTL is <= 60 seconds;
- no token appears in a WebSocket URL;
- signer/verifier reject tampered, expired, wrong-version and wrong-audience tokens.

Then implement the server signer and Go verifier.

### 2. Hub auth/subscription contract

RED Go tests prove:

- origin rejection;
- auth timeout;
- no subscription before auth;
- only `market` and canonical `orderbook:<symbol>` topics are accepted;
- duplicate subscribe/unsubscribe is idempotent;
- slow client cannot block publisher;
- bounded queue overflow closes rather than silently loses ordered data.

### 3. Worker publish contract

RED tests prove:

- provider ingress can reach relay subscribers without waiting for Supabase checkpoint I/O;
- market latest-wins coalescing remains bounded;
- orderbook state/execution ordering semantics remain correct;
- per-symbol sequence and epoch behavior is deterministic;
- continuity gaps are surfaced.

### 4. Browser singleton contract

RED TypeScript/static contract tests prove:

- one physical WebSocket is reused by Market Board + Orderbook subscriptions;
- fresh token is fetched before each connection;
- token is sent as first application message and never appended to URL;
- reconnect replays logical subscriptions only after `ready`;
- domain adapters no longer create Supabase Realtime live subscriptions.

### 5. Recovery contract

RED tests prove epoch/sequence gaps and socket failures enter recovery and use existing authoritative snapshot/session paths before returning to live.

### 6. Documentation/deployment contract

Static tests prove:

- compose exposes only loopback host binding for the relay listener;
- no provider or infrastructure topology labels reappear in member UI;
- active docs describe WSS hot path + Supabase recovery path.

## QEO-224 / PR #498 relationship

PR #498 is an in-progress attempt to reduce latency while keeping Supabase Realtime as the browser transport. QEO-225 changes that architectural assumption.

Before implementation merge, PR #498 must be reconciled deliberately:

- retain/reimplement useful transport-independent work such as linear payload sizing, async checkpoint principles and latency telemetry;
- do not merge Supabase Broadcast-specific browser complexity solely because it already exists on that branch;
- avoid two concurrent implementations of the same low-latency path.

The final live transport source of truth after QEO-225 is direct authenticated WSS, not Supabase private Broadcast/postgres_changes.

## Production rollout

Source merge alone does not complete QEO-225.

Rollout gates:

1. exact implementation head is green in GitHub Actions;
2. Vercel production deployment is READY;
3. remote-machine work is explicitly authorized for this rollout;
4. worker binary/image with relay listener is deployed on UpCloud;
5. server-only signing secret is provisioned identically in Vercel and UpCloud without logging it;
6. a public TLS WSS hostname is configured to the loopback relay listener through the chosen reverse-proxy/DNS setup;
7. browser connects with no mixed-content, origin or auth errors;
8. DevTools proves no browser-direct provider socket and no Supabase Realtime live Market Board/Orderbook subscription;
9. Supabase checkpoint failure is induced or simulated and does not delay live WSS delivery;
10. MSN plus high-activity symbols are compared against the broker/provider tape and p50/p95/p99 are recorded;
11. multiple browsers do not increase upstream provider socket count;
12. reconnect, worker restart and continuity-gap recovery are accepted;
13. host CPU/RAM/network/send-queue pressure remain inside safe bounds.

## Success criteria

QEO-225 is complete when:

- Market Board and Orderbook use the shared authenticated WSS relay for live updates;
- Supabase Realtime message-rate limits no longer constrain live fanout;
- Supabase remains recovery/persistence only;
- no provider/infrastructure secret or topology is exposed to members;
- p95 active-session orderbook provider-event -> browser-receive latency is < 300 ms under accepted production load;
- slow consumers and transport gaps fail closed into recovery rather than silently losing ordered execution data;
- active architecture docs and production evidence match the deployed system.
