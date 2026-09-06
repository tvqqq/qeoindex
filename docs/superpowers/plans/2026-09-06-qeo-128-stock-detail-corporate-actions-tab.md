# QEO-128 Stock Detail Corporate-Actions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `Sự kiện doanh nghiệp` tab to Stock Detail showing upcoming/historical corporate actions, verification status and source provenance, with navigation from a canonical event to its chart ex-date.

**Architecture:** Reuse the QEO-123 normalized read API. Keep event formatting/status mapping in a focused `components/stock-detail/corporate-actions/` module instead of expanding the already-large `stock-tabs-panel.tsx`. Because the chart and tabs are siblings, `StockDetailWorkstation` owns a small chart-focus request and passes it downward to `StockTradingViewChartData`; the tab only emits `(eventId, exDate)`.

**Tech Stack:** React/Next.js, existing Stock Detail workstation/tabs/chart, QEO-123 read API.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- UI never scrapes VSDC/provider pages.
- Upcoming event visibility does not mean adjusted prices are active.
- Missing dates/terms remain visibly pending; never infer in browser.
- Event source/provenance is accessible from the tab/detail surface.
- Desktop/mobile Stock Detail layouts must remain usable.
- Reuse normalized event IDs from QEO-123/QEO-127; do not create a second frontend event identity.

---

### Task 1: Add focused investor-facing event view model

**Files:**
- Create: `components/stock-detail/corporate-actions/corporate-action-view-model.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
export type CorporateActionCardModel = {
  id: string
  section: "upcoming" | "historical" | "pending"
  statusLabel: string
  typeLabel: string
  primaryValue: string
  exDate: string | null
  exDateLabel: string | null
  recordDateLabel: string | null
  paymentDateLabel: string | null
  sourceLabel: string
  sourceUrl: string | null
  canFocusChart: boolean
}

export function toCorporateActionCardModel(
  row: CorporateActionView,
  today: string,
): CorporateActionCardModel
```

- [ ] **Step 1: RED Vietnamese labels** — cash dividend, stock dividend/bonus, split and rights issue preserve exact normalized amounts/ratios.
- [ ] **Step 2: RED section/status partitioning**

Rules are explicit:
- normalized `ambiguous` or null canonical ex-date -> `pending`, `canFocusChart=false`;
- canonical event with `exDate > today` -> `upcoming`;
- effective/completed event with `exDate <= today` -> `historical`;
- canceled event is displayed with canceled status in the historical/pending context defined by source status, never treated as active right.

- [ ] **Step 3: Implement pure formatting without altering source values**
- [ ] **Step 4: GREEN existing Stock Detail/chart test and commit**

### Task 2: Add ticker-level corporate-action client hook

**Files:**
- Create: `components/stock-detail/corporate-actions/use-stock-corporate-actions.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
export function useStockCorporateActions(ticker: string): {
  loading: boolean
  error: string | null
  upcoming: CorporateActionCardModel[]
  historical: CorporateActionCardModel[]
  pending: CorporateActionCardModel[]
  refresh(): void
}
```

- [ ] **Step 1: RED loading/error/empty-state cases**
- [ ] **Step 2: Implement one `/api/market/corporate-actions?ticker=...` request per ticker lifecycle with AbortController cleanup on ticker change**
- [ ] **Step 3: Sort upcoming nearest ex-date first; historical newest ex-date first; pending deterministically by record date then stable event ID**
- [ ] **Step 4: If QEO-127 already has a client event fetcher, extract the shared network/cache primitive into `components/stock-detail/corporate-actions/corporate-action-client.ts` and make both surfaces use it; do not retain two independent requests for the same ticker**
- [ ] **Step 5: GREEN and commit**

### Task 3: Build the Corporate Actions tab component

**Files:**
- Create: `components/stock-detail/corporate-actions/stock-corporate-actions-tab.tsx`
- Create: `components/stock-detail/corporate-actions/stock-corporate-actions-tab.module.css`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

**Interfaces:**

```ts
type Props = {
  ticker: string
  onFocusChartDate: (exDate: string, eventId: string) => void
}
```

