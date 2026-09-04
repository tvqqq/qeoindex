# Market board data and performance model

Last updated: 2026-09-03

## Server bootstrap

The authenticated `/` page verifies the Supabase server session before loading board data. The server then assembles one initial board model from three bounded sources in parallel:

- Supabase orderbook snapshots for persisted reference/session/orderbook data.
- Broker batch quotes for current quote fields.
- The shared 5-minute intraday snapshot cache for mini-chart history.

The SSR model is cached through the QeoIndex UI cache with a short live-session TTL. This lets the first render contain usable prices and chart history before the browser WebSocket becomes live.

When SSR already provides usable multi-point history for at least 95% of the canonical universe, the browser does not immediately call `/api/market/intraday` again on first mount. A session rollover still increments the reload key and forces a fresh browser history bootstrap.

## Filter CP

`Filter CP` is injected beside the existing `Tất cả` and `Top movers` controls without duplicating the market-board realtime store. It filters only the current canonical board universe (currently capped at Top 200).

Supported criteria:

- exchange: HOSE / HNX / UPCOM, multi-select;
- minimum stock price in VND;
- minimum canonical 50-session average volume (`averageVolume50d`) in shares per session;
- raw canonical/KFSP sector labels grouped into the same six columns as the market board.

Board quotes are normalized internally in thousands of VND (for example `66.1` means `66,100 VND`). The filter helper converts those values to VND before applying the user-entered price threshold. Liquidity does **not** use the current-session matched volume: the threshold is evaluated from the canonical universe's `averageVolume50d`, so the same filter remains stable regardless of what time the user opens the board.

The KFSP sector editor follows `BOARD_SECTOR_GROUPS` in board order: `Ngân hàng`, `Chứng khoán`, `Bán lẻ`, `Bất động sản`, `Công nghiệp`, `Còn lại`. Each raw KFSP sector is assigned with `boardSectorGroupForSector`. All available sectors are selected by default. Bank and securities sectors are mandatory and cannot be unchecked; every other non-empty board column must retain at least one selected raw sector. Saved criteria that violate these invariants are treated as invalid and the editor falls back to defaults.

Criteria persist per authenticated user at `user_preferences.settings.marketBoard.stockFilter`. The dedicated `/api/me/market-board-filter` route validates the payload and server-merges only the stock-filter key so unrelated preference settings survive the write. The existing `minVolumeShares` JSON key remains backward compatible, but its product meaning is now minimum 50-session average volume rather than current-session volume.

The resolved ticker list is cached in browser local storage under a per-user namespace. A cache entry is valid only when all of these identities still match:

- authenticated user ID;
- Vietnam date (`Asia/Ho_Chi_Minh`);
- canonical universe `runId`;
- deterministic hash of normalized criteria;
- every cached ticker still belongs to the current canonical universe.

Ticker membership is frozen for that valid daily cache entry. Quotes for the selected tickers remain realtime. Opening the editor and pressing `Áp dụng` recomputes membership from a fresh price snapshot while the KLTB 50-session criterion comes from the already-loaded canonical universe.

The filter shell deliberately passes only the filtered universe to the existing `LiveMarketBoard`. The board therefore derives its existing DNSE `symbolList` from only those tickers, so stock channels (`tick`, `top_price`, `ohlc`, `foreign`) stop receiving off-filter symbols while Filter CP is active. Market-index channels remain present independently.

Returning to `Tất cả` or `Top movers` is guarded by `/api/market/quotes`: broker batch quotes and one bounded canonical snapshot query run in parallel, and the transition is rejected if any requested symbol still lacks a valid quote. After a successful reconcile the shell remounts the board with the full canonical universe and clears the history seed, forcing the existing intraday bootstrap instead of treating off-filter history as fresh.

A failed persistence write never disables the locally active filter. A failed full-universe reconcile does the opposite: the app remains in Filter CP rather than expose stale full-board data.

## Intraday history cache

`modules/market/realtime/intraday-5m-service.ts` keeps the complete canonical-universe history snapshot as one cache object:

1. Vercel Runtime Cache exact session bucket.
2. Upstash Redis exact session bucket when configured.
3. Today's latest known-good snapshot from Redis/Runtime Cache.
4. Provider fan-out only when no acceptable cached snapshot exists.

The provider path tries the DNSE 5-minute chart endpoint first and falls back to Yahoo when required. Fetch concurrency remains bounded at 12 symbols.

`/api/market/intraday` follows the same stale-while-live strategy and accepts today's latest known-good snapshot before starting provider fan-out. This matters because the browser immediately transitions to the DNSE realtime stream; blocking a hydration request for a perfect new 5-minute snapshot is worse than serving a slightly older valid chart shape and letting live ticks take over.

Vercel runtime audit on 2026-08-21 found three 20-second timeouts across `/api/market/index-candles` and `/api/market/intraday`. The cache-first and SSR-history-reuse changes directly target the intraday portion of that failure mode.

## Browser realtime path

