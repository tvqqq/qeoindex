# QEO-196 Market Realtime Worker

A stateless Go worker owns the canonical DNSE Market Board feed and publishes coalesced current-state batches to the existing Supabase `market_realtime_bus`. The browser contract from QEO-175 is unchanged.

## Runtime contract

- canonical stock universe: `vn_top_stocks`, maximum 200 symbols;
- DNSE socket A: `tick.G1.json` for the canonical stock set;
- DNSE socket B: VNINDEX, VN30, HNX and UPCOM market-index channels;
- latest frame per `(T, symbol/index)` is coalesced and flushed at approximately 1 Hz;
- the worker bootstraps its sequence from the current `dnse-market` bus row so sequence values remain increasing across restarts;
- universe membership refreshes periodically without restarting the index stream;
- stale stream detection is active during trading sub-windows, not during lunch/pre-open;
- SIGINT/SIGTERM closes the WebSockets and exits cleanly;
- no HTTP server or public listening port exists.

## Secrets

Create `/opt/qeoindex/env/market-realtime-worker.env` on the UpCloud host with mode `0600`. Use `.env.example` only as the key-name template. Never commit the real DNSE API secret or Supabase service-role key.

## Build and manual smoke

From `/opt/qeoindex/repo/services/market-realtime-worker`:

```bash
docker compose -f deploy/upcloud/docker-compose.upcloud.yml build --pull
docker compose -f deploy/upcloud/docker-compose.upcloud.yml up --no-build --abort-on-container-exit --exit-code-from market-realtime-worker
```

The worker intentionally exits outside Monday–Friday 08:55–14:50 `Asia/Ho_Chi_Minh`.

During the manual market-hours smoke, verify:

1. JSON logs show both `ticks` and `indexes` subscribed without printing credentials.
2. `market_realtime_bus` row `dnse-market` receives bounded frames and an increasing `sequence`.
3. Market Board receives Supabase Realtime changes end-to-end with no canonical browser DNSE socket.
4. A deliberate DNSE/network interruption causes reconnect/backoff and recovery.
5. `docker stats --no-stream` stays inside the initial 384 MB / 0.75 CPU container budget.
6. The old centralized ingestion worker is stopped so only one producer writes `dnse-market`.

Useful database observation query:

```sql
select stream, sequence, jsonb_array_length(frames) as frame_count,
       source_updated_at, updated_at
from public.market_realtime_bus
where stream = 'dnse-market';
```

## systemd cutover

**Do not enable the timers until the manual DNSE → Supabase → browser smoke passes.** QEO-196 is fail-closed by design.

After the smoke passes, install the four units under `deploy/upcloud/` to `/etc/systemd/system/`, run `systemctl daemon-reload`, then enable both timers:

```bash
sudo systemctl enable --now qeo-market-realtime-start.timer
sudo systemctl enable --now qeo-market-realtime-stop.timer
```

The start timer fires at 01:55 UTC (08:55 ICT) and the stop timer at 07:50 UTC (14:50 ICT), Monday–Friday. Both are persistent for reboot recovery, while the worker's own market-window check remains the final guardrail.

Rollback is the inverse: disable both timers, stop `qeo-market-realtime.service`, and only then restore a previous ingestion worker if required. Never run two producers concurrently.
