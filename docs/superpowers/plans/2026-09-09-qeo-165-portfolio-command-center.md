# QEO-165 Portfolio Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp `/portfolio` into a card-first Portfolio Command Center with larger typography, tactical position cards, progressive disclosure and restrained strategy-game framing while preserving every existing Portfolio/Risk calculation, API and persistence boundary.

**Architecture:** Keep `PortfolioPage` as the existing portfolio/transaction/market-price orchestrator. Add focused presentation components under `components/portfolio/revamp/`, feed them only existing props/read models, and progressively disclose the existing dense tables/forms instead of deleting them. QEO-165 never creates a new accounting/risk source of truth, never adds a per-card request, and never changes DB/API/domain behavior.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Tailwind CSS 4, existing `motion` 13.x dependency, Lucide React, Node `node:test` source-contract tests, existing GitHub Actions verification pipeline.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-165-portfolio-command-center-design.md`

## Global Constraints

- Presentation-layer revamp only; no DB migration and no new/modified Portfolio/Risk API behavior.
- Preserve AVCO/accounting, QEO-139 sizing, QEO-141 Active Risk, QEO-142 scorecard, QEO-158 external-flow normalization and QEO-159 concentration/diversification semantics.
- Preserve all five existing tabs: `Tài sản`, `Nhật ký`, `Phân bổ vốn`, `Hiệu suất`, `Theo dõi`.
- Preserve the current dark purple/indigo identity and market up/down colors.
- Tactical/game language is secondary framing only. Do not invent strength, weakness, attack/defense roles, rarity, conviction or probability.
- No network request from `components/portfolio/revamp/**`; those files consume typed props/read models only.
- No per-position/per-card fetch or server action.
- Use the existing `motion` dependency only; add no animation package.
- Respect `prefers-reduced-motion`; non-essential animation must degrade to static presentation.
- Important body/help text should normally be 14–16 px; do not introduce new critical 9–11 px copy.
- Keep dense tables/forms available as secondary drill-down when they still provide useful detail.
- Full Playwright/browser acceptance remains QEO-144 work and is intentionally postponed until after QEO-165 lands.

---

## File Structure Locked by This Plan

### New shared presentation files

- `components/portfolio/revamp/portfolio-section-shell.tsx` — consistent card-first section framing.
- `components/portfolio/revamp/portfolio-command-header.tsx` — compact page command header; accepts selector/actions as children.
- `components/portfolio/revamp/portfolio-command-actions.tsx` — Guidance / refresh / add-transaction controls; callbacks remain owned by `PortfolioPage`.
- `components/portfolio/revamp/portfolio-battle-hud.tsx` — four canonical portfolio summary metrics from existing positions/current prices.
- `components/portfolio/revamp/portfolio-risk-state-strip.tsx` — compact canonical risk/concentration summary rendered from the existing `PortfolioRiskReadModel`.
- `components/portfolio/revamp/tactical-status.ts` — factual display-state resolver only.
- `components/portfolio/revamp/position-battle-rail.tsx` — stop/current/target numeric visualization with no probability semantics.
- `components/portfolio/revamp/tactical-position-card.tsx` — one open-position card.
- `components/portfolio/revamp/portfolio-position-grid.tsx` — derives card display rows from existing `PortfolioPosition[]` + `currentPrices`.
- `components/portfolio/revamp/war-room-stage-nav.tsx` — presentation-only stage selector for capital allocation.
- `components/portfolio/revamp/battle-log-card.tsx` — raw-transaction timeline/card presentation; does not invent Trade lifecycle state.
- `components/portfolio/revamp/scouting-card.tsx` — presentational watchlist item card from already-loaded item/quote data.

### Existing files intentionally modified

- `components/portfolio/portfolio-page.tsx` — compose the new command header/HUD/grid/disclosures while keeping data ownership.
- `components/portfolio/portfolio-summary-bar.tsx` — compatibility wrapper around the new HUD so old imports/tests do not create a second summary implementation.
- `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx` — render compact risk strip first; move dense detail into explicit disclosure without changing the hook/read model.
- `components/portfolio/portfolio-guidance-dialog.tsx` — Field Manual redesign only.
- `components/portfolio/portfolio-capital-allocation.tsx` — progressive War Room stage presentation; formulas/state stay in the same component.
- `components/portfolio/portfolio-transaction-history.tsx` — card/timeline first, existing detailed table secondary.
- `components/portfolio/performance/performance-dashboard.tsx` — Campaign Results hierarchy/typography only.
- `components/portfolio/watchlist-panel.tsx` — Scouting Board card-first item presentation using its existing single quote batch fetch.
- `components/portfolio/portfolio-theme.module.css` — non-essential command-card motion and reduced-motion-safe visual utilities only.
- `tests/test-contracts.json` — classify QEO-165 deterministic tests.
- `.github/workflows/qeo165-preprod.yml` — focused QEO-165 + Portfolio/Risk regression gate.

### New deterministic tests

- `tests/portfolio/qeo165-command-center-ui.test.ts`
- `tests/portfolio/qeo165-tactical-position-ui.test.ts`
- `tests/portfolio/qeo165-guidance-ui.test.ts`
- `tests/portfolio/qeo165-war-room-ui.test.ts`
- `tests/portfolio/qeo165-battle-log-ui.test.ts`
- `tests/portfolio/qeo165-secondary-tabs-ui.test.ts`
- `tests/portfolio/qeo165-boundaries.test.ts`

---

### Task 1: Lock QEO-165 Presentation Boundaries and Shared Shell

**Files:**
- Create: `tests/portfolio/qeo165-command-center-ui.test.ts`
- Create: `tests/portfolio/qeo165-boundaries.test.ts`
- Create: `components/portfolio/revamp/portfolio-section-shell.tsx`
- Create: `components/portfolio/revamp/tactical-status.ts`
- Modify: `tests/test-contracts.json`
- Create: `.github/workflows/qeo165-preprod.yml`

**Interfaces:**
- Produces:
  ```ts
  export type TacticalPositionState =
    | "BREACH"
    | "WARNING"
    | "UNKNOWN"
    | "MISSING_STOP"
    | "PROFIT"
    | "LOSS"
    | "FLAT"

  export function resolveTacticalPositionState(input: {
    unrealizedPnl: number
    stopLoss: number | null
    authoritativeRiskState?: "BREACH" | "WARNING" | "UNKNOWN" | null
  }): TacticalPositionState
  ```
- Produces:
  ```ts
  export interface PortfolioSectionShellProps {
    eyebrow?: string
    title: string
    description?: string
    action?: React.ReactNode
    children: React.ReactNode
    tone?: "default" | "purple" | "amber" | "emerald"
    className?: string
  }
  ```
- Later tasks consume these interfaces; no data fetch is permitted in either file.

- [ ] **Step 1: Write the RED boundary/UI tests**

Create `tests/portfolio/qeo165-boundaries.test.ts` with source checks that fail before revamp files exist:

```ts
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")

test("QEO-165 revamp remains presentation-only with no network fan-out", () => {
  const files = readdirSync("components/portfolio/revamp", { recursive: true })
    .filter((name) => String(name).endsWith(".ts") || String(name).endsWith(".tsx"))
    .map((name) => `components/portfolio/revamp/${String(name)}`)

  assert.ok(files.length >= 2)
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /\bfetch\s*\(/)
    assert.doesNotMatch(source, /createClient\s*\(/)
    assert.doesNotMatch(source, /supabase/i)
  }
})

test("QEO-165 does not introduce portfolio schema or API changes", () => {
  const workflow = read(".github/workflows/qeo165-preprod.yml")
  assert.match(workflow, /components\/portfolio\/\*\*/)
  assert.doesNotMatch(workflow, /supabase\/migrations\/\*\*/)
})
```

Create `tests/portfolio/qeo165-command-center-ui.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")