- DNSE WebSocket messages are queued and flushed on `requestAnimationFrame` instead of creating one React update per raw socket callback.
- Live quote/history writes go into detached ref-backed stores. A socket tick replaces only the affected symbol entry rather than cloning the full quote map.
- Visible quote state is committed to React at most every 250ms (`MARKET_UI_COMMIT_MS`), approximately 4Hz.
- Sector and Top Movers ordering use a separate quote snapshot refreshed at most once per second (`MARKET_ORDERING_REFRESH_MS`). Price paint therefore does not force ranking/group sorting on every React commit.
- History updates replace only the affected ticker inside the ref-backed store and clone the outer history map at the next bounded UI commit.
- `LiveStockRow` and `LiveMoverCard` are memoized and only redraw when their visible quote/history/watch state changes.
- Mini-chart SVGs use the pre-regression pipeline: raw 5-minute history is hydrated without a second client-side time filter, while the current live price remains a fallback endpoint for symbols whose history provider is late. The ATO visibility gate remains separate and hides the entire chart until 09:15.
- Chart history stays bounded to the most recent display points.

The 250ms cadence is a UI paint policy, not a data-ingestion throttle. DNSE frames continue to be processed as they arrive; the browser merely publishes a bounded snapshot into React.

## GPU/compositing controls

The 2026-08-21 performance audit identified GPU compositing as a likely contributor to hot laptops:

- `.board-stock-row` previously used `transform: translateZ(0)`, which can promote roughly the full visible universe to persistent compositor layers. This forced promotion has been removed.
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

## Trading-day UI lifecycle

- The browser evaluates session boundaries in `Asia/Ho_Chi_Minh`, including while the tab was opened before the session or temporarily hidden.
- At 09:00 on weekdays, the board atomically restores stocks and indexes to their reference values, clears session volume/foreign flow and chart state, reconnects DNSE, and broadcasts a reset event to every open orderbook.
- Open orderbooks clear cached depth, matched trades, foreign flow, put-through rows, and chart history at the same boundary. In-flight Supabase/REST snapshots are ignored during ATO so yesterday's data cannot race back into the UI.
- Mini charts are deliberately blank from 09:00 through 09:14:59. DNSE 1-minute OHLC frames are accepted only from 09:15 through 14:29:59 and collapsed into one close per 5-minute bucket.
- From 14:30 the live mini chart is frozen. At EOD availability (14:46 onward), the intraday snapshot is reloaded and may add the final 14:45 point once.
- The 09:00 notification is a bounded, opaque status alert with reduced-motion support; it does not add persistent blur or compositor-heavy animation.

## Layout contract

- Six sector groups render in a responsive 1 / 2 / 3 / 6 column grid.
- Sector headers keep a fixed 72px height.
- Strong gainers use a static border highlight; permanent pulse animation is avoided.
- The watchlist is a horizontal section above the sector grid and remains compatible with full-board screenshots.
- Filter CP reuses the same row/card components and does not introduce a second quote/history state store.
- Filter CP's KFSP sector editor mirrors the same six board columns and enforces mandatory/minimum-one selection rules locally.

## Current performance status

The structural state-machine optimization is now implemented in the focused `perf/market-board-state-buffer` change:

1. ref-backed quote/history stores avoid full-map clones for each socket tick;
2. React quote snapshots are bounded to ~4Hz instead of ~10Hz;
3. ranking and sector average snapshots refresh at ~1Hz;
4. redundant first-mount intraday bootstrap is skipped when SSR history coverage is sufficient;
5. Filter CP narrows DNSE stock subscriptions to only its resolved ticker set.

This materially reduces the maximum parent-board update opportunities and ranking recomputation frequency, but it is not a claim about a fixed CPU/temperature percentage. Actual gains depend on live market message volume, browser, device, open order-book windows, and whether DevTools/other tabs are active.

If production is still hot after this change, profile before adding more throttling. The next likely structural boundary would be splitting high-frequency quote paint from aggregate header statistics or moving individual rows to a subscription/store model. Do not jump directly to virtualization because the screenshot workflow requires the complete DOM.

## Regression coverage

- `pnpm test:board-contract` covers layout, reference-price semantics, WebSocket buffering, 250ms quote commits, 1s ordering snapshots, SSR history reuse, low-composite rendering, and sparkline memo behavior.
- `tests/market-board-stock-filter-api.test.ts` covers authenticated persistence, settings merge, canonical symbol bounds, batch reconcile, and bounded snapshot fallback.
- `tests/market-board-stock-filter-ui.test.ts` covers portal placement, modal controls, daily cache identity, filtered WS scoping, fresh-quote gating, and full-board reconcile/remount behavior.
- `tests/market-board-filter-avg50-regression.test.ts` locks KLTB 50-session liquidity semantics, six-column KFSP grouping, bank/securities mandatory selection, and minimum-one-per-column behavior.
- `pnpm test:intraday` covers bucket replacement/rollover, replay ordering, unit normalization, and latest-session fallback.
- `pnpm test:supabase` covers final snapshot RLS and Auth/API security contracts.
- GitHub `Verify` also runs the production Next.js build before a PR can be considered release-ready.
