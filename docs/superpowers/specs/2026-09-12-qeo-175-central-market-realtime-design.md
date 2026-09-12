# QEO-175 Central Market Realtime Design

## Goal

Replace the canonical Market Board's browser-to-DNSE fanout with one long-running Laravel ingestion worker and Supabase Realtime fanout, while preserving the current UI update cadence and DNSE membership limits.

## Current problem

`components/live-market-board.tsx` opens a DNSE WebSocket per mounted browser. The popup orderbook also has its own distinct direct socket. The Market Board subscription request historically includes multiple symbol channels, and the existing browser guard reduces it to the 200-symbol tick feed because normalUser has a 200 membership budget. Browser fanout therefore multiplies provider connections as tabs/users grow.

## Architecture

`Railway Laravel worker → DNSE WS → 1-second coalescing buffer → public.market_realtime_bus → Supabase Realtime → Vercel browser → existing Market Board reducers`

Supabase is the only durable/current-state authority for this realtime bus. Railway remains stateless and requires no volume.

### Provider sockets

- Socket A: `tick.G1.json` for the current canonical `vn_top_stocks` membership, max 200 symbols.
- Socket B: four `market_index.*` channels.
- The worker refreshes the canonical universe RPC every five minutes and reconnects the stock subscription only when membership changes.

This preserves the known 200-membership per-socket budget rather than attempting to evade it by silently sharding the full depth/foreign contract.

### Bus shape

`market_realtime_bus` is deliberately separate from `stock_orderbook_snapshots`. It has one row per stream, a monotonic sequence, provider, bounded `frames` JSON array, source timestamp, and update timestamp. `frames` is capped at 512 KiB at the database boundary.

The worker keeps only the latest frame per `(T, symbol/index)` during each flush window, so a busy symbol cannot produce unbounded Postgres Changes traffic. Default flush cadence is 1 Hz.

### Browser

`modules/market/providers/dnse/market-stream.ts` owns one Supabase Realtime subscription and exposes frame + stream-state listeners. Tick frames also synthesize the existing `T=b` OHLC compatibility frame so mini charts keep their current behavior.

The Market Board consumes this module instead of authenticating/opening DNSE directly. Its 250 ms quote commit and 1 s ordering refresh remain unchanged.

## Orderbook boundary

QEO-175 phase 1 does not centralize the popup orderbook. It uses `tick_extra`, top-price/depth, OHLC, foreign and trade semantics that are materially larger than the canonical board feed. Moving that contract without confirmed DNSE account-level limits and a separate bounded fanout design would risk breaking depth/trades or exceeding provider limits. The direct orderbook socket remains explicit and isolated.

## Security

- `anon`: no table access.
- `authenticated`: SELECT only.
- `service_role`: ingestion writes.
- DNSE and service-role credentials exist only on Railway/server environments.

## Railway plan

The service is a background worker, not an HTTP app. It uses Nixpacks and `php artisan market:stream`; it does not need a volume. Railway Free can be used for a smoke/prototype if its monthly credit covers the worker runtime, while a continuously-running production worker should be budgeted independently of the free credit.