test("QEO-165 shared shell and factual tactical status exist", () => {
  const shell = read("components/portfolio/revamp/portfolio-section-shell.tsx")
  const status = read("components/portfolio/revamp/tactical-status.ts")

  assert.match(shell, /PortfolioSectionShell/)
  assert.match(status, /resolveTacticalPositionState/)
  assert.match(status, /MISSING_STOP/)
  assert.doesNotMatch(status, /rarity|conviction|attack|defense|mạnh|yếu/i)
})
```

- [ ] **Step 2: Add both tests to `tests/test-contracts.json`, create the minimal QEO-165 workflow, and run RED**

Workflow first version:

```yaml
name: QEO-165 Portfolio Command Center
on:
  pull_request:
    paths:
      - 'components/portfolio/**'
      - 'tests/portfolio/qeo165-*.test.ts'
      - 'tests/test-contracts.json'
      - '.github/workflows/qeo165-preprod.yml'
permissions:
  contents: read
jobs:
  qeo165:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.28.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node --test tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts
```

Expected RED: missing `components/portfolio/revamp/portfolio-section-shell.tsx` / `tactical-status.ts`.

- [ ] **Step 3: Implement `resolveTacticalPositionState` with factual precedence**

```ts
export function resolveTacticalPositionState(input: {
  unrealizedPnl: number
  stopLoss: number | null
  authoritativeRiskState?: "BREACH" | "WARNING" | "UNKNOWN" | null
}): TacticalPositionState {
  if (input.authoritativeRiskState) return input.authoritativeRiskState
  if (input.stopLoss == null) return "MISSING_STOP"
  if (input.unrealizedPnl > 0) return "PROFIT"
  if (input.unrealizedPnl < 0) return "LOSS"
  return "FLAT"
}
```

The helper must never infer risk state from P/L.

- [ ] **Step 4: Implement `PortfolioSectionShell`**

Use one focused component with semantic `<section>`, 14–16 px body copy, optional action slot and tone-only border/background differences. No fetch/context/hook.

- [ ] **Step 5: Run GREEN**

Run:

```bash
node --test tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/revamp tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts tests/test-contracts.json .github/workflows/qeo165-preprod.yml
git commit -m "feat(QEO-165): establish portfolio command UI boundaries"
```

---

### Task 2: Command Header, Battle HUD and Canonical Risk Strip

**Files:**
- Create: `components/portfolio/revamp/portfolio-command-header.tsx`
- Create: `components/portfolio/revamp/portfolio-command-actions.tsx`
- Create: `components/portfolio/revamp/portfolio-battle-hud.tsx`
- Create: `components/portfolio/revamp/portfolio-risk-state-strip.tsx`
- Modify: `components/portfolio/portfolio-summary-bar.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx`
- Modify: `tests/portfolio/qeo165-command-center-ui.test.ts`

**Interfaces:**
- `PortfolioBattleHud` consumes existing:
  ```ts
  { positions: PortfolioPosition[]; currentPrices: Record<string, number>; loading?: boolean }
  ```
- `PortfolioCommandActions` consumes callbacks only:
  ```ts
  {
    onGuidance: () => void
    onRefresh: () => void
    onAddTransaction: () => void
    refreshing?: boolean
  }
  ```
- `PortfolioCommandHeader` consumes `selector: React.ReactNode` and `actions: React.ReactNode`; it does not own portfolio CRUD.
- `PortfolioRiskStateStrip` consumes exactly `PortfolioRiskReadModel`; it reads `riskState`, `activeRisk`, and `concentration.summary.overallStatus` without recalculating them.

- [ ] **Step 1: Extend the QEO-165 command-center test to RED**

Add assertions:

```ts
test("Portfolio page composes command header, HUD, and canonical risk strip", () => {
  const page = read("components/portfolio/portfolio-page.tsx")
  const hud = read("components/portfolio/revamp/portfolio-battle-hud.tsx")
  const riskCore = read("components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx")
  const strip = read("components/portfolio/revamp/portfolio-risk-state-strip.tsx")

  assert.match(page, /PortfolioCommandHeader/)
  assert.match(page, /PortfolioBattleHud/)
  assert.match(hud, /Tổng tài sản \(NAV\)/)
  assert.match(hud, /text-(?:3xl|4xl)/)
  assert.match(riskCore, /PortfolioRiskStateStrip/)
  assert.match(strip, /concentration\.summary\.overallStatus/)
  assert.doesNotMatch(strip, /fetch\s*\(/)
})
```

Expected RED: new components absent.

- [ ] **Step 2: Implement `PortfolioBattleHud` by moving the existing summary calculation, not changing it**

Preserve the current formulas:

```ts
const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
const marketValue = currentPrice * pos.openQty
const invested = pos.avgCost * pos.openQty
const unrealized = (currentPrice - pos.avgCost) * pos.openQty
```

Display the same four concepts: NAV/market value, unrealized P/L, realized P/L, open-position count. Increase metric typography to `text-3xl` / responsive `text-4xl` for the primary NAV and at least `text-2xl` for other key values.

- [ ] **Step 3: Make `PortfolioSummaryBar` a compatibility wrapper**

```tsx
export function PortfolioSummaryBar(props: PortfolioSummaryBarProps) {
  return <PortfolioBattleHud {...props} />
}
```

Do not keep two copies of summary calculations.

- [ ] **Step 4: Implement compact command header/actions and wire them in `PortfolioPage`**

Keep `setGuidanceOpen`, `handleRefreshTransactions`, `handleOpenAddTx`, selector callbacks and portfolio CRUD in `PortfolioPage`; pass only callbacks/nodes to presentation components.

- [ ] **Step 5: Implement `PortfolioRiskStateStrip` and progressive disclosure in risk dashboard**

The strip shows only canonical values already on `risk`, including:

```ts
risk.riskState.state
risk.activeRisk.knownActiveRiskVnd
risk.activeRisk.activeRiskPercent
risk.activeRisk.remainingRiskBudgetVnd
risk.concentration.summary.overallStatus
risk.activeRisk.unknownRiskItemCount
```

Keep existing detailed metrics, evidence, concentration panel and per-open-trade risk rows inside an explicit `<details>` disclosure labelled `Mở bảng rủi ro chi tiết`. Do not remove any existing risk evidence.

- [ ] **Step 6: Run GREEN + QEO-141/QEO-159 regressions**

```bash
node --test tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts
node --test tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/portfolio/portfolio-page.tsx components/portfolio/portfolio-summary-bar.tsx components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx components/portfolio/revamp tests/portfolio/qeo165-command-center-ui.test.ts
git commit -m "feat(QEO-165): add portfolio command HUD and risk strip"
```

---

### Task 3: Tactical Position Cards, Battle Rail and Detailed-Table Drill-Down

**Files:**
- Create: `tests/portfolio/qeo165-tactical-position-ui.test.ts`
- Create: `components/portfolio/revamp/position-battle-rail.tsx`
- Create: `components/portfolio/revamp/tactical-position-card.tsx`
- Create: `components/portfolio/revamp/portfolio-position-grid.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export interface TacticalPositionCardData {
  ticker: string
  openQty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  targetPrice: number | null
  stopLoss: number | null
}
```

`PortfolioPositionGrid` consumes the same canonical inputs as the old table:

```ts
{
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading: boolean
  onAddTransaction: (ticker?: string) => void
}
```

No card receives or fetches independent market data.

- [ ] **Step 1: Write the failing tactical-card source contract**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")

test("Tài sản defaults to tactical cards and keeps the dense table as drill-down", () => {
  const page = read("components/portfolio/portfolio-page.tsx")
  const card = read("components/portfolio/revamp/tactical-position-card.tsx")
  const rail = read("components/portfolio/revamp/position-battle-rail.tsx")

  assert.match(page, /PortfolioPositionGrid/)
  assert.match(page, /Chi tiết đội hình/)
  assert.match(page, /PortfolioPositionsTable/)
  assert.match(card, /\+ Lệnh/)
  assert.match(card, /MISSING_STOP|THIẾU STOP/)
  assert.match(rail, /STOP/)
  assert.match(rail, /TARGET/)
  assert.doesNotMatch(card, /rarity|conviction|tấn công|phòng thủ|mạnh|yếu/i)
})
```

Register it in `tests/test-contracts.json` and run RED. Expected: card/grid/rail files missing.

- [ ] **Step 2: Implement `PositionBattleRail` as a numeric position visualizer only**

When stop and target are both finite and different, calculate a clamped current marker:

```ts
const low = Math.min(stopLoss, targetPrice)
const high = Math.max(stopLoss, targetPrice)
const progress = high > low
  ? Math.max(0, Math.min(100, ((currentPrice - low) / (high - low)) * 100))
  : 50
```

Labels must identify `STOP`, `CURRENT`, `TARGET`; no probability language or success percentage.

- [ ] **Step 3: Implement `TacticalPositionCard`**

Required visible facts: ticker, quantity, current price, avg cost, market value, P/L VND, P/L %, target, stop and factual state from `resolveTacticalPositionState`. The only primary mutation action is `+ Lệnh`, calling the existing `onAddTransaction(ticker)` callback.

- [ ] **Step 4: Implement `PortfolioPositionGrid`**

Derive values with the exact existing display math:

```ts
const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
const marketValue = currentPrice * pos.openQty
const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
const unrealizedPnlPct = pos.avgCost > 0
  ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100
  : 0
```

Use one card per position, skeleton cards for loading, and a larger empty-state CTA when no positions exist.

- [ ] **Step 5: Reorder the Tài sản tab**

Target order in `PortfolioPage`:

```text
PortfolioBattleHud
PortfolioRiskDashboard (compact strip + disclosure)
PortfolioPositionGrid
PortfolioAllocationChart
<details>Chi tiết đội hình -> PortfolioPositionsTable</details>
```

- [ ] **Step 6: Run GREEN + AVCO/UI regressions**

```bash
node --test tests/portfolio/qeo165-tactical-position-ui.test.ts tests/portfolio/qeo165-command-center-ui.test.ts
node --test tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts
pnpm test:current
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/portfolio/revamp components/portfolio/portfolio-page.tsx tests/portfolio/qeo165-tactical-position-ui.test.ts tests/test-contracts.json
git commit -m "feat(QEO-165): make tactical cards the primary holdings view"
```

---

### Task 4: Redesign Guidance as the Field Manual

**Files:**
- Create: `tests/portfolio/qeo165-guidance-ui.test.ts`
- Modify: `components/portfolio/portfolio-guidance-dialog.tsx`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Preserve `PortfolioGuidanceDialogProps` exactly:
  ```ts
  { open: boolean; onOpenChange: (open: boolean) => void }
  ```
- No new risk defaults. Existing guidance copy that conflicts with configured-plan semantics must be rewritten to describe user-configured rules rather than universal mandates.

- [ ] **Step 1: Write RED contract for larger accessible guidance**

```ts
test("Field Manual materially enlarges guidance and removes tiny critical copy", () => {
  const source = read("components/portfolio/portfolio-guidance-dialog.tsx")

  assert.match(source, /max-w-(?:4xl|5xl)/)
  assert.match(source, /Field Manual|Cẩm nang/i)
  assert.match(source, /text-(?:sm|base)/)
  assert.doesNotMatch(source, /text-\[11px\]/)
  assert.doesNotMatch(source, /Tối thiểu R:R = 1:2\.5/)
  assert.doesNotMatch(source, /bắt buộc.*1-2%|Vi phạm là bán ngay/i)
})
```

Register and run RED against current `max-w-2xl` / `text-xs` implementation.

- [ ] **Step 2: Restructure the dialog without changing its open/close behavior**

Desktop layout:

```text
sticky title/header
left chapter navigation (hidden on narrow screens)
right scrollable chapter content
```

Use `max-w-5xl`, `max-h-[92vh]`, body `text-sm sm:text-base`, and chapter cards with formula examples.

- [ ] **Step 3: Correct guidance copy to current Portfolio/Risk semantics**

Do not state universal hidden defaults such as mandatory `1–2%`, mandatory `R:R 1:2.5`, or automatic `5–7%` stops. Copy should say values come from the user's current Money Management Plan / explicit planned trade inputs, and examples are examples only.

- [ ] **Step 4: Run GREEN + QEO-138 terminology/UI regression**

```bash
node --test tests/portfolio/qeo165-guidance-ui.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/portfolio/portfolio-guidance-dialog.tsx tests/portfolio/qeo165-guidance-ui.test.ts tests/test-contracts.json
git commit -m "feat(QEO-165): redesign portfolio guidance as field manual"
```

---

### Task 5: Make Capital Allocation a Progressive War Room

**Files:**
- Create: `tests/portfolio/qeo165-war-room-ui.test.ts`
- Create: `components/portfolio/revamp/war-room-stage-nav.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export type WarRoomStage = "capacity" | "current" | "sizing" | "simulation"

export interface WarRoomStageNavProps {
  stage: WarRoomStage
  onStageChange: (stage: WarRoomStage) => void
}
```

`PortfolioCapitalAllocationProps` remains unchanged. Existing state owners remain:
- `manualAccountEquityVnd`
- `plannedTrades`
- `useRiskSizingContext(activePortfolioId)`
- `buildPortfolioAllocationSnapshot`
- `simulatePlannedTrades`

- [ ] **Step 1: Write RED contract**

```ts
test("capital allocation uses progressive War Room stages without changing advisor boundaries", () => {
  const allocation = read("components/portfolio/portfolio-capital-allocation.tsx")
  const nav = read("components/portfolio/revamp/war-room-stage-nav.tsx")
  const advisor = read("components/portfolio/risk-sizing/trade-size-advisor.tsx")

  assert.match(allocation, /WarRoomStageNav/)
  assert.match(nav, /Quân lực/)
  assert.match(nav, /Lệnh dự kiến/)
  assert.match(nav, /Dàn quân/)
  assert.match(nav, /Simulation/)
  assert.match(allocation, /PortfolioAllocationAdvisor/)
  assert.match(allocation, /PortfolioCurrentState/)
  assert.match(allocation, /TradeSizeAdvisor/)
  assert.match(allocation, /CombinedPortfolioSimulation/)
  assert.doesNotMatch(advisor, /method:\s*["']POST["']/)
})
```

Register and run RED; expected missing stage nav.

- [ ] **Step 2: Add local `stage` state only**

```ts
const [stage, setStage] = useState<WarRoomStage>("capacity")
```

Do not move or duplicate risk/sizing calculations.

- [ ] **Step 3: Render one major planning panel at a time**

Mapping:

```ts
capacity -> PortfolioAllocationAdvisor
current -> PortfolioCurrentState
sizing -> TradeSizeAdvisor
simulation -> CombinedPortfolioSimulation
```

Keep compact Account Equity / estimated cash / planned-trade count summary visible above stages so users retain context while switching.

- [ ] **Step 4: Move `PortfolioRiskPlan` behind an explicit advanced-plan disclosure in `PortfolioPage`**

Label: `Kế hoạch quản trị vốn nâng cao`. The component still renders with the same `portfolioId` and retains all existing persistence/version behavior.

- [ ] **Step 5: Run GREEN + QEO-139/QEO-159 regressions**

```bash
node --test tests/portfolio/qeo165-war-room-ui.test.ts
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo159-override-audit.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/portfolio-capital-allocation.tsx components/portfolio/portfolio-page.tsx components/portfolio/revamp/war-room-stage-nav.tsx tests/portfolio/qeo165-war-room-ui.test.ts tests/test-contracts.json
git commit -m "feat(QEO-165): turn capital allocation into a progressive war room"
```

---

### Task 6: Convert Raw Transaction History into a Battle Log with Table Drill-Down

**Files:**
- Create: `tests/portfolio/qeo165-battle-log-ui.test.ts`
- Create: `components/portfolio/revamp/battle-log-card.tsx`
- Modify: `components/portfolio/portfolio-transaction-history.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `tests/test-contracts.json`

**Interfaces:**

`BattleLogCard` consumes one existing `RawTransaction` plus delete controls passed by its owner:

```ts
{
  transaction: RawTransaction
  confirmingDelete: boolean
  deleting: boolean
  onRequestDelete: () => void
  onConfirmDelete: () => Promise<void>
  onCancelDelete: () => void
}
```

It may label factual transaction actions `Mua`, `Bán`, `Cổ tức tiền`, `Cổ tức CP`, `Quyền mua` and existing legacy provenance. It must not label a raw fill `WIN`, `LOSS`, `OPEN`, `PARTIAL` or `CLOSED` because `PortfolioTransactionHistory` does not own normalized Trade outcome data.

- [ ] **Step 1: Write RED contract**

```ts
test("Nhật ký is card/timeline first and does not invent Trade lifecycle state", () => {
  const history = read("components/portfolio/portfolio-transaction-history.tsx")
  const card = read("components/portfolio/revamp/battle-log-card.tsx")

  assert.match(history, /BattleLogCard/)
  assert.match(history, /Chi tiết giao dịch dạng bảng/)
  assert.match(card, /transaction\.action/)
  assert.match(card, /legacy_migration_status/)
  assert.doesNotMatch(card, /\bWIN\b|\bLOSS\b|\bPARTIAL\b|\bCLOSED\b|\bOPEN\b/)
})
```

Register and run RED.

- [ ] **Step 2: Implement `BattleLogCard`**

Use larger ticker/date/action hierarchy, numeric quantity/price/fee facts, note/tags, existing legacy badge semantics, and the same delete confirmation callbacks. No new data requests.

- [ ] **Step 3: Make cards the primary history view**

Keep ticker filters. Render filtered transactions as a responsive vertical timeline/card list first. Keep the existing table markup inside `<details>` labelled `Chi tiết giao dịch dạng bảng` for dense inspection.

- [ ] **Step 4: Increase journal-page framing in `PortfolioPage`**

Use `PortfolioSectionShell` with title `Battle Log · Nhật ký giao dịch`; body text >= `text-sm`.

- [ ] **Step 5: Run GREEN + legacy reconciliation UI regressions**

```bash
node --test tests/portfolio/qeo165-battle-log-ui.test.ts tests/portfolio/qeo137-legacy-transactions-context.test.ts tests/portfolio/qeo143-legacy-ui-read-model.test.ts
```

If the exact QEO-143 UI test filename differs on current main, use the classified QEO-143 UI/read-model test from `tests/test-contracts.json`; do not weaken the legacy provenance assertions.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/portfolio-transaction-history.tsx components/portfolio/portfolio-page.tsx components/portfolio/revamp/battle-log-card.tsx tests/portfolio/qeo165-battle-log-ui.test.ts tests/test-contracts.json
git commit -m "feat(QEO-165): present portfolio transactions as a battle log"
```

---

### Task 7: Campaign Results and Scouting Board Presentation

**Files:**
- Create: `tests/portfolio/qeo165-secondary-tabs-ui.test.ts`
- Create: `components/portfolio/revamp/scouting-card.tsx`
- Modify: `components/portfolio/performance/performance-dashboard.tsx`
- Modify: `components/portfolio/watchlist-panel.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- `PortfolioPerformanceDashboard({ portfolioId })` and its single `usePortfolioPerformance(portfolioId)` fetch remain unchanged.
- `WatchlistPanel` keeps its current `initialWatchlists`, `initialActiveId`, `initialItems` API and existing one-batch quote fetch keyed by all current tickers.
- `ScoutingCard` consumes already-loaded `WatchlistItem` + quote data passed from `WatchlistPanel`; it contains no fetch.

- [ ] **Step 1: Write RED contract**

```ts
test("Performance becomes Campaign Results without changing canonical fetch ownership", () => {
  const performance = read("components/portfolio/performance/performance-dashboard.tsx")
  assert.match(performance, /Campaign Results|Kết quả chiến dịch/i)
  assert.match(performance, /usePortfolioPerformance\(portfolioId\)/)
  assert.doesNotMatch(performance, /fetch\s*\(/)
})

test("Watchlist becomes card-first Scouting Board without per-card requests", () => {
  const watchlist = read("components/portfolio/watchlist-panel.tsx")
  const card = read("components/portfolio/revamp/scouting-card.tsx")
  assert.match(watchlist, /ScoutingCard/)
  assert.match(watchlist, /Scouting Board|Trinh sát/i)
  assert.match(watchlist, /tickersKey/)
  assert.doesNotMatch(card, /fetch\s*\(/)
  assert.doesNotMatch(card, /recommend|khuyến nghị|conviction/i)
})
```

Register and run RED.

- [ ] **Step 2: Reframe performance hierarchy only**

Keep all existing scorecard/equity/ledger/benchmark/segments components and filters. Increase header/help typography, rename the presentation header to `Campaign Results · Hiệu suất danh mục`, and preserve the evidence/sample-size warning.

- [ ] **Step 3: Implement `ScoutingCard`**

Show ticker, note, current quote/change if present, alerts and tags. Keep the link to `/insights/wyckoff?ticker=...` and remove action callbacks only if they remain available elsewhere; do not turn a watchlist card into a buy recommendation.

- [ ] **Step 4: Make watchlist items card-first, keep detailed table/list as disclosure if needed**

Reuse the existing quote map; do not move the quote fetch into cards and do not create N requests.

- [ ] **Step 5: Run GREEN + QEO-142/watchlist regressions**

```bash
node --test tests/portfolio/qeo165-secondary-tabs-ui.test.ts tests/portfolio/qeo142-performance-ui.test.ts
pnpm test:current
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/performance/performance-dashboard.tsx components/portfolio/watchlist-panel.tsx components/portfolio/portfolio-page.tsx components/portfolio/revamp/scouting-card.tsx tests/portfolio/qeo165-secondary-tabs-ui.test.ts tests/test-contracts.json
git commit -m "feat(QEO-165): revamp performance and scouting presentation"
```

---

### Task 8: Motion, Responsive Hardening and Exact-Head Release Gate

**Files:**
- Modify: `components/portfolio/portfolio-theme.module.css`
- Modify: `components/portfolio/revamp/*.tsx` only where motion/responsive behavior is needed
- Modify: `.github/workflows/qeo165-preprod.yml`
- Modify: `tests/portfolio/qeo165-boundaries.test.ts`
- Modify: `tests/portfolio/qeo165-command-center-ui.test.ts`

**Interfaces:**
- No new runtime dependencies.
- `motion` may be imported only for transform/opacity presentation; functionality must remain usable with motion disabled.
- Existing callbacks/links remain normal semantic controls.

- [ ] **Step 1: Extend RED boundary tests for reduced motion, touch sizing and no dependency drift**

Add source assertions covering:

```ts
const theme = read("components/portfolio/portfolio-theme.module.css")
const pkg = JSON.parse(read("package.json"))

assert.match(theme, /prefers-reduced-motion:\s*reduce/)
assert.equal(pkg.dependencies.motion != null, true)
assert.equal(pkg.dependencies.framerMotion, undefined)
```

Also assert tactical card action/button markup includes a comfortable `min-h-10`/`h-10`-class touch target or equivalent and status text is present in addition to color.

- [ ] **Step 2: Add restrained motion**

Allowed implementation pattern:

```tsx
<motion.article
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  whileHover={{ y: -3 }}
  transition={{ duration: 0.18 }}
>
```

Use only on non-essential presentation. Do not animate continuous price direction or risk warnings. Keep CSS reduced-motion override authoritative.

- [ ] **Step 3: Harden responsive layout**

Verify source classes provide:
- tactical grid: 1 column mobile, 2 tablet, 3–4 desktop;
- no essential horizontal scroll except detailed tables;
- command actions wrap;
- Field Manual near-full viewport on mobile;
- War Room stage controls horizontally scroll only if necessary while active panel remains full width.

- [ ] **Step 4: Expand `.github/workflows/qeo165-preprod.yml` to the final focused release gate**

Final job commands:

```yaml
- run: node --test tests/portfolio/qeo165-*.test.ts
- run: node --test tests/portfolio/qeo138-risk-plan-ui.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo142-performance-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts tests/portfolio/qeo159-override-audit.test.ts
- run: pnpm test:manifest
- run: pnpm test:current
- run: pnpm lint:touched
- run: pnpm typecheck
- run: pnpm build
```

Do not add DB replay/migration commands specifically for QEO-165 because QEO-165 contains no DB changes; repository-wide Verify/DB Drift workflows remain independently authoritative when triggered.

- [ ] **Step 5: Run final local/CI verification on the exact feature head**

Required evidence before claiming complete:

```bash
node --test tests/portfolio/qeo165-*.test.ts
pnpm test:manifest
pnpm test:current
pnpm lint:touched
pnpm typecheck
pnpm build
```

Also require exact-head success for relevant Portfolio gates already configured by path overlap: QEO-138/QEO-139/QEO-141/QEO-142/QEO-159 and canonical Verify. Do not merge on stale-success SHA.

- [ ] **Step 6: Diff audit**

Confirm changed files contain:
- no `supabase/migrations/**`;
- no `app/api/**` Portfolio/Risk behavior changes;
- no generated DB type change;
- no added animation dependency;
- no `fetch` in `components/portfolio/revamp/**`;
- no removal of the five Portfolio tabs;
- no invented stock scoring/role terminology.

- [ ] **Step 7: Preview/manual visual review before merge**

This is a human/preview visual review, not the postponed QEO-144 Playwright acceptance. Check at minimum:
- desktop Tài sản card hierarchy and card density;
- mobile one-card-per-row layout;
- Field Manual readability;
- War Room stage navigation preserving planned-trade state;
- Battle Log delete flow;
- Performance filters;
- Watchlist add/remove and batch quote display;
- reduced-motion behavior where the environment allows it.

Any functional regression found here gets a deterministic test before the fix.

- [ ] **Step 8: Commit hardening**

```bash
git add components/portfolio .github/workflows/qeo165-preprod.yml tests/portfolio/qeo165-*.test.ts
git commit -m "test(QEO-165): harden portfolio command center release gates"
```

- [ ] **Step 9: Pre-merge handoff**

Before merge, use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`. Record exact-head CI, changed-file audit and preview evidence on QEO-165. Only then move the PR from draft to ready and follow the normal merge/deploy production flow.

- [ ] **Step 10: Resume QEO-144 after QEO-165 production acceptance**

QEO-144 Playwright/browser acceptance must target the new QEO-165 UI. Do not duplicate old-layout screenshot expectations. Preserve the controlled fixture work already completed on the QEO-144 branch and reconcile it against latest `main` before resuming.

---

## Plan Self-Review

- **Spec coverage:** All spec areas are mapped: command hierarchy (Tasks 1–2), tactical cards/battle rail (Task 3), Field Manual (Task 4), War Room (Task 5), Battle Log (Task 6), Campaign Results/Scouting Board (Task 7), responsive/motion/accessibility/performance/release gates (Task 8).
- **Boundary coverage:** No task introduces DB/API behavior or a second Portfolio/Risk fetch owner. QEO-139/QEO-141/QEO-142/QEO-159 regressions are explicitly retained.
- **Semantic safety:** Raw transaction Battle Log deliberately does not invent normalized Trade lifecycle states. Position cards do not invent strength/role/rarity/conviction.
- **Test strategy:** QEO-165 uses deterministic source/component contracts and existing Portfolio/Risk regression suites now; full Playwright/browser acceptance remains QEO-144 as explicitly requested.
- **Dependency safety:** Existing `motion` only; no package dependency change is planned.
- **No placeholders:** Every task names exact files, interfaces, RED expectation, implementation behavior, GREEN commands and commit boundary.
