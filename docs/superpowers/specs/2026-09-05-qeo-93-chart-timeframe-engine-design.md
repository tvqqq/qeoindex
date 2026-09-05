# QEO-93 Chart Timeframe Engine Design

## Status

Approved implementation baseline for Linear QEO-93, derived from the QEO-90 delivery order and QEO-93 acceptance criteria.

## Goal

Provide deterministic, Vietnam-session-aware chart candles for `1m, 15m, 30m, 1h, 2h, 4h, 1D, 3D, 1W, 1M, 1Q, 1Y`, backed only by canonical real `1m` and canonical real `1D`, while supporting progressive pan-left history loading without resetting chart coordinates.

## Scope boundary

QEO-93 owns:

- public chart resolution contract;
- deterministic timeframe aggregation;
- VN intraday session bucket boundaries;
- calendar-aware Daily-derived candles;
- server-side source-range expansion/chunking;
- client history range loading and in-flight request dedupe;
- preserving the current viewport when older bars are prepended.

QEO-93 does not own:

- realtime in-progress candle streaming/provider failover beyond existing canonical reads; QEO-96 owns that;
- indicator formulas; QEO-94 owns them;
- drawing persistence schema; QEO-95 owns it;
- cache/performance budgets beyond request dedupe and incremental history loading; QEO-97 owns broader optimization.

## Architecture

```text
StockTradingViewChart
        |
        v
useChartHistory(ticker, timeframe)
        |
        v
GET /api/market/ohlcv?resolution=<12 supported resolutions>&from=&to=
        |
        v
getChartOhlcv()
        |
        +--> canonical 1m service --> hot/cold/provider
        |          |
        |          +--> intraday timeframe engine
        |
        +--> canonical 1D service --> Daily store
                   |
                   +--> 3D/calendar timeframe engine
```

The browser never branches on provider, hot storage, cold storage, or source resolution.

## Resolution contracts

Add a public `ChartResolution` type containing all 12 selectable resolutions.

Keep `CanonicalChartResolution = "1m" | "1D"` for QEO-92 storage/provider internals.

The public API accepts `ChartResolution`; canonical provider/hot/cold functions continue accepting only `CanonicalChartResolution`.

## Intraday aggregation

Derived intraday resolutions `15m, 30m, 1h, 2h, 4h` aggregate only from canonical `1m` bars.

Use timezone `Asia/Ho_Chi_Minh`.

Recognized trading segments:

- morning: `09:00 <= local time <= 11:30`;
- afternoon: `13:00 <= local time <= 15:00`.

Each bar is assigned to one segment and one bucket anchored to that segment start. Bucket size is the requested resolution in minutes.

A bucket never contains bars from:

- two local trading dates;
- morning and afternoon segments;
- an invalid/out-of-session timestamp.

Partial buckets at the end of a valid segment are retained if they contain real source bars. This is deterministic and avoids fabricating minutes to complete a nominal 2h/4h duration.

For each bucket:

- `open` = first source open;
- `high` = max source high;
- `low` = min source low;
- `close` = last source close;
- `volume` = sum source volume.

The derived timestamp is the deterministic nominal bucket start in epoch seconds, not the request boundary.

## Daily-derived aggregation

`1D` remains canonical and is never rebuilt from `1m`.

### 3D

`3D` groups every three actual canonical Daily sessions in chronological order. It does not assume three calendar days.

To keep grouping stable across lazy range requests, the server establishes sequence alignment from a fixed historical anchor and then filters the aggregated result to the requested range. The first available Daily session at/after the anchor becomes sequence index zero for that ticker. Missing holidays do not create fake sessions.

### 1W / 1M / 1Q / 1Y

Calendar keys use `Asia/Ho_Chi_Minh`:

- `1W`: ISO-style Monday-start local week;
- `1M`: local calendar year + month;
- `1Q`: local calendar year + quarter;
- `1Y`: local calendar year.

