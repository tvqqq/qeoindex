# Market board data and performance model

Last updated: 2026-10-04

## Server bootstrap

The authenticated `/board` page verifies the Supabase server session before loading board data. The server then assembles one initial board model from bounded sources in parallel:

- Supabase orderbook snapshots for persisted reference/session/orderbook data.
- Broker batch quotes for current quote fields.
- The shared 5-minute intraday snapshot cache for mini-chart history.
- DNSE's current VN30 basket-membership endpoint, validated as exactly 30 unique symbols and cached for six hours. Provider time is retained as `asOf`; failed fetches/cache reads leave membership unavailable and do not fail board SSR.

The SSR model is cached through the QeoIndex UI cache with a short session-aware TTL. This lets the first render contain usable prices and chart history before the browser WebSocket becomes live. The cache namespace is versioned so a release that changes intraday completeness semantics can invalidate stale board payloads immediately.

When SSR already provides usable multi-point history for at least 95% of the canonical universe, the browser does not immediately call `/api/market/intraday` again on first mount. A session rollover still increments the reload key and forces a fresh browser history bootstrap.

## Filter CP

`Filter CP` is injected beside the existing `Tất cả` and `Top movers` controls without duplicating the market-board realtime store. It filters only the current canonical board universe (currently capped at Top 200). The filter editor may group raw sector labels into its six selection buckets, while the priceboard renders every distinct raw `kfspSector` label as its own industry column.

Supported criteria:

- exchange: HOSE / HNX / UPCOM, multi-select;
- minimum stock price in VND;
- minimum canonical 50-session average volume (`averageVolume50d`) in shares per session;
- raw canonical/KFSP sector labels selected through the filter editor's six selection buckets.

Board quotes are normalized internally in thousands of VND (for example `66.1` means `66,100 VND`). The filter helper converts those values to VND before applying the user-entered price threshold. Liquidity does **not** use the current-session matched volume: the threshold is evaluated from the canonical universe's `averageVolume50d`, so the same filter remains stable regardless of what time the user opens the board.

The KFSP sector editor follows `BOARD_SECTOR_GROUPS` in board order: `Ngân hàng`, `Chứng khoán`, `Bán lẻ`, `Bất động sản`, `Công nghiệp`, `Còn lại`. Each raw KFSP sector is assigned with `boardSectorGroupForSector`. All available sectors are selected by default. Bank and securities are mandatory; every other non-empty selection bucket must retain at least one selected raw sector. These six buckets belong only to the editor and do not combine the raw industry columns displayed by the priceboard. Saved criteria that violate the editor invariants are treated as invalid and the editor falls back to defaults.

Criteria persist per authenticated user at `user_preferences.settings.marketBoard.stockFilter`. The dedicated `/api/me/market-board-filter` route validates the payload and server-merges only the stock-filter key so unrelated preference settings survive the write. The existing `minVolumeShares` JSON key remains backward compatible, but its product meaning is now minimum 50-session average volume rather than current-session volume.

The resolved ticker list is cached in browser local storage under a per-user namespace. A cache entry is valid only when all of these identities still match:

- authenticated user ID;
- Vietnam date (`Asia/Ho_Chi_Minh`);
- canonical universe `runId`;
- deterministic hash of normalized criteria;
- every cached ticker still belongs to the current canonical universe.

Ticker membership is frozen for that valid daily cache entry. Quotes for the selected tickers remain realtime. Opening the editor and pressing `Áp dụng` recomputes membership from a fresh price snapshot while the KLTB 50-session criterion comes from the already-loaded canonical universe. If an already-filtered tab remains open across a Vietnam trading-day rollover, the market-session reset event invalidates that in-memory daily membership and re-resolves Filter CP once from a fresh quote snapshot before remounting the filtered board.

The filter shell deliberately passes only the filtered universe to the existing `LiveMarketBoard`. The board therefore derives its existing DNSE `symbolList` from only those tickers, so stock channels (`tick`, `top_price`, `ohlc`, `foreign`) stop receiving off-filter symbols while Filter CP is active. The full canonical universe is passed separately for industry identities and watch-search suggestions; market-index channels remain present independently. VN30 coverage is measured against the full canonical symbol set so filtering does not change membership data.

Returning to `Tất cả` or `Top movers` is guarded by `/api/market/quotes`: broker batch quotes and one bounded canonical snapshot query run in parallel, and the transition is rejected if any requested symbol still lacks a valid quote. After a successful reconcile the shell remounts the board with the full canonical universe and clears the history seed, forcing the existing intraday bootstrap instead of treating off-filter history as fresh.

