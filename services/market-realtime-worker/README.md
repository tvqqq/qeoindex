# QEO-196/QEO-216/QEO-225 Market Realtime Worker

A stateless Go worker owns the canonical DNSE Market Board feed and the centralized popup orderbook upstream feed. QEO-225 serves the member-facing Market Board and popup orderbook hot path through an authenticated in-memory HTTP/WebSocket relay, while Supabase `market_realtime_bus` and orderbook checkpoints remain asynchronous bootstrap/recovery storage rather than the live browser transport.

## Runtime contract

- canonical stock universe: `vn_top_stocks`, maximum 200 symbols;
- DNSE socket 1: `tick.G1.json` for the canonical stock set; this same tick stream feeds both Market Board and popup quote/mini-chart behavior;
- DNSE socket 2: VNINDEX, VN30, HNX and UPCOM market-index channels;
- DNSE sockets 3–6: up to four deterministic 50-symbol supplemental shards carrying `top_price.G1.json`, `tick_extra.G1.json`, `foreign.G1.json`, and `expected_price.G1.json` (maximum 200 memberships/socket); QEO-222 adds the auction expected-price feed so ATO/ATC indicative price and quantity survive centralization;
- no supplemental `ohlc.1.json` subscription is created; popup mini-chart motion is synthesized from canonical ticks;
- Market Board relay batches are latest-state oriented and publish at **100 ms by default** (bounded 25–1000 ms); the durable `dnse-market` checkpoint remains approximately 1 Hz;
- QEO-224 orderbook fanout uses ten deterministic in-memory shards and flushes relay batches at **50 ms by default** (bounded 20–500 ms); `ORDERBOOK_REALTIME_FLUSH_MS=200` remains a separate checkpoint/recovery setting and must not be treated as the relay cadence;
- live orderbook relay delivery is independent from checkpoint persistence; a slow or failed checkpoint cannot head-of-line block the authenticated browser relay;
- recovery checkpoints are coalesced per shard and persisted asynchronously at approximately 1 Hz;
- orderbook `t/q/f/e` frames are latest-wins while `te` executions remain ordered in a bounded queue; queue truncation/restart is exposed as a continuity gap so browsers recover from the session/snapshot authority;
- orderbook checkpoint streams are `orderbook-v1-00` through `orderbook-v1-09`; per-symbol relay sequences advance independently, while checkpoint rows may intentionally lag because they are recovery-only;
- live Market Board and popup orderbook batches publish through the in-memory authenticated relay; checkpoint persistence is independent and must not block relay delivery;
- the browser treats checkpoint sequence as hydration only; the first newer relay message after a join establishes the live sequence baseline, then strict gap/epoch checks resume so an intentionally lagging checkpoint does not cause a reconnect loop;
- payload-size accounting encodes each candidate frame once instead of repeatedly serializing the growing batch;
- worker ingress stamps orderbook frames with internal `_qeoWorkerReceivedAt`; the browser combines that stamp, provider event time, envelope `publishedAt`, and browser receive time to report rolling p50/p95/p99 latency for `providerToWorker`, `workerQueue`, `delivery`, and `endToEnd` in developer console only;
- universe membership refreshes periodically; changed supplemental shards restart independently while healthy index/tick streams remain isolated;
- stale stream detection is active during trading sub-windows, not during lunch/pre-open;
- SIGINT/SIGTERM closes the provider WebSockets, relay listener, and bounded goroutines cleanly;
- the relay HTTP server exposes authenticated `/ws` plus `/healthz` on `QEO_MARKET_REALTIME_LISTEN_ADDR` (default `:8787` inside the container); UpCloud Compose publishes it only as host-loopback `127.0.0.1:8790 -> container:8787`, not a public host binding.

## Relay environment and routing contract

The worker requires the following relay environment names: `QEO_MARKET_REALTIME_SIGNING_SECRET`, `QEO_MARKET_REALTIME_ALLOWED_ORIGINS`, `QEO_MARKET_REALTIME_LISTEN_ADDR`, `QEO_MARKET_REALTIME_AUTH_TIMEOUT_MS`, `QEO_MARKET_REALTIME_PING_MS`, `QEO_MARKET_REALTIME_SEND_QUEUE`, `QEO_MARKET_REALTIME_MARKET_FLUSH_MS`, and `QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS`. `.env.example` contains placeholders and safe example values only.

