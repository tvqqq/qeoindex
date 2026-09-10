# QEO-172 Chart Performance Design

## Context

QEO-171 has production-accepted the Stock Detail chart behavior and data correctness. QEO-172 now owns perceived latency and unnecessary repeated chart-data work without weakening the canonical HOT/COLD/provider boundaries.

QEO-97 already shipped useful foundations:

- a per-tab closed-range response cache in `components/stock-detail/chart/chart-history.ts` bounded to 24 entries and a 10-minute TTL;
- fail-closed admission: only `CLOSED + COMPLETE + no gaps + no integrity issues + no errors` is cached;
- exact in-flight request coalescing;
- 5-second live-tail refresh using the fresh/no-store request path;
- total `Server-Timing: chart-data`, bar-count and payload-byte headers;
- the existing production budgets in `docs/chart-performance-budget.md`.

The current implementation still has four material gaps:

1. `requestChartRange()` always sends `cache: "no-store"` and `/api/market/ohlcv` always replies `Cache-Control: no-store`, so a validated closed response cannot benefit from the browser HTTP cache across reloads.
2. During live sessions an initial lower-timeframe request treats the historical window and the current session as one fresh request. Stable prior-session history therefore misses the existing closed-range cache.
3. `useChartHistory()` resets non-1D bars to `[]` when ticker/timeframe changes. The chart can blank while the replacement dataset is loading.
4. `StockDetailWorkstation` caches only stock-detail payloads that have already been selected. It does not prefetch the previous/next visible watchlist ticker or its current chart timeframe.

Production evidence from the final QEO-171 run also showed every observed `/api/market/ohlcv` server request as a Vercel cache MISS. That is not a p50/p95 benchmark, but it confirms there is no reusable HTTP response cache layer today.

## Goals

1. Measure before optimizing: capture API total, canonical PostgreSQL/HOT, derived cache, COLD object, provider fetch, aggregation, serialization and browser render/hydration latency.
2. Split stable prior-session history from the mutable current trading-date tail for intraday/hourly timeframes.
3. Reuse only validated stable closed ranges through the existing per-tab cache plus safe private browser HTTP caching.
4. Keep the current chart visible until the full replacement ticker/timeframe dataset is ready, then swap ticker/timeframe label + data atomically.
5. Prefetch only the immediately adjacent previous/next ticker in the current visible watchlist order and only the active timeframe's stable closed slice.
6. Preserve all QEO-147/QEO-148/QEO-149/QEO-150 correctness and readiness rules.
7. Capture before/after p50/p95 on VIC + VCB for 1D, 4h, 1h and 15m.

## Non-goals

- No new charting library.
- No new persistent storage platform.
- No canonical data cache that bypasses RAW 1m or canonical Daily.
- No full-universe prefetch.
- No caching of the current trading date's intraday/hourly tail as immutable data.
- No weakening of gap, correction, integrity, provider-error or QEO-147 readiness checks.
- No UI-polish scope from QEO-173 beyond the loading behavior needed to avoid a blank chart.

## Current flow

```text
watchlist/timeframe interaction
        |
        v
StockDetailWorkstation / StockTradingViewChartData
        |
        v
useChartHistory
        |
        +--> requestChartRange() --------> /api/market/ohlcv (always no-store)
        |                                   |
        |                                   v
        |                               getChartOhlcv
        |                                   |
        |                                   +--> Daily PostgreSQL
        |                                   +--> derived 1h readiness/cache
        |                                   +--> HOT raw 1m
        |                                   +--> COLD raw 1m
        |                                   +--> provider recovery/live tail
        |
        +--> requestFreshChartRange() ---> same route, no-store
```

The per-tab cache sits before the route, but it cannot help a cold reload and is bypassed entirely for live-session initial requests.

## Target architecture

### 1. Measured chart-data pipeline

Add an optional request-scoped performance recorder to the chart-data service dependencies. The recorder accumulates elapsed time and call counts for:

- `daily-db` — canonical completed Daily PostgreSQL reads;
- `hot-db` — raw 1m HOT/coverage PostgreSQL reads and writes that occur on the UI request path;
- `derived-cache` — derived-hourly readiness/source proof and derived-row reads;
- `cold-object` — verified COLD object/manifest reads;
- `provider-fetch` — external provider latency;
- `aggregation` — deterministic timeframe aggregation/merge work.

`app/api/market/ohlcv/route.ts` creates one recorder per request and adds:

- total `chart-data` timing;
- every non-zero internal stage timing;
- `serialization` timing around `JSON.stringify`;
- existing bar-count and payload-byte headers.

The recorder is observational only. It must not alter error handling, source selection, readiness, or response payload semantics.

The browser chart runtime exposes a deterministic rendered-dataset key after Lightweight Charts has applied the new series data. Production Playwright measures interaction-to-render-ready time without relying on animation timing or screenshots.

### 2. Stable closed history vs current trading-date tail

For `1m/15m/30m/1h/2h/4h`, client history planning uses a conservative trading-date boundary:

