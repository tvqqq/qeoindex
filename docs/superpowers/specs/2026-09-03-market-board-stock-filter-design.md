# Market Board Stock Filter Design

Date: 2026-09-03
Status: Approved in chat; written-spec review pending
Branch: `feature/market-board-stock-filter`

## 1. Goal

Add a third market-board mode, **Filter CP**, next to the existing **Tất cả** (`sector`) and **Top Movers** (`movers`) modes.

When the user applies a filter, the board must:

- show only stocks satisfying the selected conditions;
- persist filter criteria per authenticated user so the user does not need to configure them again on the next visit;
- cache the resolved ticker list for the Vietnam trading day to avoid repeated database/data-source work;
- subscribe the market WebSocket only to filtered stock symbols while Filter CP is active;
- restore the full canonical universe subscription when the user returns to Tất cả or Top Movers;
- keep market-index channels realtime in every mode;
- preserve the current market-board performance architecture (ref-backed quote/history stores, ~250 ms visible quote commits, ~1 s ordering refresh).

## 2. Current Architecture Relevant to This Change

### 2.1 Server-rendered board model

`app/page.tsx` currently loads the canonical market universe and builds the initial board model from bounded sources in parallel:

- canonical board snapshots;
- broker batch quotes;
- shared 5-minute intraday snapshot data.

That model is cached by the existing UI cache for a short market-session TTL.

### 2.2 Canonical universe

`lib/market-universe.ts` already exposes canonical stock metadata including:

- `ticker`;
- `exchange`;
- raw `sector`;
- market-cap and average-volume metadata.

The client board model currently reduces this metadata and does not retain `exchange` or the original sector label. This feature needs both values client-side.

### 2.3 User persistence

`public.user_preferences` already has a per-user `settings jsonb` field protected by ownership RLS. This is sufficient for a single board-filter profile and avoids introducing another table.

The generic `/api/me` settings update replaces the `settings` object passed by the client. Filter persistence therefore must use a dedicated endpoint/helper that performs a server-side merge and does not overwrite unrelated settings.

### 2.4 WebSocket

`components/live-market-board-v2.tsx` currently derives one `symbolList` from the entire board universe and subscribes it to DNSE stock channels such as:

- `tick.G1.json`;
- `top_price.G1.json`;
- `ohlc.1.json`;
- `foreign.G1.json`.

Market index channels are subscribed separately and must remain active regardless of board mode.

## 3. Product Behaviour

### 3.1 Modes

The mode selector becomes:

1. `Tất cả`
2. `Top Movers`
3. `Filter CP`

Internally the mode union becomes equivalent to:

```ts
type BoardMode = "sector" | "movers" | "filter"
```

### 3.2 Opening Filter CP

- If no saved criteria are available yet, clicking Filter CP opens the filter modal.
- If valid saved criteria exist, clicking Filter CP immediately activates the last resolved/saved filter state.
- The active Filter CP control exposes an edit affordance so the modal can be reopened without leaving the mode.

### 3.3 Filter modal

The modal contains four filter groups.

#### Exchange

Multi-select values:

- HOSE
- HNX
- UPCOM

Default: all selected.

At least one exchange must remain selected before Apply is enabled.

#### Price

Input: `Giá cổ phiếu > ... đ`

Semantics:

- blank or zero means no minimum-price constraint;
- otherwise the predicate uses the latest valid board quote price at Apply time.

#### Liquidity

Input: `Thanh khoản > ... cp`

Semantics:

- blank or zero means no minimum-liquidity constraint;
- otherwise the predicate uses current-session cumulative matched volume (`LiveStockQuote.volume`) at Apply time;
- unit is shares, not traded value.

#### KFSP sector

- Options are the distinct raw sector labels from the canonical universe metadata, not the six grouped board-sector buckets used for board presentation.
- All sectors are selected by default.
- The user may uncheck sectors to hide them.
- At least one sector must remain selected before Apply is enabled.

### 3.4 Modal footer

The modal shows a live preview count in the form:

`Đã chọn N / TOTAL CP`

Actions:

- `Hủy`
- `Áp dụng`

Apply updates the active filtered ticker set, persists criteria, updates the daily cache, closes the modal, and activates Filter CP mode.

## 4. Data Model

### 4.1 Client board universe

Extend `BoardUniverseStock` / `LiveBoardStock` data supplied by the page with the metadata needed for filtering:

```ts
interface BoardUniverseStock {
  ticker: string
  rank: number
  sector: string               // existing grouped/presentation sector
  kfspSector: string            // raw canonical sector label
  exchange: "HOSE" | "HNX" | "UPCOM" | string
  marketCapT: number
  lastClose: number | null
  lastCloseDate: string
}
```

`app/page.tsx` maps `canonical.stocks[].exchange` and `canonical.stocks[].sector` into these fields while preserving the current grouped `sector` used by board layout.

### 4.2 Persisted criteria

Store one filter profile under `user_preferences.settings.marketBoard.stockFilter`.

Proposed shape:

```ts
interface StockFilterCriteriaV1 {
  version: 1
  exchanges: Array<"HOSE" | "HNX" | "UPCOM">
  minPriceVnd: number | null
  minVolumeShares: number | null
  sectors: string[]
  updatedAt: string
}
```

Validation rules:

- exchanges are normalized/unique and restricted to supported values;
- price and volume must be finite, non-negative numbers when present;
- sectors are normalized/unique non-empty strings and intersected with current canonical sector options;
- payload size remains bounded by the existing preferences settings limit.

Invalid or obsolete saved criteria fail closed to safe defaults in the modal rather than breaking the board.

## 5. Persistence API

Add an authenticated endpoint dedicated to the market-board filter, for example:

`/api/me/market-board-filter`

### GET

Returns the validated saved criteria or `null`.

### PUT/PATCH

- validates the submitted criteria;
- reads the current `user_preferences.settings` value;
- merges only `settings.marketBoard.stockFilter`;
- upserts the resulting settings object for the authenticated user;
- never replaces unrelated settings keys.

No new database table or migration is required.

## 6. Filter Evaluation

Filtering is performed against data already present in the board client model.

For each stock:

1. exchange must be selected;
2. raw KFSP sector must be selected;
3. if `minPriceVnd` exists, latest valid quote price must be greater than the threshold;
4. if `minVolumeShares` exists, current-session cumulative quote volume must be greater than the threshold.

Price/volume fallback rule at Apply time:

- prefer current `quotesRef` / committed quote;
- price may fall back to the stock's valid SSR `lastClose` only when no current quote is available;
- volume has no historical fallback because the requested meaning is current-session liquidity; a missing volume does not pass a positive liquidity threshold.

The filtered ticker set is frozen after Apply for the rest of that cache entry. Quotes for those tickers continue updating realtime, but symbols do not automatically enter/leave the result as price or volume crosses a threshold. Reopening the modal and pressing Apply re-evaluates immediately.

This behaviour makes daily caching deterministic and matches the approved product assumption.

## 7. Daily Resolved-List Cache

The resolved list must not require a database query.

Use a browser local-storage cache scoped by authenticated user and filter identity. A cache entry contains:

```ts
interface StockFilterDailyCacheV1 {
  version: 1
  userId: string
  vietnamDate: string
  universeRunId: string
  filterHash: string
  tickers: string[]
  resolvedAt: string
}
```

Suggested key namespace:

`stockos:market-board-filter:v1:<userId>`

A cache hit is valid only when all of the following match:

- authenticated user ID;
- Vietnam date (`Asia/Ho_Chi_Minh`);
- canonical universe `runId`;
- stable hash of normalized criteria.

Invalidate/recompute when:

- the user changes filter criteria;
- the Vietnam date changes;
- canonical universe version changes;
- cached ticker payload contains symbols no longer in the current universe;
- cache JSON is invalid.

Because resolution uses the already-loaded board universe and quote state, there is no repeated DB scan to compute the filter result.

## 8. WebSocket Subscription Design

### 8.1 Active stock symbols

Derive:

```ts
const activeStockSymbols = mode === "filter"
  ? filteredTickers
  : fullUniverseTickers
```

The DNSE stock-channel payload is built exclusively from `activeStockSymbols`.

Market-index channels remain unchanged and are included in all modes.

`VN30F1M` remains included where the existing OHLC/index-chart flow requires it.

### 8.2 Safe resubscription

Do not depend on undocumented/incompletely tested dynamic unsubscribe behaviour in the browser component.

Preferred implementation:

- make the existing WebSocket effect depend on a stable active-symbol key;
- when the active symbol set changes, cleanly dispose the previous socket/effect;
- reconnect/authenticate once;
- subscribe using the new symbol set.

This ensures that while Filter CP is active, the connection no longer receives realtime stock streams for symbols outside the filter.

### 8.3 Returning to full-universe modes

Switching from Filter CP to Tất cả or Top Movers must not treat old off-filter quotes as freshly synchronized.

On active-symbol expansion:

1. set stream state to `CONNECTING`;
2. reconnect the WebSocket with the full canonical universe;
3. reconcile newly reactivated stock quotes with a bounded current quote snapshot before marking the board fully synchronized;
4. resume normal realtime updates.

If a lightweight authenticated current-quote endpoint does not already exist, add one backed by the existing `fetchLiveBatchQuotes(symbols)` path. It should accept only symbols from the canonical board universe, bound the maximum symbol count to the universe limit, and use the same very short live-session caching principles as the board SSR path.

This reconcile step prevents a symbol that had no new trade immediately after resubscription from remaining silently stale.

### 8.4 Index correctness

Index channels are independent of Filter CP and always stay realtime:

- VNINDEX
- VN30
- HNX
- UPCOM

## 9. Rendering Behaviour

### Filter CP mode

Render only `filteredUniverse` while preserving existing stock-row/card components and quote/history stores.

The feature should reuse the existing ref-backed quote/history architecture rather than create a second realtime state store.

