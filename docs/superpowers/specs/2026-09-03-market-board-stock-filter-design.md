# Market Board Stock Filter Design

Date: 2026-09-03
Status: Written spec ready for review
Branch: `feature/market-board-stock-filter`

## 1. Goal

Add a third market-board mode, **Filter CP**, next to **Tất cả** (`sector`) and **Top Movers** (`movers`).

When the user applies a filter, the board must:

- show only stocks satisfying the selected conditions;
- persist filter criteria per authenticated user;
- cache the resolved ticker list for the Vietnam trading day;
- subscribe DNSE stock WebSocket channels only to filtered symbols while Filter CP is active;
- restore the full canonical-universe subscription when the user returns to Tất cả or Top Movers;
- keep market-index channels realtime in every mode;
- preserve the current ref-backed quote/history stores, ~250 ms visible quote commits, and ~1 s ordering refresh.

The feature operates on the current canonical Bảng điện universe (Top 200), not every listed Vietnamese stock.

## 2. Current Architecture

### Server-rendered board model

`app/page.tsx` loads the canonical market universe and builds the initial board model in parallel from canonical board snapshots, broker batch quotes, and the shared 5-minute intraday snapshot. Existing UI cache behavior remains unchanged.

### Canonical universe

`lib/market-universe.ts` already exposes `ticker`, `exchange`, raw `sector`, market-cap metadata, and average-volume metadata. The client board model currently drops `exchange` and the raw sector label; this feature retains both.

### User persistence

`public.user_preferences.settings jsonb` is per-user and protected by ownership RLS. It is sufficient for one board-filter profile, so no new table or migration is required.

The generic `/api/me` route can replace the supplied `settings` object. Filter persistence therefore uses a dedicated endpoint that performs a server-side merge and cannot overwrite unrelated settings.

### WebSocket

`components/live-market-board-v2.tsx` currently derives one full-universe `symbolList` and uses it for DNSE stock channels including `tick.G1.json`, `top_price.G1.json`, `ohlc.1.json`, and `foreign.G1.json`. Market-index channels are independent and remain active in all modes.

## 3. Product Behaviour

### Board modes

```ts
type BoardMode = "sector" | "movers" | "filter"
```

The mode selector renders:

1. `Tất cả`
2. `Top Movers`
3. `Filter CP`

### Opening Filter CP

- No valid saved criteria: clicking Filter CP opens the modal.
- Valid saved criteria: clicking Filter CP activates the saved/daily-cached result immediately.
- While Filter CP is active, an edit affordance reopens the modal without first switching modes.

### Filter modal

#### Exchange

Multi-select: `HOSE`, `HNX`, `UPCOM`.

Default: all selected. Apply is disabled if none is selected.

#### Price

`Giá cổ phiếu > ... đ`

- blank or zero = no minimum-price constraint;
- otherwise use the latest valid board quote price at Apply time.

#### Liquidity

`Thanh khoản > ... cp`

- blank or zero = no minimum-liquidity constraint;
- otherwise use current-session cumulative matched volume (`LiveStockQuote.volume`) at Apply time;
- unit is shares, not traded value.

#### KFSP sector

- options are distinct raw canonical/KFSP sector labels, not the six grouped board-sector buckets;
- all sectors selected by default;
- user may uncheck sectors;
- Apply disabled if no sector remains selected.

### Modal footer

Show live preview count: `Đã chọn N / TOTAL CP`.

Actions: `Hủy`, `Áp dụng`.

Apply re-evaluates the filter, stores the daily ticker cache, persists criteria, closes the modal, and activates Filter CP.

## 4. Data Model

Extend the client board-universe stock shape with filtering metadata:

```ts
interface BoardUniverseStock {
  ticker: string
  rank: number
  sector: string
  kfspSector: string
  exchange: "HOSE" | "HNX" | "UPCOM" | string
  marketCapT: number
  lastClose: number | null
  lastCloseDate: string
}
```

`sector` remains the grouped presentation sector. `kfspSector` is the raw canonical/KFSP sector.

Persist one profile at `user_preferences.settings.marketBoard.stockFilter`:

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

Validation:

- exchanges normalized, unique, and restricted to supported values;
- price/volume finite and non-negative when present;
- sectors normalized, unique, non-empty, and intersected with current canonical sector options;
- invalid/obsolete saved criteria fall back to default modal values instead of breaking the board.