- On **any Vietnam trading date**, regardless of whether phase is `PRE_MARKET`, `MORNING`, `LUNCH_BREAK`, `AFTERNOON` or `EOD_CLOSED`, the stable closed slice ends at `08:59:59 ICT` of that date.
- The current-date tail begins at `09:00:00 ICT` and ends at request `to`. It is always fetched through the fresh/no-store path for the rest of that trading date, including after market close.
- On a **non-trading date**, the whole bounded request may be treated as closed and there is no mutable current-date tail.
- `>=1D` remains completed Daily and does not gain an intraday live tail.

This deliberately keeps the just-finished trading date outside immutable caches until a later calendar date. The extra fresh range is small, and the rule avoids hiding same-day late corrections or terminal reconciliation behind a 10-minute acceleration cache.

The split is a client transport optimization only. Canonical aggregation and provider/storage behavior remain server authoritative.

The initial current-date tail request may contain all bars from 09:00 to `to` so the active 15m/30m/1h/2h/4h bucket can be reconstructed deterministically. Subsequent refreshes use the same current-date boundary rather than a 12-hour wall-clock lookback, avoiding overnight/lunch work while preserving session-aware aggregation.

### 3. Closed-range cache layers

Keep QEO-97's module-level cache as L0 and make admission depend on both result integrity and the stable-date boundary:

- response must have `coverage.complete=true`, `metadata.sessionState=CLOSED`, no gaps, no integrity issues and no errors;
- requested range must be wholly stable according to the rule above and must not extend into the future;
- cache keys remain ticker + resolution + exact range;
- maximum 24 entries, TTL 10 minutes;
- in-flight request dedupe stays separate from response caching;
- expose a read-only synchronous `peekClosedChartRange()` so a prefetched stable slice can seed preparation without another request.

For a safe stable response, `/api/market/ohlcv` returns `Cache-Control: private, max-age=600` and `Vary: Cookie`. The route may emit this only when both the response admission rule and the stable-date/future-range rule pass. Every other success response and every error remains `Cache-Control: no-store`.

`requestFreshChartRange()` always uses `cache: "no-store"`; stable closed requests use the browser default cache mode.

This browser-private cache has the same bounded staleness envelope already accepted for the existing 10-minute in-memory cache. It is not canonical and cannot make a PARTIAL/error response sticky.

### 4. Prepared initial dataset and atomic timeframe transitions

Introduce one transport object:

```ts
type PreparedChartHistory = {
  ticker: string
  timeframe: ChartTimeframe
  range: { from: number; to: number }
  result: ChartHistoryResponse
}
```

`prepareInitialChartHistory()` requests the stable closed slice through `requestChartRange()` and the current-date tail, when present, through `requestFreshChartRange()`. It merges both into one complete initial result using the existing timestamp merge semantics. A prepared result is a one-shot handoff, not a second permanent cache.

`StockTradingViewChartData` owns `requestedTimeframe` separately from `committedTimeframe`.

When the user requests a new timeframe:

1. call `prepareInitialChartHistory()` for the target timeframe;
2. keep the currently committed chart rendered while both required target slices are loading;
3. if preparation succeeds and is still the latest intent, commit the new timeframe and pass the prepared result into `useChartHistory` as the initial handoff;
4. the committed chart consumes that prepared result without re-fetching the exact initial dataset, then continues normal current-date refreshes.

For `1D`, usable `seedDailyBars` may satisfy preparation immediately.

If preparation fails, keep the old chart visible and surface the existing loading/error affordance. Do not relabel old bars as the requested timeframe.

### 5. Bounded adjacent ticker prefetch and atomic ticker transitions

`StockDetailWorkstation` already knows the current visible watchlist order and active chart timeframe. After the active ticker has settled, schedule low-priority prefetch for at most two symbols:

- previous visible watchlist ticker;
- next visible watchlist ticker.

For each adjacent symbol, prefetch in parallel:

- `/api/insights/stock-detail?ticker=...` into the existing workstation cache;
- **only the active timeframe's stable closed slice** into the existing chart L0/browser cache.

Do not prefetch the current trading-date tail in the background. That tail is fetched fresh only when the user actually navigates to the target.

No drawing or user-settings payload is copied. Drawings remain ticker-scoped and are loaded by the normal authenticated settings path after the ticker changes.

On actual navigation, the workstation calls `prepareInitialChartHistory()` for the target. The prefetched stable slice is reused, the target current-date tail is fetched fresh, and `currentData` + target chart are committed only when the full prepared dataset is ready. A failed target preparation leaves the old committed ticker/chart visible and reports the transition error rather than showing a blank or mislabeled chart.

Use `requestIdleCallback` when available with a bounded timeout fallback. Abort obsolete prefetch when active ticker/timeframe/watchlist intent changes.

### 6. In-flight reuse

The existing exact request-key promise map remains authoritative for duplicate client requests. Stable prefetch, preparation and normal history loading must all call the same request functions so they coalesce automatically.

Do not add a second prefetch-only data cache.

## Correctness rules

