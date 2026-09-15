# QEO-196/QEO-216/QEO-225 Market Realtime Worker

A stateless Go worker owns the canonical upstream market feed and centralized popup Orderbook feeds. QEO-225 moves the member-facing hot path off Supabase Realtime: the worker now fans live Market Board and Orderbook updates through an authenticated in-memory WebSocket relay, while Supabase remains the durable bootstrap/checkpoint/recovery store.

## Active realtime architecture

```text
provider WebSockets
        ↓
UpCloud Go worker
        ├─ in-memory authenticated WebSocket relay → browser Market Board / Orderbook
        └─ async Supabase checkpoints → bootstrap / recovery only
```

The live relay and checkpoint paths are intentionally independent. A slow or failed Supabase checkpoint request must not delay the browser WebSocket fanout.

## Runtime contract

- canonical stock universe: `vn_top_stocks`, maximum 200 symbols;
- provider socket 1: canonical tick feed for the stock set; the same tick stream feeds both Market Board and popup quote/mini-chart behavior;
- provider socket 2: VNINDEX, VN30, HNX and UPCOM market-index channels;
- provider sockets 3–6: up to four deterministic 50-symbol supplemental shards carrying top-price, extra-tick, foreign-flow, and auction expected-price feeds (maximum 200 memberships/socket);
- no duplicate supplemental OHLC subscription is created; popup mini-chart motion is synthesized from canonical ticks;
- Market Board relay batches are latest-state oriented and publish from memory at a 100 ms default cadence;
- Orderbook relay batches publish by exact symbol at a 50 ms default cadence;
- orderbook `t/q/f/e` state is latest-wins while `te` executions remain ordered in a bounded queue; continuity loss is surfaced so browsers recover from the authoritative snapshot/checkpoint path;
- the browser holds one physical relay WebSocket per tab and multiplexes `market` plus `orderbook:<SYMBOL>` logical topics;
- relay topics are receive-only for authenticated member clients; browsers cannot publish provider/orderbook events;
- Supabase checkpoint keys remain `dnse-market` and `orderbook-v1-00` through `orderbook-v1-09` for bootstrap/recovery compatibility;
- universe membership refreshes periodically; changed supplemental shards restart independently while healthy index/tick streams remain isolated;
- stale provider detection is active during trading sub-windows, not during lunch/pre-open;
- SIGINT/SIGTERM shuts down provider sockets, relay listener and bounded goroutines cleanly.

## Relay authentication and exposure

The browser first obtains a short-lived capability token from the application server. The token is valid for at most 60 seconds and is sent as the first WebSocket application message; it is never placed in the WebSocket URL.

Required worker environment names:

```text
QEO_MARKET_REALTIME_SIGNING_SECRET=
QEO_MARKET_REALTIME_ALLOWED_ORIGINS=
QEO_MARKET_REALTIME_LISTEN_ADDR=:8787
QEO_MARKET_REALTIME_AUTH_TIMEOUT_MS=5000
QEO_MARKET_REALTIME_PING_MS=15000
QEO_MARKET_REALTIME_SEND_QUEUE=64
QEO_MARKET_REALTIME_MARKET_FLUSH_MS=100
QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS=50
```

`QEO_MARKET_REALTIME_SIGNING_SECRET` must match the server-only application value. `QEO_MARKET_REALTIME_ALLOWED_ORIGINS` is fail-closed and must never contain a wildcard in production.

Docker publishes the relay only on host loopback (`127.0.0.1:8787`). Public TLS/WSS termination is provided by a reverse proxy in front of that loopback listener; `deploy/upcloud/realtime-proxy.example.conf` is a vendor-neutral template and contains no production hostname, key or certificate secret.

## Capacity and latency gates

Upstream provider ownership remains bounded to the six-socket target for a full 200-symbol universe, independent of browser count. With the auction expected-price feed each 50-symbol supplemental socket consumes the known 200-membership design ceiling (50 symbols × 4 feeds), so provider capacity remains fail-closed until the production account proves all planned sockets can authenticate and subscribe concurrently.