A failed persistence write never disables the locally active filter. A failed full-universe reconcile does the opposite: the app remains in Filter CP rather than expose stale full-board data.

## Intraday history cache

`modules/market/realtime/intraday-5m-service.ts` keeps the complete canonical-universe history snapshot as one cache object:

1. Vercel Runtime Cache exact session bucket.
2. Upstash Redis exact session bucket when configured.
3. Today's latest known-good snapshot from Redis/Runtime Cache; during a live session it is accepted only when generated in the current or immediately previous 5-minute bucket, while lunch-break reuse must already cover the final 11:25 morning bar for the required universe coverage.
4. Provider fan-out only when no acceptable cached snapshot exists.

The provider path tries the DNSE 5-minute chart endpoint first and falls back to Yahoo when required. Fetch concurrency remains bounded at 12 symbols.

`/api/market/intraday` follows the same stale-while-live strategy, but reuse is session-aware. During live trading, an exact current bucket remains preferred and a `latest` fallback is accepted only from the current or immediately previous 5-minute bucket. During lunch, both exact `lunch_break` and `latest` snapshots must already cover the final 11:25 morning bar for enough rows; otherwise the service falls through to provider refresh. This keeps the complete 09:15–11:25 morning chart visible while realtime ingestion is paused, then allows realtime to continue from 13:00.

Vercel runtime audit on 2026-08-21 found three 20-second timeouts across `/api/market/index-candles` and `/api/market/intraday`. The cache-first and SSR-history-reuse changes directly target the intraday portion of that failure mode.

## Market context strip

The top strip is now a five-part market-context surface using the QeoIndex green / purple / platinum visual language:

- **VNINDEX**: latest-session real 1-minute index closes from DNSE public chart history, with the existing live VNINDEX quote appended as the transient endpoint.
- **Thanh khoản HOSE**: actual cumulative traded value from the VNINDEX market-index quote. The mini chart contains only real values observed since the current board tab opened. The previous-session comparison stays unavailable until an authoritative intraday traded-value history source can provide aligned timestamps; QeoIndex must not estimate this as volume × close.
- **VN30**: latest-session real 1-minute `VN30` index closes from the DNSE public index chart endpoint. This is the cash index, not VN30F1M and not an average of constituents.
- **Mua bán nước ngoài**: when the authenticated user has an active Finhay OAuth session, `/api/finhay/market-context` polls Finhay `get_index_foreign_trading(VNINDEX)` and the card upgrades to **Finhay full HOSE**, including provider constituent coverage. Its mini chart samples those authoritative cumulative buy/sell totals every 30 seconds during the active Vietnam session. Without Finhay OAuth, the card fails open to the canonical Top 200 aggregate and labels it **Top 200 partial**; under Filter CP only active-universe symbols continue updating while off-filter values remain the bootstrap snapshot. The two sources are never mixed into the same mini-chart series.
- **Tác động VNINDEX**: provider-supplied `basketInfluence` values from DNSE's VNINDEX basket-influence endpoint. The compact FireAnt-style signed bars render up to eight positive and eight negative contributors. `Tổng các mã hiển thị` sums only those displayed finite provider contributions; omitted fields are not treated as zero and the canonical Top 200 is never substituted for the provider's full-index scope.

`/api/market/board-context` is authenticated by the `market_board` feature gate, uses a short session-aware read-through cache, and returns partial results when one source is unavailable. `/api/finhay/market-context` is independently protected by the `finhay_live` feature gate and HTTP-only Finhay OAuth session; it never exposes provider tokens to the browser. VNINDEX/VN30 histories and the impact snapshot retain source/as-of metadata. The browser refreshes both context surfaces every 30 seconds while the centralized realtime quote stream continues to feed live endpoints; no extra provider WebSocket or parallel full quote store is created.

## Browser realtime path

- DNSE WebSocket messages are queued and flushed on `requestAnimationFrame` instead of creating one React update per raw socket callback.
- Live quote/history writes go into detached ref-backed stores. A socket tick replaces only the affected symbol entry rather than cloning the full quote map.
- Visible quote state is committed to React at most every 250ms (`MARKET_UI_COMMIT_MS`), approximately 4Hz.
- VN30 and each raw industry column sort from a separate quote snapshot refreshed at most once per second (`MARKET_ORDERING_REFRESH_MS`). Price paint therefore does not force ranking/column sorting on every React commit.
- History updates replace only the affected ticker inside the ref-backed store and clone the outer history map at the next bounded UI commit.
- Compact priceboard rows and `LiveMoverCard` are memoized and only redraw when their visible quote/watch state changes. The compact rail has no mini charts; Top movers and the orderbook retain their existing history display.
- Mini-chart SVGs use the pre-regression pipeline: raw 5-minute history is hydrated without a second client-side time filter, while the current live price remains a fallback endpoint for symbols whose history provider is late. The ATO visibility gate remains separate and hides the entire chart until 09:15.
- Chart history stays bounded to the most recent display points.