## 5. Persistence API

Create exactly:

`app/api/me/market-board-filter/route.ts`

### GET `/api/me/market-board-filter`

Returns authenticated user ID plus validated saved criteria or `null`.

### PUT `/api/me/market-board-filter`

- authenticate user;
- validate submitted criteria;
- read current `user_preferences.settings`;
- merge only `settings.marketBoard.stockFilter`;
- upsert the merged settings object for that user;
- return normalized persisted criteria;
- preserve every unrelated settings key.

No new Supabase schema is introduced.

## 6. Filter Evaluation

Filtering uses already-loaded board data.

For each stock:

1. exchange must be selected;
2. raw KFSP sector must be selected;
3. if `minPriceVnd` exists, price must be strictly greater than the threshold;
4. if `minVolumeShares` exists, current-session volume must be strictly greater than the threshold.

Data fallback at Apply time:

- price: current ref-backed/committed quote first, then valid SSR `lastClose` if current quote is absent;
- volume: current-session quote volume only; missing volume fails a positive liquidity threshold.

The resolved ticker set is frozen for that cache entry after Apply. Selected tickers continue updating realtime, but symbols do not automatically enter/leave as price or volume crosses a threshold. Opening the modal and pressing Apply re-evaluates immediately.

## 7. Daily Resolved-List Cache

Use browser `localStorage`; do not query the database to resolve the ticker set.

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

Key namespace:

`stockos:market-board-filter:v1:<userId>`

A cache hit requires exact match of:

- authenticated user ID;
- Vietnam date in `Asia/Ho_Chi_Minh`;
- canonical `universeRunId`;
- stable hash of normalized criteria.

Invalidate/recompute on criteria change, Vietnam-date change, canonical-universe version change, invalid JSON, or cached symbols that no longer belong to the current universe.

## 8. WebSocket Subscription Design

### Active stock symbols

```ts
const activeStockSymbols = mode === "filter"
  ? filteredTickers
  : fullUniverseTickers
```

All DNSE stock-channel payloads use only `activeStockSymbols`.

Index channels always remain active. Existing `VN30F1M` handling remains active where required by the OHLC/index-chart flow.

### Resubscription strategy

Do not rely on browser-side dynamic DNSE unsubscribe semantics.

- Build a stable `activeSymbolKey` from `activeStockSymbols`.
- Make the existing WebSocket lifecycle depend on this key.
- When it changes, cleanly dispose the old socket/effect.
- Reconnect/authenticate once.
- Subscribe using the new active symbol set.

With Filter CP active, the socket must not subscribe to stock symbols outside the filtered set.

### Returning to Tất cả / Top Movers

Switching from Filter CP back to a full-universe mode expands the active symbol set and may expose stale off-filter quote state. Therefore:

1. set stream state to `CONNECTING`;
2. reconnect WebSocket with the full canonical universe;
3. reconcile newly reactivated symbols through the dedicated current-quote endpoint below;
4. merge those quotes into the existing ref-backed store;
5. only then allow the stream to be considered synchronized/LIVE according to the existing connection lifecycle.

Create exactly:

`app/api/market/quotes/route.ts`

`GET /api/market/quotes?symbols=AAA,BBB,...`

Contract:

- authenticated market-board access required;
- normalize/unique requested symbols;
- reject symbols outside the current canonical board universe;
- enforce maximum requested count equal to canonical universe limit;
- use existing `fetchLiveBatchQuotes(symbols)`;
- apply very short live-session cache behavior compatible with board SSR caching;
- return a normalized quote map for requested symbols only.

This reconcile step prevents a stock with no immediate post-resubscription trade from silently retaining an old Filter-CP-era snapshot.

### Empty filtered result

If no stock matches, stock channel lists are empty. Only index/futures channels required by existing board/index functionality are subscribed. Never fall back to the full universe.

## 9. Rendering and Watchlist Behaviour

Filter CP renders `filteredUniverse` through existing board row/card components and existing quote/history stores; it does not introduce a second realtime store.

Tất cả and Top Movers keep their current rendering semantics.

The watchlist must not force out-of-filter symbols into the market-board WS subscription while Filter CP is active. Out-of-filter watchlist rows may show their last known snapshot until the board returns to a full-universe mode. Dedicated orderbook/detail flows keep using their own existing subscription lifecycle.