- [ ] **Step 1: RED section/field rendering contract**

Each event displays, when present:

```text
action type
status
ex-date
record date
payment/effective date
cash amount/share OR stock/split ratio OR rights ratio + subscription price
source + verification status
```

- [ ] **Step 2: Implement `Sắp tới`, `Lịch sử`, `Chờ xác minh` sections with explicit empty states**
- [ ] **Step 3: Add safe external source link (`target=_blank`, `rel=noopener noreferrer`)**
- [ ] **Step 4: Render chart-focus action only when `canFocusChart` and canonical `exDate` are true**
- [ ] **Step 5: Add responsive layout and commit**

### Task 4: Register the new tab without embedding feature logic in `stock-tabs-panel.tsx`

**Files:**
- Modify: `components/stock-detail/stock-tabs-panel.tsx`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

- [ ] **Step 1: RED tab registration** — `Sự kiện doanh nghiệp` appears as a distinct tab while existing tab keys/order remain unchanged except for the intentional insertion point.
- [ ] **Step 2: Extend `StockTabsPanel` props with `onFocusCorporateAction(exDate, eventId)`**
- [ ] **Step 3: Mount `StockCorporateActionsTab` only for the corporate-actions tab; keep parsing/fetch/formatting out of the 100kB parent file**
- [ ] **Step 4: GREEN and commit**

### Task 5: Lift event→chart focus state to `StockDetailWorkstation`

**Files:**
- Modify: `components/stock-detail/stock-detail-workstation.tsx`
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `modules/shared/charts/lightweight-charts-runtime.ts` only if the existing time-scale wrapper needs one additional supported method
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/stock-chart-interaction.test.ts`

**Interfaces:**

```ts
export type ChartFocusRequest = {
  ticker: string
  eventId: string
  exDate: string
  nonce: number
}
```

- [ ] **Step 1: RED sibling-state contract** — Workstation owns `ChartFocusRequest`; tabs emit it and chart receives it as a prop.
- [ ] **Step 2: Reset/ignore focus request when active ticker changes**
- [ ] **Step 3: `StockTradingViewChartData` converts canonical ex-date into the current timeframe target using the same marker-time helper from QEO-127**
- [ ] **Step 4: Chart focuses a bounded visible logical range centered near the resolved target using the existing `LightweightTimeScaleApi.setVisibleLogicalRange`; if the event is outside currently loaded historical data, trigger existing `useChartHistory` pan-left loading until the canonical target is available or history reports no more data**
- [ ] **Step 5: Future event navigation uses only an already-projected `futureTimes` slot; it never fabricates a candle/time**
- [ ] **Step 6: GREEN interaction tests and commit**

### Task 6: Cross-surface identity consistency with QEO-127

**Files:**
- Modify: `components/stock-detail/corporate-actions/corporate-action-view-model.ts`
- Modify: QEO-127 marker adapter only if a shared normalized label helper is genuinely duplicated
- Modify: `tests/stock-tradingview-chart-v2.test.ts`

- [ ] **Step 1: Assert chart marker and tab row preserve the exact same normalized event ID(s)**
- [ ] **Step 2: Tab event with canonical ex-date focuses the chart target; pending/ambiguous event has no focus action**
- [ ] **Step 3: Do not couple tab selection state to chart marker rendering; shared identity/data is sufficient**
- [ ] **Step 4: Commit**

### Task 7: Production/UI acceptance

- [ ] `/insights/vhm` shows VHM historical + future corporate actions with exact normalized terms.
- [ ] Verify cash, stock dividend and rights issue labels on representative real tickers.
- [ ] Verify source evidence link and Pending/Ambiguous state.
- [ ] Verify desktop + mobile layout.
- [ ] Verify event→chart navigation lands on the canonical ex-date/timeframe bucket and remains stable after timeframe change.
- [ ] Verify ticker switching discards old event/focus state.
- [ ] Verify upcoming event copy does not imply the historical chart has already been adjusted before ex-date.
- [ ] Add screenshots/UI evidence to QEO-128; only then mark Done.
