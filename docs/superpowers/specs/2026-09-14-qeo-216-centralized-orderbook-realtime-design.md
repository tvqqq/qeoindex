# QEO-216 Centralized Orderbook Realtime Design

## Goal

Remove browser-direct DNSE WebSocket connections from the popup orderbook and move the full live orderbook contract behind the existing UpCloud realtime worker plus authenticated Supabase Realtime fanout, while guaranteeing at least 100 simultaneously viewed unique tickers without multiplying provider connections per user.

## Current problem

`components/orderbook/live-orderbook-panel.tsx` currently authenticates through `/api/market/stream-auth`, receives the DNSE WebSocket URL and auth payload, opens `new WebSocket(authJson.url)` in the browser, and subscribes per popup symbol to five feeds: `tick.G1.json`, `top_price.G1.json`, `tick_extra.G1.json`, `ohlc.1.json`, and `foreign.G1.json`.

This means browser concurrency multiplies DNSE provider connections. QEO-175/QEO-196 intentionally centralized only the canonical Market Board path and left the popup orderbook direct because its depth, execution and foreign-flow semantics require a larger bounded fanout design.

## Approved architecture

QEO-216 extends the existing UpCloud Go realtime worker. The browser never connects to DNSE after cutover.

`DNSE WS → UpCloud Go worker → bounded orderbook fanout → authenticated Supabase Realtime → Vercel browser`

The existing Market Board `market_realtime_bus` contract remains stable unless a narrowly scoped checkpoint extension is required. No public UpCloud application port is introduced.

### Provider sockets and capacity

Production ownership is fixed and independent of browser/user count:

- Socket 1: existing `tick.G1.json` for the canonical stock universe, maximum 200 symbols.
- Socket 2: existing four `market_index.*` channels.
- Sockets 3–6: four deterministic orderbook supplemental shards.

Each supplemental shard carries only:

- `top_price.G1.json`
- `tick_extra.G1.json`
- `foreign.G1.json`

`ohlc.1.json` is not duplicated. Popup mini-chart compatibility is synthesized from the canonical tick stream, matching the centralized Market Board direction.

The approved supplemental budget is 50 symbols × 3 channel memberships = 150 memberships per socket, leaving headroom under the known `normalUser` 200-membership provider limit. A canonical 200-symbol universe therefore fits into four supplemental sockets and six total DNSE sockets.

The design guarantees at least 100 simultaneously viewed unique tickers because the upstream universe is already bounded and subscribed server-side. One or one thousand users viewing the same symbol do not create extra DNSE sockets.

### Provider capacity production gate

DNSE public documentation does not establish the maximum concurrent WebSocket connections per API key/account. Therefore six sockets is a design target, not an assumed entitlement.

Production cutover must fail closed until the same production DNSE API key has successfully authenticated and subscribed concurrently on all six sockets. The worker must not respond to provider limits by opening unbounded replacement sockets or entering a reconnect storm. If the account-wide connection limit is below six, production rollout stops until DNSE quota/tier is changed or the architecture is revised.

## Supabase fanout

The worker publishes to ten stable private Broadcast shards:

- `orderbook:v1:00`
- `orderbook:v1:01`
- ...
- `orderbook:v1:09`

A symbol maps deterministically to exactly one shard through a stable hash. The mapping must not depend on browser identity or runtime subscriber count.

Default orderbook fanout cadence is 500 ms (2 Hz). The worker batches frames per shard and caps individual payloads below the Supabase Broadcast payload ceiling; implementation should target a conservative ~192 KiB payload split threshold.

The browser subscribes only to the shard for its symbol and filters frames by exact uppercase symbol. It must not receive DNSE auth material or provider URLs.

### Supabase capacity gate

Realtime accounting is based on messages delivered to clients, not merely producer sends. For the approved 100 concurrent unique-popup target, a 2 Hz fanout produces roughly 200 client deliveries/sec plus producer sends. Existing Market Board realtime traffic also consumes quota.

Production cutover therefore requires an effective Supabase Realtime budget of at least 500 events/sec. If the configured project limit is lower, QEO-216 must not claim the 100-user guarantee and rollout must stop until capacity is increased or measured architecture is revised.

## Frame contract

The worker preserves DNSE frame semantics rather than normalizing away information required by the current popup reducer.

