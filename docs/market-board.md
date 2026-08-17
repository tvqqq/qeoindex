# Market board data flow

The market board hydrates the Top 50 from DNSE before relying on WebSocket updates:

- `/api/market/intraday` fetches the current session from Yahoo Finance `.VN` as native 5-minute OHLC bars and returns chart closes and the initial quote snapshot together. DNSE remains the realtime WebSocket provider after bootstrap.
- The browser requests all Top 50 symbols once. The server bounds Yahoo work to 12 concurrent symbols and returns one atomic snapshot so price and chart render together.
- Each symbol snapshot is stored in Vercel Runtime Cache for 15 seconds. Cache failure never blocks provider fetching; warm requests avoid refetching Yahoo.
- The initial percentage change uses the first 5-minute candle's open and the latest candle's close.
- DNSE `ohlc.1.json` updates are folded into 5-minute buckets in the browser. Updates within the same bucket replace its close; a new bucket appends one point.
- Tick and top-price channels remain the source of live price, volume, ceiling, and floor data. The existing stale-stream watchdog reconnects independently of REST hydration.

Keep provider calls bounded. Do not replace the server-side concurrency limit with an unbounded 50-symbol fan-out.