Supabase Realtime message-rate capacity is no longer a member hot-path gate under QEO-225. Supabase still needs enough database capacity for bounded checkpoint/bootstrap traffic, but browser live delivery does not consume managed Realtime fanout quota.

Production performance target during a healthy active session:

- Orderbook/trades provider-event → browser receive: p95 < 300 ms;
- relay market flush default: 100 ms;
- relay Orderbook flush default: 50 ms;
- checkpoint network I/O: never on the relay critical path.

The browser's existing React paint cadence is a separate UI concern and must not be interpreted as transport latency.

## Secrets

Create `/opt/qeoindex/env/market-realtime-worker.env` on the UpCloud host with mode `0600`. Use `.env.example` only as the key-name template. Never commit the real provider secret, Supabase service-role key, relay signing secret, origin infrastructure details, private IPs, or certificate material.

Browsers receive only the configured public WSS endpoint plus short-lived relay capability tokens. They never receive provider credentials, provider auth payloads, Supabase service-role credentials, or the relay signing secret.

## Build and manual smoke

From `/opt/qeoindex/repo/services/market-realtime-worker`:

```bash
docker compose -f deploy/upcloud/docker-compose.upcloud.yml build --pull
docker compose -f deploy/upcloud/docker-compose.upcloud.yml up --no-build --abort-on-container-exit --exit-code-from market-realtime-worker
```

The worker intentionally exits outside Monday–Friday 08:55–14:50 `Asia/Ho_Chi_Minh`.

During the manual market-hours smoke, verify:

1. Structured logs show canonical tick/index streams and four supplemental Orderbook streams at full universe without printing credentials or relay tokens.
2. Relay health is reachable only through the intended TLS/WSS front door; the container listener remains loopback-bound on the host.
3. Market Board and popup Orderbook share one authenticated QeoIndex WebSocket connection per browser tab; no browser-direct provider socket is opened.
4. Browser live Market Board traffic no longer uses Supabase `postgres_changes`, and popup Orderbook live traffic no longer uses Supabase private Broadcast.
5. `market_realtime_bus` rows still advance asynchronously for recovery; deliberately delaying a checkpoint write does not stall WSS delivery.
6. Multiple browsers viewing the same symbol do not increase upstream provider socket count.
7. During ATO/ATC, expected-price state reaches the popup through the relay and updates indicative match price/quantity without replacing the last actual matched quote.
8. Relay interruption causes `RECOVERING`/reconnect behavior and authoritative state hydration; sequence/epoch gaps never silently return the UI to a false LIVE state.
9. Slow-client/backpressure handling disconnects and recovers the affected browser instead of blocking provider ingestion or silently dropping ordered executions.
10. Active-session latency telemetry for MSN and several high-activity symbols records p50/p95/p99 and meets the p95 <300 ms acceptance target under normal load.
11. `docker stats --no-stream` and host telemetry remain inside an acceptable CPU/RSS budget before any server resize is considered.
12. Only one canonical realtime worker owns upstream provider sockets.

Useful recovery-checkpoint observation query:

```sql
select stream, sequence, jsonb_array_length(frames) as frame_count,
       source_updated_at, updated_at
from public.market_realtime_bus
where stream = 'dnse-market' or stream like 'orderbook-v1-%'
order by stream;
```

## systemd and production rollout

The start timer fires at 01:55 UTC (08:55 ICT) and the stop timer at 07:50 UTC (14:50 ICT), Monday–Friday. Both are persistent for reboot recovery, while the worker's own market-window check remains the final guardrail.

A source merge alone is **not** QEO-225 production acceptance. Before browser cutover, production must have:

1. matching server/worker relay signing secret provisioned without exposing its value;
2. exact allowed application Origin configured on the worker;
3. loopback relay listener and TLS/WSS reverse proxy configured;
4. public application WSS environment value configured;
5. exact merged worker commit deployed and healthy;
6. Git-triggered application deployment READY;
7. active-session realtime/recovery/latency smoke completed.

Normal source verification uses GitHub Actions. Production host changes require explicit remote-machine authorization.

Rollback should restore a previously verified complete realtime architecture, not run two live transports/producers in parallel. Never enable a browser-direct provider fallback as a rollback shortcut.