### Current-state frames

The following are latest-wins within a flush window, keyed by `(T, symbol)`:

- `t`: current quote/tick state;
- `q`: top-price/depth state;
- `f`: foreign-flow state.

Dropping superseded frames of these types inside a batch window is acceptable because consumers require the newest state.

### Execution frames

`te` is an ordered event stream and must never use latest-wins coalescing. Every healthy-path execution frame is appended in arrival order and delivered in order within the shard batch.

Provider identifiers are preferred in the same order used by the current popup logic:

1. `transId`
2. `tradeId`
3. `sequence`
4. `seqNo`
5. `id`

If none is present, the worker may attach a transport-local monotonic fallback identity. It must not deduplicate solely by `(time, price, volume, side)`, because two valid executions may share those values.

The browser keeps the current session trade semantics, including the existing high per-session trade cap and stable merge/deduplication behavior.

## Batch envelope and continuity

Each Broadcast payload uses a versioned envelope conceptually equivalent to:

```json
{
  "version": 1,
  "shard": 4,
  "sequence": 18291,
  "publishedAt": "2026-09-14T03:40:00.000Z",
  "frames": []
}
```

`sequence` is monotonic per shard. Consumers use it to distinguish continuous delivery from a transport gap.

A successful publish advances the shard's committed sequence. Failed publishes do not silently advance continuity state.

## Buffering and no-silent-loss policy

QEO-216 does not promise transactional zero-loss across arbitrary network outages because Supabase Broadcast is not a durable event log. It does require no silent loss.

- `t`, `q`, and `f` can collapse to newest state while waiting for retry.
- `te` executions remain in an ordered bounded retry queue.
- publish failures use bounded exponential backoff with jitter;
- the queue has an explicit memory bound so provider disruption cannot OOM the worker;
- if the queue must truncate or the worker restarts before delivery, the next successful payload exposes an epoch/continuity discontinuity rather than pretending the stream remained complete.

Any continuity discontinuity forces browser recovery before returning to healthy LIVE state.

## Snapshot and recovery authority

QEO-216 reuses the existing orderbook snapshot/session path instead of building a second durable execution log.

Initial popup hydration continues to use the existing session/Supabase snapshot path. Realtime Broadcast supplies live deltas after hydration.

When the browser detects any of the following:

- missing/non-contiguous shard sequence;
- channel timeout/error/closure;
- worker epoch discontinuity;
- visibility/network resume after a stale interval;

it enters `RECOVERING`, refreshes the existing session/snapshot authority, merges trades using stable IDs, then rejoins through the same authenticated Realtime startup path.

A Supabase or fanout failure must never fall back to a browser-direct DNSE WebSocket. The UI remains on last-known snapshot/current state and clearly reports `RECOVERING`, `STALE`, or `ERROR` until the centralized path recovers.

## Realtime authentication lifecycle

QEO-216 must inherit the QEO-196 production hotfix ordering. A server-authenticated page can render before the browser Supabase session has hydrated, so private/authenticated Realtime must never join optimistically as anon.

Every initial join and every restart/rejoin path follows this order:

1. obtain the singleton browser Supabase client;
2. `await supabase.auth.getSession()`;
3. require a valid `session.access_token`;
4. `await supabase.realtime.setAuth(session.access_token)`;
5. only then perform authenticated snapshot/bootstrap work and subscribe to the private Broadcast shard;
6. if auth/session startup fails, reset startup guards so retry remains possible;
7. token refresh, visibility recovery, network recovery and manual reconnect all pass through the same auth gate.

No `.subscribe()` call may occur before `realtime.setAuth()` for this transport.

The implementation should prefer a shared authenticated-Realtime startup helper/state boundary instead of copying the QEO-196 ordering independently into Market Board and Orderbook code. The shared unit must remain narrow enough not to couple the two domain reducers or channel contracts.

## Browser contract

After cutover, `LiveOrderBookPanel` keeps its current domain/reducer behavior but changes transport ownership.

The orderbook runtime path must contain none of the following:

- `new WebSocket(authJson.url)`;
- calls to `/api/market/stream-auth`;
- browser connections to `ws-openapi.dnse.com.vn`;
- DNSE API credentials or HMAC auth payloads.

The browser receives tick, depth, execution and foreign-flow frames through the authenticated shard subscription and keeps existing session-history/Supabase snapshot recovery behavior.

