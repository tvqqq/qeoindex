# QEO-175 Market Realtime Worker

One stateless Laravel worker owns the canonical DNSE Market Board feed and publishes coalesced current-state batches to Supabase.

## Railway

Create a Railway service from this repository with root directory `services/market-realtime-worker`. No Railway volume or database is required: Supabase is the persistence and fan-out authority.

Required variables:

- `DNSE_API_KEY`
- `DNSE_API_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional `DNSE_WS_URL`
- optional `MARKET_REALTIME_FLUSH_MS` (default `1000`, clamped to 250–5000 ms)

The worker opens one stock-tick connection for the canonical Top 200 and a small second connection for four market-index channels so no individual DNSE socket exceeds the existing 200-membership normalUser budget. The popup orderbook remains a separate on-demand transport in QEO-175 phase 1 because its `tick_extra`/depth contract is materially different.