The service expands the raw Daily source range to the beginning of the containing calendar period before aggregation, then filters output. This prevents a candle from changing merely because a later request began in the middle of the same week/month/quarter/year.

The candle timestamp is the first actual source Daily bar in that period.

## Range loading and canonical chunking

QEO-92 canonical `1m` requests are capped at 31 calendar days and canonical `1D` requests at ten years. QEO-93 may serve a larger derived request by splitting source reads into legal canonical chunks, merging them, sorting and deduping before aggregation.

Derived intraday requests remain bounded to a practical maximum so a single browser request cannot trigger an unbounded provider workload.

Daily-derived requests may span the retained Daily history.

For a request whose `from` falls inside an aggregation bucket, source range expansion includes enough earlier source data to rebuild that whole bucket deterministically.

## Client history hydration

Create `useChartHistory` as the sole owner of chart OHLCV browser fetches.

Responsibilities:

- load the selected ticker/timeframe on initial render;
- request a range sized for visible bars plus warm-up headroom;
- progressively load an older adjacent range when the viewport approaches the oldest loaded bars;
- dedupe bars by timestamp and preserve ascending order;
- maintain `hasMore`, `loading`, `loadingOlder`, `error`, and coverage metadata;
- cancel/ignore obsolete responses after ticker or timeframe changes;
- dedupe identical in-flight URLs through one module-level promise map.

Multiple visual panes must consume the same returned bar array; indicator panes must not initiate their own OHLCV requests.

## Viewport preservation

The chart uses `scrollOffset` measured from the right edge. When older bars are prepended, keeping the same `scrollOffset` naturally keeps the existing visible market-time window stable because all existing bars shift by the same array prefix length.

Do not reset:

- `scrollOffset` during older-history hydration;
- `visibleBarsCount` during older-history hydration;
- drawing `time + price` anchors;
- hover/crosshair coordinates except when the pointed bar is no longer in the selected timeframe.

Ticker or timeframe changes may reset the viewport to the recent right edge.

## UI states

Replace the QEO-92 “QEO-93 will aggregate” unavailable state with explicit runtime states:

- initial loading;
- partial-data warning when canonical coverage reports gaps/errors;
- retryable load error;
- loading-older indicator that does not cover or reset the chart.

Never fall back to synthetic bars.

## Data integrity

- Derived candles consume only valid canonical bars.
- Aggregation never interpolates missing bars.
- Duplicate source timestamps are deduped before grouping.
- Completed historical derived candles must be deterministic for the same canonical source set.
- QEO-96 may later update the current in-progress candle without rewriting completed historical buckets.

## Tests

Add pure tests covering:

1. 15m/30m/1h OHLCV aggregation rules.
2. No bucket crosses the VN lunch break or local trading date.
3. Partial session-end buckets use only real bars.
4. 3D uses three actual Daily sessions around weekends/holidays.
5. 1W groups shortened holiday weeks by calendar week, not fixed count.
6. 1M/1Q/1Y switch exactly at local calendar boundaries.
7. Source-order independence and stable derived timestamps.
8. Public API accepts all 12 resolutions while canonical provider internals remain `1m | 1D`.
9. Client history merge prepends older bars without duplication.
10. In-flight identical history requests are deduped.
11. Stock chart no longer calls the legacy fixed-count `aggregateBarsByTimeframe` path.

## Acceptance mapping

| Linear QEO-93 criterion | Design mechanism |
| --- | --- |
| Standard OHLC aggregation | Pure bucket reducer |
| Calendar-aligned W/M/Q/Y | Vietnam calendar keys + source-range expansion |
| Stable historical timestamps/values | Deterministic bucket keys + complete source buckets |
| Pan-left loads older history | `useChartHistory.loadOlder()` |
| No zoom/crosshair/drawing reset | prepend-only merge with right-edge `scrollOffset` preserved |
| No coarser source for finer timeframe | resolution-to-canonical-source mapping enforced server-side |
| Holidays/short weeks respected | group actual Daily bars by calendar key, never fixed count |
