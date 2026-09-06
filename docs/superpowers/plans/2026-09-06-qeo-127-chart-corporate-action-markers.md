# QEO-127 Chart Corporate-Action Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canonical corporate actions as stable, timeframe-aware chart markers anchored to canonical `ex_date` on `/insights/[ticker]`.

**Architecture:** Fetch normalized event read-model data independently from OHLCV, map events to chart-visible times using existing chart time/session helpers, render markers as a dedicated overlay/series-marker layer, and keep source/provider parsing entirely server-side. Multiple same-date events group into one marker.

**Tech Stack:** React/Next.js, Lightweight Charts, existing `components/stock-detail/chart/*`, corporate-action API from QEO-123.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on stable QEO-123 normalized read model/API.
- Marker anchor is canonical `ex_date`, never record/payment date.
- Ambiguous/null ex-date must not create a fake marker.
- Future event visibility does not imply price adjustment before ex-date.
- Markers must stay anchored through pan/zoom/timeframe/fullscreen and must not mutate drawing state.

---

### Task 1: Add chart event types + fetch hook

**Files:**
- Modify: `components/stock-detail/chart/stock-chart-types.ts`
- Create: `components/stock-detail/chart/use-corporate-action-events.ts`
- Test: `tests/qeo-127-chart-events.test.ts`

**Interfaces:**

```ts
export type ChartCorporateActionEvent = {
  id: string
  exDate: string
  actionType: "cash_dividend" | "stock_dividend" | "split" | "rights_issue" | "other"
  label: string
  summary: string
  status: "upcoming" | "effective" | "completed"
  groupedCount: number
}
```

- [ ] **Step 1: RED fetch normalization test** — API rows with `exDate=null` are excluded from marker set but remain available to tab UI elsewhere.
- [ ] **Step 2: Implement one ticker/range-bounded request; no request per candle/event**
- [ ] **Step 3: Group same-date events deterministically by ex-date + stable ID**
- [ ] **Step 4: Run targeted test GREEN and commit**

### Task 2: Map canonical ex-date to chart timeframe

**Files:**
- Create: `components/stock-detail/chart/corporate-action-marker-time.ts`
- Modify: `tests/qeo-127-chart-events.test.ts`

**Interfaces:**

```ts
export function markerTimeForTimeframe(
  exDate: string,
  timeframe: ChartTimeframe,
  visibleBars: StockChartBar[],
): Time | null
```

- [ ] **Step 1: RED 1D case** — maps to canonical ex-date Daily bar.
- [ ] **Step 2: RED 1W/1M case** — maps to period candle containing ex-date using existing QEO-93 bucket timestamps.
- [ ] **Step 3: RED intraday case** — maps to session boundary only when ex-date is inside loaded range.
- [ ] **Step 4: RED future-space case** — use existing `future-timeline.ts` behavior where supported; otherwise return null rather than fabricating a candle.
- [ ] **Step 5: Implement and GREEN**
- [ ] **Step 6: Commit**

### Task 3: Render marker layer in TradingView-style chart

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Create: `components/stock-detail/chart/stock-chart-corporate-action-markers.tsx`
- Modify: `components/stock-detail/chart/stock-chart-terminal-shell.module.css`
- Test: `tests/qeo-127-chart-events.test.ts`

**Interfaces:**
- Component receives `events`, current timeframe and chart/series handles; it owns only marker rendering and click callbacks.

- [ ] **Step 1: RED contract that marker layer does not write drawing persistence or OHLCV**
- [ ] **Step 2: Implement marker visual categories**

Minimum compact labels:

```text
D  cash dividend
S  stock dividend/bonus/split
R  rights issue
+N grouped same-date events
```

- [ ] **Step 3: Add hover/click summary with amount/ratio + ex/record/payment dates when known**
- [ ] **Step 4: Keep detailed provenance out of plot; expose event ID callback for Stock Detail tab/detail surface**
- [ ] **Step 5: Commit**

### Task 4: Preserve interaction/timeframe stability

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Test: `tests/qeo-127-chart-events.test.ts`

- [ ] **Step 1: RED rerender test** — timeframe change must remap markers without duplicating them.
- [ ] **Step 2: RED pan-left hydration test** — older events appear when range expands; existing markers retain IDs.
- [ ] **Step 3: RED fullscreen/resize test contract** — marker source data remains time-based, never x/y persisted.
- [ ] **Step 4: Implement minimal lifecycle wiring and GREEN**
- [ ] **Step 5: Commit**

### Task 5: Production acceptance

- [ ] Verify VHM historical event markers at canonical ex-dates.
- [ ] Verify a future announced event appears after QEO-126 EOD sync while historical candles remain pre-activation basis until ex-date.
- [ ] Test 1D, 1W, 1M and one intraday timeframe.
- [ ] Test zoom/pan/fullscreen and same-date grouping.
- [ ] Verify ambiguous event is absent from chart but visible in QEO-128 tab as pending.
- [ ] Capture `/insights/vhm` UI evidence and update QEO-127 before Done.
