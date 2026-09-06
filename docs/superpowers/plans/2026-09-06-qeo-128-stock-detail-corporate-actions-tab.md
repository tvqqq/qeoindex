# QEO-128 Stock Detail Corporate-Actions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `Sự kiện doanh nghiệp` tab to Stock Detail showing upcoming/historical corporate actions, verification status and source provenance, with optional navigation back to the canonical chart ex-date.

**Architecture:** Reuse the QEO-123 normalized corporate-action API/read model. Split the current oversized `stock-tabs-panel.tsx` by introducing a focused corporate-actions tab component; keep event formatting/status mapping isolated in a small view-model module. Chart navigation uses event IDs/ex-date and a callback, not provider/source parsing.

**Tech Stack:** React/Next.js, existing Stock Detail tabs/workstation, QEO-123 read API.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- UI never scrapes VSDC/provider pages.
- Upcoming event visibility does not mean adjusted prices are active.
- Missing dates/terms remain visibly pending; never infer in browser.
- Event source/provenance must be accessible without cluttering the chart.
- Desktop/mobile Stock Detail layouts must remain usable.

---

### Task 1: Extract a focused event view model

**Files:**
- Create: `components/stock-detail/corporate-actions/corporate-action-view-model.ts`
- Test: `tests/qeo-128-corporate-actions-tab.test.ts`

**Interfaces:**

```ts
export type CorporateActionCardModel = {
  id: string
  section: "upcoming" | "historical" | "pending"
  statusLabel: string
  typeLabel: string
  primaryValue: string
  exDateLabel: string | null
  recordDateLabel: string | null
  paymentDateLabel: string | null
  sourceLabel: string
  sourceUrl: string | null
  canFocusChart: boolean
}

export function toCorporateActionCardModel(row: CorporateActionView, today: string): CorporateActionCardModel
```

- [ ] **Step 1: RED Vietnamese investor-facing labels for cash/stock/rights/split**
- [ ] **Step 2: RED status partitioning** — `upcoming`, `historical`, `pending` are deterministic from normalized status/date; ambiguous/null ex-date cannot focus chart.
- [ ] **Step 3: Implement formatting without changing source values**
- [ ] **Step 4: GREEN and commit**

### Task 2: Add data hook for full ticker event list

**Files:**
- Create: `components/stock-detail/corporate-actions/use-stock-corporate-actions.ts`
- Modify: `tests/qeo-128-corporate-actions-tab.test.ts`

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

- [ ] **Step 1: RED loading/error/empty-state contracts**
- [ ] **Step 2: Implement one normalized API request per ticker view; share cache key with QEO-127 hook where practical**
- [ ] **Step 3: Sort upcoming nearest-first, historical newest-first, pending by source/update date when available**
- [ ] **Step 4: GREEN and commit**

### Task 3: Build tab component

**Files:**
- Create: `components/stock-detail/corporate-actions/stock-corporate-actions-tab.tsx`
- Create: `components/stock-detail/corporate-actions/stock-corporate-actions-tab.module.css`
- Modify: `tests/qeo-128-corporate-actions-tab.test.ts`

**Interfaces:**

```ts
type Props = {
  ticker: string
  onFocusChartDate?: (exDate: string, eventId: string) => void
}
```

- [ ] **Step 1: RED section/field rendering contract**

Each card/detail must show when known:

```text
action type
status
ex-date
record date
payment/effective date
cash amount per share OR stock/split ratio OR rights ratio + subscription price
source/verification status
```

- [ ] **Step 2: Implement Upcoming / Historical / Pending sections**
- [ ] **Step 3: Add source link with safe external navigation attributes**
- [ ] **Step 4: Add chart-focus action only when canonical ex-date exists**
- [ ] **Step 5: Add responsive styles and commit**

### Task 4: Integrate into existing Stock Detail tab shell

**Files:**
- Modify: `components/stock-detail/stock-tabs-panel.tsx`
- Modify: `components/stock-detail/stock-detail-workstation.tsx` if chart-focus callback ownership lives there
- Test: `tests/qeo-128-corporate-actions-tab.test.ts`

- [ ] **Step 1: RED tab registration contract** — `Sự kiện doanh nghiệp` appears without removing/reordering unrelated tabs unexpectedly.
- [ ] **Step 2: Insert focused component instead of adding more corporate-action logic to the 100kB tabs file**
- [ ] **Step 3: Wire event→chart focus through existing workstation/chart state boundary**
- [ ] **Step 4: Verify ticker navigation resets event data/cache to the new ticker**
- [ ] **Step 5: Commit**

### Task 5: Cross-surface consistency with QEO-127

**Files:**
- Modify: `components/stock-detail/corporate-actions/corporate-action-view-model.ts`
- Modify: QEO-127 marker module only if shared labels/IDs need a common helper

- [ ] **Step 1: Assert same normalized event ID is used by chart marker and tab row**
- [ ] **Step 2: Clicking a marker can open/focus the corresponding tab event detail when the shell supports it**
- [ ] **Step 3: Clicking a tab event with canonical ex-date focuses the chart; ambiguous event stays in tab only**
- [ ] **Step 4: Commit shared-contract cleanup only if required; do not merge UI state domains unnecessarily**

### Task 6: Production/UI acceptance

- [ ] `/insights/vhm` shows VHM historical + future events with exact normalized terms.
- [ ] Verify cash, stock dividend and rights issue labels on real representative tickers.
- [ ] Verify source evidence link and Pending/Ambiguous state.
- [ ] Verify desktop + mobile layout.
- [ ] Verify event→chart navigation lands on canonical ex-date and marker identity matches QEO-127.
- [ ] Verify upcoming event does not visually imply chart price has already been adjusted before ex-date.
- [ ] Add screenshots/UI evidence to QEO-128; only then mark Done.
