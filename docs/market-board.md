# Market board data flow

The market board hydrates the Top 100 HOSE universe from Notion before relying on DNSE WebSocket updates:

- The index strip hydrates VN-INDEX, VN30, and HNX-INDEX from a bounded TradingView market snapshot through `/api/market/indexes`. These values remain visible after the closing bell; DNSE WebSocket index ticks overwrite them when live data is available.

- Notion's `Wyckoff Universe — Top 100 HOSE` database is the source of truth for membership, active status, rank, market capitalization, and sector. QeoIndex must not replace that membership with a hard-coded market list.

- `/api/market/intraday` fetches Yahoo Finance `.VN` as native 5-minute OHLC bars and returns chart closes and the initial quote snapshot together. During and after a trading day it uses that session; on weekends, holidays, or when today's bars are unavailable it falls back to the latest completed session in the seven-day window. DNSE remains the realtime WebSocket provider after bootstrap.
- The browser requests all Top 100 symbols once. The server bounds Yahoo work to 12 concurrent symbols and returns one atomic snapshot so price and chart render together.
- The complete Top 100 snapshot is one atomic cache object. Vercel Runtime Cache is the regional L1; optional Upstash Redis is the shared L2; Yahoo is fetched only after both miss. The cache key includes the Vietnam session date and current 5-minute bucket, and expires at the next bucket boundary.
- Redis uses the server-only `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` variables. Both cache layers fail open, so missing credentials or a cache outage never blocks provider fetching.
- Partial updates inside one 5-minute bucket are collapsed to one close. Quiet/missing buckets are forward-filled with the previous close so every mini chart keeps the same session time scale instead of compressing illiquid stocks.
- Yahoo candles with zero/invalid OHLC are discarded before normalization. Some `.VN` responses include zero-valued placeholders outside trading windows; accepting them would overwrite the valid EOD close and make the UI show a chart beside an empty price.
- The initial percentage change uses the first 5-minute candle's open and the latest candle's close.
- The UI derives an EOD quote from the hydrated chart (then from the latest Notion close as a last resort) whenever DNSE has no live tick. This keeps prices and mini charts visible after the closing bell without presenting the fallback as a live WebSocket tick.
- Sector cards use fixed-height group headers and stronger row separators for multi-column readability. Stocks at or above +3% receive a restrained green pulse; reduced-motion clients keep the static highlight without animation.
- The board presents six visual groups. Energy and Utilities retain their canonical sector values but render inside `Các ngành còn lại`. The grid scales from one to two, three, and finally six columns so desktop keeps one balanced row while smaller screens avoid compressed cards.
- Chart history keeps `{time, close}` points. DNSE `ohlc.1.json` updates are merged by their 5-minute timestamp: same-bucket updates replace that bucket, new buckets append, and replayed/out-of-order events update their original bucket without resetting or reordering the session.
- DNSE closes are normalized against the latest Yahoo close so feeds expressed in thousands (for example `58.5`) cannot flatten a VND-scaled chart (`58,500`). The displayed quote is never appended as an extra non-candle chart point.
- Tick and top-price channels remain the source of live price, volume, ceiling, and floor data. The existing stale-stream watchdog reconnects independently of REST hydration.

Keep provider calls bounded. Do not replace the server-side concurrency limit with an unbounded 100-symbol fan-out.

## Regression coverage

`pnpm test:intraday` covers same-bucket replacement, bucket rollover, replay/out-of-order events, DNSE/Yahoo price-unit normalization, and latest-session EOD fallback selection.