### Tất cả / Top Movers

Their existing visual semantics remain unchanged except for using the full-universe active subscription again.

Watchlist behaviour remains independent from filtering. If a watchlist section is rendered outside the filtered board sections, it must not force realtime subscriptions for out-of-filter symbols while Filter CP is active. Out-of-filter watchlist rows may display their last known snapshot until the user leaves Filter CP or opens a dedicated detail/orderbook flow that already manages its own subscription.

## 10. Error Handling

### Preferences GET fails

- board continues to operate normally;
- opening Filter CP uses defaults;
- surface a compact non-blocking error in the modal if appropriate.

### Preferences save fails

- keep the just-applied filter active locally;
- show that persistence failed so the user knows the setting may not survive another browser/device session;
- do not discard the local result.

### Daily cache invalid

Ignore and recompute locally.

### Filter matches zero symbols

- Filter CP stays active;
- render an explicit empty state;
- WebSocket subscribes only index/futures channels needed by the board, with no stock symbols.

### WebSocket resubscription fails

Use the existing reconnect/error state machinery. Do not silently fall back to receiving the full universe while Filter CP is selected.

## 11. Performance Constraints

Must preserve the current market-board performance protections:

- no full quote-map clone on every tick;
- visible quote commit remains bounded by `MARKET_UI_COMMIT_MS` (~250 ms);
- ordering work remains decoupled at `MARKET_ORDERING_REFRESH_MS` (~1 s);
- no DB query per filter predicate or per rendered stock;
- filter predicate evaluation is linear in the canonical universe size and only recomputed when criteria or required quote state changes for preview/apply;
- daily resolved ticker cache avoids repeated filter resolution across remounts/navigation for unchanged criteria.

## 12. Security and Data Integrity

- Filter preference APIs require authenticated users.
- Persistence writes only the caller's RLS-owned `user_preferences` row.
- Server validates and normalizes all saved settings.
- Any current-quote reconcile endpoint restricts requested symbols to the canonical board universe and enforces a bounded symbol count.
- Client-side cache is an optimization only; the current canonical universe is the authority for symbol validity.

## 13. Expected Files / Components

Likely implementation surface:

- `app/page.tsx` — pass raw exchange/KFSP sector, user ID, universe run ID as needed.
- `components/live-market-board-v2.tsx` — mode, modal integration, filtered universe, active subscription set, resync lifecycle.
- new focused filter UI component such as `components/market-board/stock-filter-modal.tsx`.
- new pure filter/cache helpers under `lib/market-board/`.
- `app/api/me/market-board-filter/route.ts` — validated per-user persistence with JSON merge.
- optional lightweight current-quote reconciliation route under `app/api/market/` if no suitable existing route is available.
- tests for filter logic, persistence merge, WS subscription contract, UI contract, and performance regressions.

Avoid unrelated refactors of the already stable market-board components.

## 14. Test Plan

### Pure/unit tests

- criteria normalization;
- exchange multi-select predicate;
- price threshold predicate;
- current-session volume threshold predicate;
- KFSP raw-sector predicate;
- combined filter predicate;
- zero-result behaviour;
- deterministic filter hash;
- daily cache validation/invalidation for date, universe run, criteria change, malformed payload.

### API tests

- unauthenticated access rejected;
- valid GET returns criteria;
- valid write merges only the stock-filter key;
- unrelated settings survive the write;
- invalid exchange/sector/numeric payload rejected or normalized according to contract;
- payload-size bound preserved.

### WebSocket regression tests

- Filter CP stock channels contain only filtered symbols;
- Tất cả and Top Movers contain the full canonical symbol set;
- market-index channels remain present in all modes;
- empty filter result does not accidentally subscribe the full universe;
- mode expansion triggers reconnect/reconcile state rather than reusing stale off-filter data.

### UI contract tests

- third Filter CP tab exists beside current modes;
- modal exposes all four requested filter groups;
- all exchanges and all KFSP sectors are selected by default;
- preview count is rendered;
- saved criteria can activate Filter CP without forcing first-time setup again;
- edit flow reopens modal;
- empty result has an explicit state.

### Regression verification

Run the existing market-board visual/performance tests, relevant auth/API tests, typecheck, and production build before completion.

## 15. Acceptance Criteria

The feature is accepted when:

1. Filter CP exists next to Tất cả and Top Movers.
2. Exchange, minimum price, minimum current-session volume, and KFSP-sector filters work together.
3. Filter criteria persist per user and are restored on a later visit.
4. The resolved ticker list is cached for the Vietnam day and invalidated correctly when date, universe, or criteria change.
5. While Filter CP is active, DNSE stock realtime subscriptions contain only filtered tickers.
6. Market indexes remain realtime in Filter CP.
7. Returning to Tất cả/Top Movers restores the full universe and reconciles stale off-filter quotes before considering the board synchronized.
8. Existing market-board render-frequency/performance protections remain intact.
9. No N+1 database/data-source pattern is introduced.
10. Existing board functionality continues to pass regression tests.
