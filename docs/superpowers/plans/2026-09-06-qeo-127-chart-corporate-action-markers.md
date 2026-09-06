# QEO-127 Chart Corporate-Action Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canonical corporate actions as stable, timeframe-aware chart markers anchored to canonical `ex_date` on `/insights/[ticker]`.

**Architecture:** Reuse the existing Lightweight Charts v5 `createSeriesMarkers` runtime already wrapped by `modules/shared/charts/lightweight-charts-runtime.ts`. Fetch normalized corporate-action data independently from OHLCV, map canonical ex-dates to the selected timeframe, group same-date actions deterministically, and attach markers to the candlestick series. No provider parsing or adjustment math runs in the browser.

**Tech Stack:** React/Next.js, Lightweight Charts 5.2.1 runtime, existing Stock Detail chart modules, QEO-123 normalized read API.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on stable QEO-123 normalized read model/API.
- Marker anchor is canonical `ex_date`, never record/payment date.
- Ambiguous/null ex-date must not create a fake marker.
- Future event visibility does not imply price adjustment before ex-date.
- Markers are time-based and must remain anchored through pan/zoom/timeframe/fullscreen; they never write drawing persistence.
- Reuse the shared chart runtime/series-marker pattern; do not create a second canvas overlay for corporate actions.

---

### Task 1: Add chart-event normalization + range fetch

**Files:**
- Modify: `components/stock-detail/chart/stock-chart-types.ts`
- Create: `components/stock-detail/chart/use-corporate-action-events.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
export type ChartCorporateActionEvent = {
  id: string
  exDate: string
  actionType: "cash_dividend" | "stock_dividend" | "split" | "rights_issue" | "other"
  label: string
  summary: string
  status: "upcoming" | "effective" | "completed"
  groupedIds: string[]
}
```

- [ ] **Step 1: RED normalization cases in existing canonical chart test** — `exDate=null`/ambiguous rows are excluded from marker data; canonical rows retain exact normalized event IDs.
- [ ] **Step 2: Implement one ticker/range-bounded request to `/api/market/corporate-actions`**

The hook requests the loaded chart date range plus the currently projected future timeline horizon in one request; it does not request per candle/event.

- [ ] **Step 3: Group same-date events deterministically by ex-date, then stable event ID**
- [ ] **Step 4: GREEN `tests/stock-tradingview-chart-v2.test.ts` and commit**

### Task 2: Map canonical ex-date to chart timeframe + existing future timeline

**Files:**
- Create: `components/stock-detail/chart/corporate-action-marker-time.ts`
- Modify: `components/stock-detail/chart/future-timeline.ts` only if an exported helper is needed to query an already-supported projected slot
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/stock-chart-interaction.test.ts`

**Interfaces:**

```ts
export function markerTimeForTimeframe(input: {
  exDate: string
  timeframe: ChartTimeframe
  visibleBars: StockChartBar[]
  futureTimes: number[]
}): number | null
```

- [ ] **Step 1: RED 1D case** — maps to canonical ex-date Daily bar time.
- [ ] **Step 2: RED 1W/1M/1Q/1Y cases** — maps to the exact QEO-93 period candle that contains ex-date; no second aggregation/calendar algorithm.
- [ ] **Step 3: RED intraday case** — maps to the canonical ex-date session boundary only when that session is in loaded bars.
- [ ] **Step 4: RED future case** — map only to timestamps already produced by `projectFutureTimes`; if ex-date is beyond projected whitespace, return null and leave the event available in QEO-128 tab.
- [ ] **Step 5: Implement and GREEN both existing chart tests**
- [ ] **Step 6: Commit**

### Task 3: Attach series markers using the existing Lightweight Charts runtime

**Files:**
- Modify: `modules/shared/charts/lightweight-charts-runtime.ts`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Create: `components/stock-detail/chart/stock-chart-corporate-action-markers.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
export function buildCorporateActionSeriesMarkers(
  events: ChartCorporateActionEvent[],
  context: MarkerTimeContext,
): ReadonlyArray<Record<string, unknown>>
```

Use `runtime.createSeriesMarkers(candlestickSeries, markers)` and retain the returned `LightweightSeriesMarkersApi` so updates use `setMarkers()` rather than creating duplicate marker primitives.

Minimum compact labels:

```text
D  cash dividend
S  stock dividend / bonus / split
R  rights issue
+N grouped same-date events
```

- [ ] **Step 1: RED runtime/source contract** — Stock Detail uses shared `createSeriesMarkers`; no custom marker canvas and no drawing-store mutation.
- [ ] **Step 2: Build deterministic marker records with stable IDs, time, label/text and marker position**
- [ ] **Step 3: Extend shared runtime click typing only as required by the real Lightweight Charts v5 API; keep the wrapper minimal**
- [ ] **Step 4: Wire marker instance lifecycle to candlestick-series lifecycle and call `setMarkers()` on data/timeframe/event changes**
- [ ] **Step 5: GREEN test and commit**

### Task 4: Add marker detail interaction without duplicating the Stock Detail event model

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Create: `components/stock-detail/chart/stock-chart-corporate-action-tooltip.tsx`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
type CorporateActionMarkerSelection = {
  eventIds: string[]
  exDate: string
}
```

- [ ] **Step 1: RED selection contract** — selection returns normalized event IDs/ex-date, never source HTML/provider payload.
- [ ] **Step 2: Use chart click/hover event from the shared runtime to select the marker/group**
- [ ] **Step 3: Render compact tooltip/popover with normalized amount/ratio and ex/record/payment dates already returned by the API**
- [ ] **Step 4: Expose `onCorporateActionSelect(selection)` callback from chart for QEO-128 cross-surface navigation**
- [ ] **Step 5: Commit**

### Task 5: Preserve chart lifecycle stability

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/stock-chart-interaction.test.ts`

- [ ] **Step 1: RED timeframe-change case** — marker instance is updated, not duplicated.
- [ ] **Step 2: RED pan-left hydration case** — older loaded range expands event fetch range; existing marker IDs remain stable.
- [ ] **Step 3: RED fullscreen/resize case** — marker identity remains time-based, never persisted x/y.
- [ ] **Step 4: RED ticker-switch case** — old ticker event request/markers are discarded.
- [ ] **Step 5: Implement lifecycle cleanup and GREEN tests**
- [ ] **Step 6: Commit**

### Task 6: Production acceptance

- [ ] Verify VHM historical event markers at canonical ex-dates.
- [ ] Verify a future announced event appears after QEO-126 EOD sync while historical candles remain pre-activation basis until ex-date.
- [ ] Test 1D, 1W, 1M and one intraday timeframe.
- [ ] Test zoom/pan/fullscreen, ticker switching and same-date grouping.
- [ ] Verify event beyond available future whitespace is not fabricated on chart but remains visible in QEO-128 tab.
- [ ] Verify ambiguous event is absent from chart and visible in QEO-128 as pending.
- [ ] Capture `/insights/vhm` UI evidence and update QEO-127 before Done.