The 250ms cadence is a UI paint policy, not a data-ingestion throttle. DNSE frames continue to be processed as they arrive; the browser merely publishes a bounded snapshot into React.

## GPU/compositing controls

The 2026-08-21 performance audit identified GPU compositing as a likely contributor to hot laptops:

- `.board-stock-row` previously used `transform: translateZ(0)`, which can promote roughly the full visible universe to persistent compositor layers. This forced promotion has been removed.
- The authenticated board page applies `market-board-performance.module.css`, which disables expensive `backdrop-filter` blur utilities inside the dense market-board surface while preserving the opaque glass-like backgrounds, borders, and shadows.
- Dense rows use `contain: layout style` to reduce unnecessary layout propagation without using `content-visibility`.
- Drop-shadow filters inside stock rows are suppressed on the performance surface.

Do **not** reintroduce `content-visibility` or naive row virtualization without redesigning the screenshot flow. QeoIndex captures the complete board DOM for screenshots; earlier visibility-based rendering shortcuts can omit off-screen industries from the exported image. Screenshot capture uses an isolated off-screen clone of the board, expands the horizontal industry rail and tallest column, and removes the clone in `finally`; it does not move the user's visible scroll position or saved column order.

## Price/reference rules

- Daily performance is anchored to the official/reference previous close, never to the session open.
- The initial SSR quote uses the best available live/snapshot/reference source in that order.
- DNSE 1-minute OHLC events are normalized into the board's 5-minute chart buckets.
- Price-unit normalization prevents feeds expressed in thousands from flattening VND-scaled histories.
- After close, cached intraday history and persisted snapshots keep prices/charts visible without labeling them as a live WebSocket tick.

## Trading-day UI lifecycle

- The browser evaluates session boundaries in `Asia/Ho_Chi_Minh`, including while the tab was opened before the session or temporarily hidden.
- At 09:00 on weekdays, the board atomically restores stocks and indexes to their reference values, clears session volume/foreign flow and chart state, reconnects realtime transport, and broadcasts a reset event to every open orderbook.
- Trading-date rollover is detected independently from UI phase transitions. If a suspended/throttled tab skips ATO and resumes later in the session, the board still resets exactly once for the new Vietnam trading day, reloads current-day intraday history, and reconciles fresh stock quotes/references through `/api/market/quotes`.
- The quote reconcile is session-guarded and preserves a newer realtime quote if one arrives while the request is in flight; its current-session reference may still update the baseline. The reconcile endpoint accepts a same-session snapshot as-is, but a snapshot from exactly the previous trading session is downgraded to a neutral previous-close fallback with zero session volume; older snapshots fail closed instead of carrying stale volume/reference/limit prices into the new day.
- Open orderbooks clear cached depth, matched trades, foreign flow, put-through rows, and chart history at the same boundary. In-flight Supabase/REST snapshots are ignored during ATO so yesterday's data cannot race back into the UI.
- Mini charts are deliberately blank from 09:00 through 09:14:59. DNSE 1-minute OHLC frames are accepted only from 09:15 through 14:29:59 and collapsed into one close per 5-minute bucket.
- During the 11:30–13:00 lunch break, realtime frames are ignored but the already-completed morning mini-chart remains visible through the 11:25 bucket. A fresh page load during lunch must hydrate that morning history rather than reuse an earlier partial-session cache.
- From 14:30 the live mini chart is frozen. At EOD availability (14:46 onward), the intraday snapshot is reloaded and may add the final 14:45 point once.
- The 09:00 notification is a bounded, opaque status alert with reduced-motion support; it does not add persistent blur or compositor-heavy animation.

## Layout contract