## Worker lifecycle and stale handling

Each of the six provider sockets retains independent reconnect/backoff/stale supervision. A failed supplemental shard must not force healthy canonical tick/index sockets to reconnect.

Universe refresh remains deterministic. If canonical membership changes, supplemental shards are recomputed deterministically and only affected supplemental subscriptions are restarted.

The worker must expose enough structured logging to identify:

- active provider socket count;
- membership count per supplemental socket;
- auth/subscription failures;
- reconnect/backoff state;
- fanout publish errors/429s;
- shard queue depth and dropped/continuity-gap events;
- last successful publish sequence per fanout shard.

## Security

- DNSE API key/secret exist only on server/UpCloud runtime.
- Supabase service-role credentials remain server-side only.
- Browser joins private/authenticated Realtime channels only after setting the current user access token.
- Direct anonymous read access is not introduced.
- No public UpCloud application port is added.
- Existing Market Board authorization and transport remain intact.

## Failure modes

### DNSE connection/account limit

If six concurrent sockets cannot authenticate/subscribe, fail the production capacity gate. Do not compensate with uncontrolled socket churn.

### Individual supplemental socket failure

Only affected symbol shard data becomes stale/recovering. Other provider streams continue. Retry is bounded and jittered.

### Supabase Realtime 429/5xx

Do not mark the batch committed. Collapse current-state frames to newest values, retain ordered `te` within the bounded queue, back off, and expose continuity loss if truncation/restart occurs.

### Browser auth hydration race

Do not subscribe. Reset the startup guard, surface recoverable state, and retry through the same auth-gated lifecycle.

### Sequence gap

Enter `RECOVERING`, reload authoritative session/snapshot state, then resume the live shard from a fresh continuity point.

## Testing strategy

Regression coverage must establish at least these contracts:

- `LiveOrderBookPanel` no longer contains browser-direct DNSE WebSocket startup or `/api/market/stream-auth` usage;
- orderbook Realtime auth hydration and `realtime.setAuth()` happen before private channel subscription;
- restart/resume paths reuse the same auth gate;
- supplemental universe sharding is deterministic and bounded at <=150 memberships/socket for a 200-symbol universe;
- exactly four supplemental orderbook streams are planned for a 200-symbol universe and total target provider socket count is six;
- `t/q/f` use latest-wins coalescing while every `te` frame is preserved in order;
- failed fanout publish does not advance committed sequence;
- continuity gap/truncation forces browser recovery;
- Market Board centralized realtime contract remains unchanged;
- popup mini-chart remains live through tick-derived compatibility updates rather than `ohlc.1` subscription.

Implementation follows TDD: add failing contract/unit tests before changing each source boundary. Runtime verification is performed through GitHub Actions under the QeoIndex inline-only policy unless explicit remote execution is authorized.

## Production acceptance

Source merge alone does not complete QEO-216. Production acceptance requires all of the following:

1. GitHub Actions verification is green on the exact implementation head.
2. Supabase effective Realtime capacity is confirmed at >=500 events/sec.
3. The production DNSE key concurrently authenticates/subscribes all six designed sockets without `MAX_CHANNELS_EXCEEDED` or account-level connection rejection.
4. Worker metrics/logging show four supplemental sockets with bounded memberships and stable reconnect behavior.
5. Opening an orderbook popup in the production Vercel app creates no connection to `ws-openapi.dnse.com.vn`.
6. Two or more browsers viewing the same symbol share the centralized upstream path and do not increase provider socket count.
7. At least 100 distinct symbols are exercised or capacity-proven without provider socket count exceeding six.
8. Depth, executions, foreign flow, quote updates, mini-chart motion, reconnect and recovery behavior are accepted against the current popup semantics.
9. A controlled Realtime interruption proves sequence-gap recovery without silent return to a false LIVE state.

## Explicit non-goals

QEO-216 does not:

- add a public WebSocket/SSE gateway on UpCloud;
- build Kafka/Redis Streams/a durable execution event log;
- change Market Board reducer semantics or its existing 1 Hz bus contract;
- dynamically allocate provider sockets per active popup;
- guarantee transaction-level delivery during unlimited infrastructure outages;
- bypass DNSE account limits with uncontrolled socket sharding.