`QEO_MARKET_REALTIME_SIGNING_SECRET` must match the Next.js token-signing secret, and `QEO_MARKET_REALTIME_ALLOWED_ORIGINS` is a comma-separated list of exact browser origins; wildcard origins are rejected. The Next.js app must set `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL` to the validated WSS endpoint ending in `/ws`. The chosen routing layer must forward `/ws` to host loopback `127.0.0.1:8790`; whether that layer is Caddy, Tailscale, Cloudflare, or another approved deployment mechanism remains a deployment decision. Host `127.0.0.1:8787` belongs to the ops-dashboard and must not be reused for this worker.

## Capacity gates

QEO-216 source architecture targets six simultaneous DNSE provider sockets for a full 200-symbol universe, independent of browser count. With QEO-222 each 50-symbol supplemental socket consumes the full 200-membership design ceiling (50 symbols × 4 feeds), so production cutover is **fail-closed** until the production DNSE API key proves it can authenticate and subscribe all six sockets concurrently without account-level rejection or `MAX_CHANNELS_EXCEEDED`.

The 100-simultaneous-unique-popup guarantee remains fail-closed until active-session relay/provider capacity evidence exists. Supabase still needs enough database capacity for bounded checkpoint/bootstrap traffic, but browser live delivery no longer depends on Supabase Realtime fanout capacity.

## Secrets

Create `/opt/qeoindex/env/market-realtime-worker.env` on the UpCloud host with mode `0600`. Use `.env.example` only as the key-name template. Never commit the real DNSE API secret, Supabase service-role key, or relay signing secret. Browsers receive only the configured relay endpoint and short-lived capability tokens, never provider credentials or provider auth payloads.

## Build and manual smoke

From `/opt/qeoindex/repo/services/market-realtime-worker`:

```bash
docker compose -f deploy/upcloud/docker-compose.upcloud.yml build --pull
docker compose -f deploy/upcloud/docker-compose.upcloud.yml up --no-build --abort-on-container-exit --exit-code-from market-realtime-worker
```

The worker intentionally exits outside Monday–Friday 08:55–14:50 `Asia/Ho_Chi_Minh`.

During the manual market-hours smoke, verify:

1. JSON logs show `ticks`, `indexes`, and four orderbook supplemental streams at full universe without printing credentials.
2. `market_realtime_bus` row `dnse-market` keeps the existing bounded 1 Hz recovery contract; orderbook checkpoint rows advance independently and may trail live relay messages by roughly one checkpoint interval.
3. Market Board receives authenticated worker relay changes end-to-end with no canonical browser DNSE socket.
4. Opening popup orderbooks creates only authenticated worker relay traffic in the browser; Chrome Network shows no `ws-openapi.dnse.com.vn` connection.
5. Multiple browsers viewing the same symbol do not increase the DNSE provider socket count; capacity proof covers at least 100 distinct symbols while provider sockets remain bounded by six.
6. During ATO/ATC, `expected_price.G1.json` produces `T=e` state and the popup updates both indicative match price and indicative quantity without replacing the last actually matched quote.
7. Browser developer console emits `[orderbook-latency]` summaries; compare `workerQueue` and `delivery` p95 before/after QEO-224 and target a visibly improved live tape before changing infrastructure capacity.
8. A deliberate provider, relay, or checkpoint interruption causes bounded reconnect/recovery and a continuity gap never silently returns the popup to a false LIVE state.
9. `docker stats --no-stream` stays inside the initial 384 MB / 0.75 CPU container budget.
10. The old centralized ingestion worker is stopped so only one producer writes the realtime bus/fanout.

Useful database observation query:

```sql
select stream, sequence, jsonb_array_length(frames) as frame_count,
       source_updated_at, updated_at
from public.market_realtime_bus
where stream = 'dnse-market' or stream like 'orderbook-v1-%'
order by stream;
```

## systemd cutover

**Do not enable the timers until the manual DNSE → Supabase → browser smoke passes.** QEO-196/QEO-216 remain fail-closed by design.

After the smoke passes, install the four units under `deploy/upcloud/` to `/etc/systemd/system/`, run `systemctl daemon-reload`, then enable both timers:

```bash
sudo systemctl enable --now qeo-market-realtime-start.timer
sudo systemctl enable --now qeo-market-realtime-stop.timer
```

The start timer fires at 01:55 UTC (08:55 ICT) and the stop timer at 07:50 UTC (14:50 ICT), Monday–Friday. Both are persistent for reboot recovery, while the worker's own market-window check remains the final guardrail.

Rollback is the inverse: disable both timers, stop `qeo-market-realtime.service`, and only then restore a previous ingestion worker if required. Never run two producers concurrently.