1. Cache admission is fail-closed. PARTIAL, gap, integrity warning/error, storage error or provider error means no closed cache write.
2. A cache hit cannot suppress a current trading-date fresh request.
3. Same-day intraday/hourly data stays outside immutable acceleration caches even after EOD; it becomes stable no earlier than a later non-trading/trading date boundary.
4. Future-ending ranges are never cacheable.
5. QEO-147 derived-hourly readiness remains mandatory before using derived 1h cache as complete old history.
6. COLD/HOT overlap normalization and QEO-149 correction-safe writes remain unchanged.
7. QEO-150 historical recovery/corrections cannot be hidden by a same-day immutable cache under this design.
8. No synthetic OHLCV.
9. Adjacent ticker prefetch never copies chart drawings, absolute price ranges or ticker-scoped objects.
10. A pending ticker/timeframe transition may visually keep the previous chart, but the app must not label previous bars as the target ticker/timeframe. The atomic swap changes label + full prepared data together.

## Performance budgets

The existing QEO-97 budgets remain in force:

- uncached initial usable chart: p95 <= 2.5 s;
- pan-left hydration: p95 <= 2.5 s;
- repeat covered closed range: no duplicate network request from L0, resolution <= 50 ms;
- lower/mid-term browser payload <= 2 MiB;
- client closed cache <= 24 entries and <= 10 minutes.

QEO-172 adds these production targets, measured after one warm-up round:

| Interaction | p50 | p95 |
| --- | ---: | ---: |
| Warm stable-closed timeframe switch on same ticker | <= 150 ms | <= 500 ms |
| Prefetched adjacent ticker switch at same timeframe, including fresh current-date tail | <= 300 ms | <= 800 ms |
| Browser render/hydration after full prepared dataset is available | <= 75 ms | <= 200 ms |
| Current-date tail refresh | <= 750 ms | <= 2.0 s |

If the instrumentation-only baseline proves one target structurally impossible on the current hosting/runtime, the target may be revised only before optimization code begins, with the baseline evidence and reason recorded in QEO-172. Targets must not be loosened after seeing the optimized result.

## Production measurement methodology

Use the existing encrypted QEO-171 QA account in GitHub Actions; do not add plaintext credentials or a new production user.

The QEO-172 production benchmark runs against `https://qeoindex.qeoqeo.com` and records JSON/Markdown artifacts containing:

- deployed SHA and timestamp;
- VIC + VCB;
- 1D, 4h, 1h, 15m;
- at least 10 samples per measured warm interaction after one warm-up;
- p50/p95 for API total and browser interaction-to-render-ready;
- parsed `Server-Timing` stage values for direct API samples;
- resource payload bytes/bar counts;
- L0/browser closed-cache hit/miss/network counts;
- provider-request count observed during repeat stable-closed scenarios.

The same benchmark code is run before and after behavioral optimization. Do not compare different scripts or different ticker/timeframe matrices.

## Rollout sequence

1. **Instrumentation-only PR:** request-scoped server timings, chart render-ready semantic, production benchmark workflow/spec. Deploy and capture baseline. No caching/navigation behavior change.
2. **Closed/current-date split PR:** conservative stable-date planner, private closed-response cache policy, current-date fresh tail, L0 synchronous peek and prepared initial dataset. Re-run correctness and benchmark.
3. **Navigation PR:** atomic timeframe swap, adjacent stock/detail + stable chart prefetch, full target preparation and atomic ticker swap. Re-run benchmark and full QEO-171 chart interaction regression.
4. **Acceptance:** compare before/after p50/p95, inspect production errors/provider activity, update `docs/chart-performance-budget.md`, QEO-172 and QEO-168. QEO-173 remains blocked until QEO-172 acceptance is complete.

## Files expected to change

- `modules/market/chart-data/performance.ts` — request-scoped timing recorder.
- `modules/market/chart-data/service.ts` — stage timing around Daily/HOT/COLD/provider work.
- `modules/market/chart-data/timeframe-service.ts` — stage timing around derived cache and aggregation.
- `modules/market/chart-data/http-cache-policy.ts` — pure stable-range HTTP cache decision.
- `app/api/market/ohlcv/route.ts` — serialization/total timing and safe closed response cache headers.
- `components/stock-detail/chart/chart-history.ts` — stable/current-date slicing, prepared initial data, L0 peek/prefetch and transport.
- `components/stock-detail/chart/use-chart-history.ts` — consume prepared initial handoff and independently refresh current-date tail.
- `components/stock-detail/stock-tradingview-chart.tsx` — deterministic render-ready semantic only.
- `components/stock-detail/stock-tradingview-chart-data.tsx` — staged timeframe preparation/commit.
- `components/stock-detail/stock-detail-workstation.tsx` — bounded adjacent stable prefetch and atomic ticker preparation/commit.
- `tests/qeo172/chart-performance-contract.test.ts` — pure/cache/instrumentation/navigation contracts.
- `tests/browser/qeo172-chart-performance-production.spec.ts` — before/after authenticated production benchmark.
- `.github/workflows/qeo-172.yml` — focused contract + production benchmark workflow.
- `docs/chart-performance-budget.md` — measured before/after results and final accepted budgets.

No database migration is expected.