## 10. Error Handling

### Preference GET failure

- board remains usable;
- Filter CP opens with default criteria;
- modal shows one compact inline error stating saved filters could not be loaded.

### Preference PUT failure

- just-applied filter stays active locally;
- daily local cache is retained;
- modal/toast shows that cloud persistence failed and the criteria may not restore on another browser/device.

### Invalid local cache

Ignore it and recompute locally without surfacing an error.

### Zero matches

Filter CP stays active and renders an explicit empty state with an edit-filter action.

### WS/reconcile failure

Use existing reconnect/error machinery and display existing stream error state. Never silently switch Filter CP back to a full-universe subscription.

## 11. Performance and Integrity Constraints

Preserve:

- ref-backed per-symbol quote/history writes;
- `MARKET_UI_COMMIT_MS` (~250 ms);
- `MARKET_ORDERING_REFRESH_MS` (~1 s);
- no full quote-map clone on every tick.

Add no DB/data-source N+1 pattern:

- no query per filter predicate;
- no query per rendered stock;
- filter evaluation is O(canonical universe size);
- daily resolved-list cache avoids repeat resolution for unchanged criteria;
- quote reconcile is one bounded batch request on active-symbol expansion.

Security/data integrity:

- preference and quote endpoints require authenticated access;
- filter writes remain constrained to the caller's RLS-owned preferences row;
- current-quote endpoint accepts only canonical board symbols;
- localStorage cache is optimization only; current canonical universe is authority for symbol validity.

## 12. Implementation Surface

Expected files:

- `app/page.tsx` — add `exchange` and `kfspSector` to client universe; pass `auth.user.id` and `canonical.runId` to `LiveMarketBoardV2`.
- `components/live-market-board-v2.tsx` — add filter mode, filtered universe, active symbol set, modal integration, WS lifecycle, and quote reconcile.
- `components/market-board/stock-filter-modal.tsx` — focused modal UI.
- `lib/market-board/stock-filter.ts` — pure criteria normalization, predicate, hash, and sector-option helpers.
- `lib/market-board/stock-filter-cache.ts` — local daily-cache helpers.
- `app/api/me/market-board-filter/route.ts` — GET/PUT persistence merge.
- `app/api/market/quotes/route.ts` — bounded current-quote reconcile endpoint.
- focused tests under `tests/`.

Avoid unrelated refactors of stable market-board components.

## 13. Test Plan

### Pure tests

- criteria normalization;
- exchange, price, volume, sector predicates;
- combined predicate;
- missing-volume behavior;
- zero-result behavior;
- deterministic filter hash;
- cache invalidation by date, universe run, criteria, malformed payload, stale symbols.

### API tests

- unauthenticated access rejected;
- GET returns criteria/null;
- PUT merges only stock-filter settings;
- unrelated settings survive;
- invalid criteria rejected/normalized according to contract;
- quote endpoint rejects non-canonical symbols and oversized requests;
- quote endpoint returns only requested canonical symbols.

### WS regression tests

- Filter CP stock channels contain only filtered symbols;
- Tất cả/Top Movers use the full canonical symbols;
- index channels remain in every mode;
- empty result does not subscribe full universe;
- full-universe expansion enters reconnect/reconcile state before synchronized state.

### UI contract tests

- Filter CP is the third mode;
- modal contains all four requested filter groups;
- default exchanges/sectors are all selected;
- preview count renders;
- saved criteria activate without repeated setup;
- edit action reopens modal;
- zero-result empty state is explicit.

### Regression verification

Run existing market-board visual/performance tests, relevant auth/API tests, typecheck, and production build.

## 14. Acceptance Criteria

1. Filter CP exists next to Tất cả and Top Movers.
2. Exchange, minimum price, minimum current-session volume, and KFSP-sector filters work together.
3. Criteria persist per authenticated user and restore on a later visit.
4. Resolved ticker list is cached for the Vietnam day and invalidates on date, universe, or criteria changes.
5. Filter CP DNSE stock subscriptions contain only filtered tickers.
6. Market indexes remain realtime in Filter CP.
7. Returning to Tất cả/Top Movers restores the full universe and reconciles stale off-filter quotes before synchronized state.
8. Existing market-board render-frequency/performance protections remain intact.
9. No N+1 database/data-source pattern is introduced.
10. Existing board functionality passes regression tests.
