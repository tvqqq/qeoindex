# Market board data flow

The market board hydrates the Top 50 from DNSE before relying on WebSocket updates:

- `/api/market/intraday` fetches the current session from Yahoo Finance `.VN` as native 5-minute OHLC bars and returns chart closes and the initial quote snapshot together. DNSE remains the realtime WebSocket provider after bootstrap.
- The browser requests all Top 50 symbols once. The server bounds Yahoo work to 12 concurrent symbols and returns one atomic snapshot so price and chart render together.
- The complete Top 50 snapshot is one atomic cache object. Vercel Runtime Cache is the regional L1; optional Upstash Redis is the shared L2; Yahoo is fetched only after both miss. The cache key includes the Vietnam session date and current 5-minute bucket, and expires at the next bucket boundary.
- Redis uses the server-only `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` variables. Both cache layers fail open, so missing credentials or a cache outage never blocks provider fetching.
- Partial updates inside one 5-minute bucket are collapsed to one close. Quiet/missing buckets are forward-filled with the previous close so every mini chart keeps the same session time scale instead of compressing illiquid stocks.
- The initial percentage change uses the first 5-minute candle's open and the latest candle's close.
- Chart history keeps `{time, close}` points. DNSE `ohlc.1.json` updates are merged by their 5-minute timestamp: same-bucket updates replace that bucket, new buckets append, and replayed/out-of-order events update their original bucket without resetting or reordering the session.
- DNSE closes are normalized against the latest Yahoo close so feeds expressed in thousands (for example `58.5`) cannot flatten a VND-scaled chart (`58,500`). The displayed quote is never appended as an extra non-candle chart point.
- Tick and top-price channels remain the source of live price, volume, ceiling, and floor data. The existing stale-stream watchdog reconnects independently of REST hydration.

Keep provider calls bounded. Do not replace the server-side concurrency limit with an unbounded 50-symbol fan-out.

## Regression coverage

`pnpm test:intraday` covers same-bucket replacement, bucket rollover, replay/out-of-order events, and DNSE/Yahoo price-unit normalization.