- `Bảng điện` is the default view on server render and for new users. It retains the original six grouped sector columns, 72px headers, per-ticker mini charts, and optional watchlist row.
- `Bảng ngành` is a separate explicit view in the same `LiveMarketBoard` instance. The selected view is stored per user after client hydration; switching views leaves the quote/history stores, subscriptions, orderbook handlers, and filter scope mounted once.
- `Tất cả` and `Top movers` remain independent board modes. Search and Filter CP continue to scope the active ticker universe while either view is selected.
- The industry view uses a horizontally scrollable rail with fixed first columns `Theo dõi` and `VN30`, followed by every distinct raw KFSP industry label (falling back to the canonical sector label only when KFSP is blank). It does not combine industries into the filter editor's six groups.
- Industry columns can be dragged from anywhere on the header with pointer input or reordered from the keyboard with the focused handle and arrow keys. Per-user order is stored in local storage; newly discovered labels are appended, removed labels are dropped, and the two left anchors remain fixed. Reset restores securities, real estate, banks, then the remaining raw labels alphabetically.
- Industry columns have compact headers and quote tables with `Mã`, `Giá`, `+/- %`, and `KL`. Rows sort valid current quotes first and then by percent change descending. They do not draw mini charts; the existing classic and Top movers rows keep their chart behavior.
- Industry row backgrounds use percent direction and bounded magnitude intensity. Ceiling/floor colors require actual provider limit prices matching the current price; no percentage-derived price limits are inferred. Missing or invalid quote values stay unavailable instead of being shown as zero.
- VN30 members come from DNSE's live basket-influence response rather than a hardcoded list. If membership is unavailable, the column stays in its anchored position and shows an unavailable state. Partial canonical coverage is shown explicitly; complete membership adds only source/time metadata to the header title so the quote rows stay aligned.
- The top market-context strip keeps VNINDEX, HOSE liquidity, VN30, foreign flow, and VNINDEX impact in separate rounded dark cards using QeoIndex green/purple/platinum accents. A mini chart is rendered only after enough real points exist; unavailable history remains an explicit text state rather than a synthetic path.
- Strong gainers use a static border highlight; permanent pulse animation is avoided.
- In `Bảng ngành`, the first `Theo dõi` column is always visible in the rail. It reads persisted symbols after hydration to keep the server and first client render consistent, and lets users search the canonical board universe to add symbols.
- Filter CP reuses the same row/card components and does not introduce a second quote/history state store.
- Filter CP's KFSP sector editor keeps its six selection buckets and enforces mandatory/minimum-one selection rules locally; those editor buckets do not combine the raw industry columns in the priceboard.

## Current performance status

The structural state-machine optimization is now implemented in the focused `perf/market-board-state-buffer` change:

1. ref-backed quote/history stores avoid full-map clones for each socket tick;
2. React quote snapshots are bounded to ~4Hz instead of ~10Hz;
3. ranking plus classic sector/industry-column average snapshots refresh at ~1Hz;
4. redundant first-mount intraday bootstrap is skipped when SSR history coverage is sufficient;
5. Filter CP narrows DNSE stock subscriptions to only its resolved ticker set.

This materially reduces the maximum parent-board update opportunities and ranking recomputation frequency, but it is not a claim about a fixed CPU/temperature percentage. Actual gains depend on live market message volume, browser, device, open order-book windows, and whether DevTools/other tabs are active.

If production is still hot after this change, profile before adding more throttling. The next likely structural boundary would be splitting high-frequency quote paint from aggregate header statistics or moving individual rows to a subscription/store model. Do not jump directly to virtualization because the screenshot workflow requires the complete DOM.

## Regression coverage

- `pnpm test:board-contract` covers layout, reference-price semantics, WebSocket buffering, 250ms quote commits, 1s ordering snapshots, SSR history reuse, low-composite rendering, and sparkline memo behavior.
- `tests/market-board-industry-priceboard.test.ts` covers raw industry labels/order reconciliation, fixed anchors and reorder operations, finite-quote sorting/averages, sign/intensity/official-limit colors, DNSE VN30 membership validation/cache bounds, and filtered realtime scope.
- `tests/market-board-market-context.test.ts` locks verified VNINDEX/VN30 candle sources, provider `basketInfluence` normalization, displayed-only impact totals, Finhay full-HOSE foreign-flow upgrade/fallback separation, authenticated routes, and explicit unavailable state for the unresolved liquidity comparison.
- `tests/market-board-stock-filter-api.test.ts` covers authenticated persistence, settings merge, canonical symbol bounds, batch reconcile, and bounded snapshot fallback.
- `tests/market-board-stock-filter-ui.test.ts` covers portal placement, modal controls, daily cache identity, filtered WS scoping, fresh-quote gating, and full-board reconcile/remount behavior.
- `tests/market-board-filter-avg50-regression.test.ts` locks KLTB 50-session liquidity semantics, six-column KFSP grouping, bank/securities mandatory selection, and minimum-one-per-column behavior.
- `pnpm test:intraday` covers bucket replacement/rollover, replay ordering, unit normalization, latest-session fallback, live-session freshness gating, and lunch-break morning-tail completeness for cached mini-chart snapshots.
- `pnpm test:supabase` covers final snapshot RLS and Auth/API security contracts.
- GitHub `Verify` also runs the production Next.js build before a PR can be considered release-ready.
