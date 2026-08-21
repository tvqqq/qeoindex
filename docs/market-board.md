# Market board data and performance model

Last updated: 2026-08-21

## Server bootstrap

The authenticated `/` page verifies the Supabase server session before loading board data. The server then assembles one initial board model from three bounded sources in parallel:

- Supabase orderbook snapshots for persisted reference/session/orderbook data.
- Broker batch quotes for current quote fields.
- The shared 5-minute intraday snapshot cache for mini-chart history.

The SSR model is cached through the QeoIndex UI cache with a short live-session TTL. This lets the first render contain usable prices and chart history before the browser WebSocket becomes live.

## Intraday history cache

`lib/intraday-5m-service.ts` keeps the complete Top 100 history snapshot as one cache object:

1. Vercel Runtime Cache exact session bucket.
2. Upstash Redis exact session bucket when configured.
3. Today's latest known-good snapshot from Redis/Runtime Cache.
4. Provider fan-out only when no acceptable cached snapshot exists.

The provider path tries the DNSE 5-minute chart endpoint first and falls back to Yahoo when required. Fetch concurrency remains bounded at 12 symbols.

`/api/market/intraday` now follows the same stale-while-live strategy and accepts today's latest known-good snapshot before starting a 100-symbol provider fan-out. This matters because the browser immediately transitions to the DNSE realtime stream; blocking a hydration request for a perfect new 5-minute snapshot is worse than serving a slightly older valid chart shape and letting live ticks take over.

Vercel runtime audit on 2026-08-21 found three 20-second timeouts across `/api/market/index-candles` and `/api/market/intraday`. The cache-first change directly targets the intraday portion of that failure mode.

## Browser realtime path

- DNSE WebSocket messages are queued and flushed on `requestAnimationFrame` instead of creating one React update per raw socket callback.
- Live market state is stored outside React and committed at a bounded interval (`MARKET_UI_COMMIT_MS`).
- `LiveStockRow` and `LiveMoverCard` are memoized and only redraw when their visible quote/history/watch state changes.
- Mini-chart SVGs are memoized separately. A changing transient live endpoint no longer rebuilds the entire sparkline path on every trade tick; the chart redraws when its stable history shape changes, while the textual price remains realtime.
- Chart history stays bounded to the most recent display points.

## GPU/compositing controls

The 2026-08-21 performance audit identified GPU compositing as a likely contributor to hot laptops:

- `.board-stock-row` previously used `transform: translateZ(0)`, which can promote roughly 100 rows to persistent compositor layers. This forced promotion has been removed.
- The authenticated board page applies `market-board-performance.module.css`, which disables expensive `backdrop-filter` blur utilities inside the dense market-board surface while preserving the opaque glass-like backgrounds, borders, and shadows.
- Dense rows use `contain: layout style` to reduce unnecessary layout propagation without using `content-visibility`.
- Drop-shadow filters inside stock rows are suppressed on the performance surface.

Do **not** reintroduce `content-visibility` or naive row virtualization without redesigning the screenshot flow. QeoIndex captures the complete board DOM for screenshots; earlier visibility-based rendering shortcuts can omit off-screen sectors from the exported image.

## Price/reference rules

- Daily performance is anchored to the official/reference previous close, never to the session open.
- The initial SSR quote uses the best available live/snapshot/reference source in that order.
- DNSE 1-minute OHLC events are normalized into the board's 5-minute chart buckets.
- Price-unit normalization prevents feeds expressed in thousands from flattening VND-scaled histories.
- After close, cached intraday history and persisted snapshots keep prices/charts visible without labeling them as a live WebSocket tick.

## Layout contract

- Six sector groups render in a responsive 1 / 2 / 3 / 6 column grid.
- Sector headers keep a fixed 72px height.
- Strong gainers use a static border highlight; permanent pulse animation is avoided.
- The watchlist is a horizontal section above the sector grid and remains compatible with full-board screenshots.

## Remaining performance hotspot

The main remaining client-side hotspot is `components/live-market-board-v2.tsx`: the React market-state commit interval is still 100ms, and sector/mover ordering is recalculated from the current quote map on each commit. If production profiling still shows high CPU after the compositor, sparkline, and cache fixes, the next change should be structural rather than cosmetic:

1. mutate a ref-backed quote store per socket tick;
2. clone the quote map only once per ~200–250ms React commit;
3. update sector/mover ordering on a slower ~1s snapshot;
4. skip the browser intraday bootstrap entirely when SSR history coverage is already sufficient.

That change touches the core realtime state machine and should be isolated in its own PR with profiler evidence and screenshot/orderbook regression checks.

## Regression coverage

- `pnpm test:board-contract` covers layout, reference-price semantics, WebSocket buffering, low-composite rendering, and sparkline memo behavior.
- `pnpm test:intraday` covers bucket replacement/rollover, replay ordering, unit normalization, and latest-session fallback.
- `pnpm test:supabase` covers final snapshot RLS and Auth/API security contracts.
