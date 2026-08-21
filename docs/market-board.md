# Market board data and performance model

Last updated: 2026-08-21

## Server bootstrap

The authenticated `/` page verifies the Supabase server session before loading board data. The server then assembles one initial board model from three bounded sources in parallel:

- Supabase orderbook snapshots for persisted reference/session/orderbook data.
- Broker batch quotes for current quote fields.
- The shared 5-minute intraday snapshot cache for mini-chart history.

The SSR model is cached through the QeoIndex UI cache with a short live-session TTL. This lets the first render contain usable prices and chart history before the browser WebSocket becomes live.

When SSR already provides usable multi-point history for at least 95% of the Top 100 universe, the browser does not immediately call `/api/market/intraday` again on first mount. A session rollover still increments the reload key and forces a fresh browser history bootstrap.

## Intraday history cache

`lib/intraday-5m-service.ts` keeps the complete Top 100 history snapshot as one cache object:

1. Vercel Runtime Cache exact session bucket.
2. Upstash Redis exact session bucket when configured.
3. Today's latest known-good snapshot from Redis/Runtime Cache.
4. Provider fan-out only when no acceptable cached snapshot exists.

The provider path tries the DNSE 5-minute chart endpoint first and falls back to Yahoo when required. Fetch concurrency remains bounded at 12 symbols.

`/api/market/intraday` follows the same stale-while-live strategy and accepts today's latest known-good snapshot before starting a 100-symbol provider fan-out. This matters because the browser immediately transitions to the DNSE realtime stream; blocking a hydration request for a perfect new 5-minute snapshot is worse than serving a slightly older valid chart shape and letting live ticks take over.

Vercel runtime audit on 2026-08-21 found three 20-second timeouts across `/api/market/index-candles` and `/api/market/intraday`. The cache-first and SSR-history-reuse changes directly target the intraday portion of that failure mode.

## Browser realtime path

- DNSE WebSocket messages are queued and flushed on `requestAnimationFrame` instead of creating one React update per raw socket callback.
- Live quote/history writes go into detached ref-backed stores. A socket tick replaces only the affected symbol entry rather than cloning the full Top 100 quote map.
- Visible quote state is committed to React at most every 250ms (`MARKET_UI_COMMIT_MS`), approximately 4Hz.
- Sector and Top Movers ordering use a separate quote snapshot refreshed at most once per second (`MARKET_ORDERING_REFRESH_MS`). Price paint therefore does not force ranking/group sorting on every React commit.
- History updates replace only the affected ticker inside the ref-backed store and clone the outer history map at the next bounded UI commit.
- `LiveStockRow` and `LiveMoverCard` are memoized and only redraw when their visible quote/history/watch state changes.
- Mini-chart SVGs are memoized separately. A changing transient live endpoint no longer rebuilds the entire sparkline path on every trade tick; the chart redraws when its stable history shape changes, while the textual price remains responsive.
- Chart history stays bounded to the most recent display points.

The 250ms cadence is a UI paint policy, not a data-ingestion throttle. DNSE frames continue to be processed as they arrive; the browser merely publishes a bounded snapshot into React.

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

## Current performance status

The structural state-machine optimization is now implemented in the focused `perf/market-board-state-buffer` change:

1. ref-backed quote/history stores avoid full-map clones for each socket tick;
2. React quote snapshots are bounded to ~4Hz instead of ~10Hz;
3. ranking and sector average snapshots refresh at ~1Hz;
4. redundant first-mount intraday bootstrap is skipped when SSR history coverage is sufficient.

This materially reduces the maximum parent-board update opportunities and ranking recomputation frequency, but it is not a claim about a fixed CPU/temperature percentage. Actual gains depend on live market message volume, browser, device, open order-book windows, and whether DevTools/other tabs are active.

If production is still hot after this change, profile before adding more throttling. The next likely structural boundary would be splitting high-frequency quote paint from aggregate header statistics or moving individual rows to a subscription/store model. Do not jump directly to virtualization because the screenshot workflow requires the complete DOM.

## Regression coverage

- `pnpm test:board-contract` covers layout, reference-price semantics, WebSocket buffering, 250ms quote commits, 1s ordering snapshots, SSR history reuse, low-composite rendering, and sparkline memo behavior.
- `pnpm test:intraday` covers bucket replacement/rollover, replay ordering, unit normalization, and latest-session fallback.
- `pnpm test:supabase` covers final snapshot RLS and Auth/API security contracts.
- GitHub `Verify` also runs the production Next.js build before a PR can be considered release-ready.
