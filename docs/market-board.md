# Market board data flow

The market board hydrates the Top 50 from DNSE before relying on WebSocket updates:

- `/api/market/intraday` fetches the current session as native 5-minute OHLC bars and returns both chart closes and an initial quote snapshot. It tries DNSE first and falls back per symbol to Yahoo Finance `.VN` when DNSE times out or rejects the request; the response preserves provider provenance and the fallback reason.
- The browser requests groups of 10 symbols with at most two groups in flight. Successful groups render immediately, so one slow or failed group does not discard the rest of the board.
- The initial percentage change uses the first 5-minute candle's open and the latest candle's close.
- DNSE `ohlc.1.json` updates are folded into 5-minute buckets in the browser. Updates within the same bucket replace its close; a new bucket appends one point.
- Tick and top-price channels remain the source of live price, volume, ceiling, and floor data. The existing stale-stream watchdog reconnects independently of REST hydration.

Keep provider calls bounded. The signed DNSE request timeout is seven seconds; do not replace batched hydration with an unbounded 50-symbol fan-out.
