# QEO-139 Dual Advisor Four-Panel Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the clear four-panel portfolio workflow while keeping QEO-139 stop-first Trade Size sizing canonical, supporting multiple per-ticker planned Trades and a deterministic combined portfolio verdict.

**Architecture:** `PortfolioCapitalAllocation` becomes the orchestration boundary. It builds one portfolio snapshot, loads authenticated risk context once, owns ephemeral per-portfolio planning state, and passes narrow props into four focused panels. All portfolio simulation, risk coverage, planned-basket aggregation, and verdict logic live in framework-independent functions under `modules/portfolio/risk-sizing/`; React only renders those outputs.

**Tech Stack:** Next.js 16, React client components, TypeScript, QeoIndex AVCO + risk-sizing domain, Node `node:test`, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-139-dual-advisor-four-panel-design.md`

## Global Constraints

- Preserve the old 2×2 four-panel mental order on desktop; mobile stacks Panels 1 → 4.
- `calculateTradeSize()` remains the only canonical Trade Size engine.
- Never restore fixed `7% stoploss` as a sizing input.
- `Planned Entry`, `Initial Stop`, Commission, Slippage, and Trade Size are per Trade / per ticker.
- One planned row per ticker; a second Add replaces that ticker's row.
- Planned Trades are ephemeral client planning state only: no DB migration, no Trade write, no persistence API.
- Both advisors are deterministic and explainable; no LLM call and no AI confidence score.
- Load `/api/portfolio/[portfolioId]/risk-sizing` exactly once per active portfolio snapshot; no client Supabase access.
- Legacy/unlinked AVCO holdings without normalized Trade evidence remain `Risk Unknown`; compatibility stop fields never become canonical Active Risk evidence.
- Never infer margin. A capital shortfall becomes `Funding Gap` and `REVIEW REQUIRED`.
- API failure is `UNAVAILABLE`; unknown risk must never become zero.
- Preserve the existing explicit manual Account Equity override. A valid manual value is marked `manual`, is scoped to the active portfolio, and is reset by the existing keyed portfolio remount.
- Optimal f remains informational only and cannot mutate Risk per Trade, Trade Size, planned rows, or Combined Verdict.
- Keep QEO-137 AVCO and QEO-138 Money Management Plan regressions green.

---

## File Structure

**Create**
- `modules/portfolio/risk-sizing/planning.ts` — allocation snapshot, holding-risk coverage, planned-row upsert/removal, basket simulation, verdict, deterministic advisor text.
- `components/portfolio/risk-sizing/use-risk-sizing-context.ts` — one authenticated risk-context fetch per portfolio.
- `components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx` — Panel 1.
- `components/portfolio/risk-sizing/portfolio-current-state.tsx` — Panel 2.
- `components/portfolio/risk-sizing/trade-size-advisor.tsx` — Panel 3.
- `components/portfolio/risk-sizing/combined-portfolio-simulation.tsx` — Panel 4.
- `tests/portfolio/qeo139-planned-trade-simulation.test.ts` — pure planning/simulation contracts.

**Modify**
- `modules/portfolio/risk-sizing/types.ts`
- `modules/portfolio/risk-sizing/active-risk.ts`
- `modules/portfolio/risk-sizing/server.ts`
- `components/portfolio/portfolio-capital-allocation.tsx`
- `components/portfolio/risk-sizing/trade-size-calculator.tsx` — remove after Panel 3 migration if unreferenced.
- `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`
- `tests/portfolio/qeo139-trade-size-ui.test.ts`
- `tests/test-contracts.json`
- `.github/workflows/qeo139-preprod.yml`

---

### Task 1: Pure portfolio planning domain

**Files:**
- Create: `modules/portfolio/risk-sizing/planning.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Test: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`

**Interfaces:**

Add these public types to `types.ts`:

```ts
export type PlannedTrade = {
  id: string
  ticker: string
  plannedEntryKvnd: number
  initialStopKvnd: number
  riskPercent: number
  estimatedCommissionVnd: number
  slippageAllowanceVnd: number
  riskAmountVnd: number
  riskPerShareVnd: number
  tradeSizeShares: number
  positionValueVnd: number
  riskAddedVnd: number
}

export type OpenTradeRiskBreakdown = {
  tradeId: string
  ticker: string
  openQty: number | null
  avgCostKvnd: number | null
  latestStopKvnd: number | null
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
}

export type PortfolioAllocationSnapshot = {
  initialCapitalVnd: number
  totalRealizedPnlVnd: number
  totalUnrealizedPnlVnd: number
  stockCostBasisVnd: number
  stockMarketValueVnd: number
  estimatedAvailableCashVnd: number
  missingPriceTickers: string[]
}

export type HoldingRiskSummary = {
  ticker: string
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
  linkedTradeCount: number
  unknownTradeCount: number
}

export type PortfolioRiskCoverage = {
  holdingRisks: HoldingRiskSummary[]
  unknownRiskItemCount: number
}

export type CombinedVerdict =
  | "UNAVAILABLE"
  | "RISK UNKNOWN"
  | "REVIEW REQUIRED"
  | "EXCEEDS PLAN"
  | "WITHIN PLAN"

export type PortfolioPlanSimulation = {
  plannedPositionValueVnd: number
  plannedRiskAddedVnd: number
  projectedKnownActiveRiskVnd: number
  projectedRiskPercent: number | null
  maxActiveRiskVnd: number | null
  remainingRiskBudgetVnd: number | null
  projectedEstimatedCashVnd: number
  fundingGapVnd: number
  unknownRiskItemCount: number
  verdict: CombinedVerdict
}
```

`planning.ts` must export:

```ts
buildPortfolioAllocationSnapshot(...): PortfolioAllocationSnapshot
summarizePortfolioRiskCoverage(...): PortfolioRiskCoverage
upsertPlannedTrade(current: PlannedTrade[], next: PlannedTrade): PlannedTrade[]
removePlannedTrade(current: PlannedTrade[], ticker: string): PlannedTrade[]
simulatePlannedTrades(...): PortfolioPlanSimulation
```

- [ ] **Step 1: Write RED tests for allocation snapshot and planned-row identity**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildPortfolioAllocationSnapshot,
  removePlannedTrade,
  upsertPlannedTrade,
} from "../../modules/portfolio/risk-sizing/planning.ts"

const trade = (ticker: string, positionValueVnd = 100_000_000, riskAddedVnd = 5_000_000) => ({
  id: ticker,
  ticker,
  plannedEntryKvnd: 100,
  initialStopKvnd: 95,
  riskPercent: 1,
  estimatedCommissionVnd: 0,
  slippageAllowanceVnd: 0,
  riskAmountVnd: riskAddedVnd,
  riskPerShareVnd: 5_000,
  tradeSizeShares: 100,
  positionValueVnd,
  riskAddedVnd,
})

test("allocation snapshot keeps closed-ticker realized P&L and labels missing prices", () => {
  const result = buildPortfolioAllocationSnapshot({
    initialCapitalVnd: 1_000_000_000,
    totalRealizedPnlKvnd: 20_000,
    positions: [{ ticker: "MSN", openQty: 1_000, avgCost: 60, totalInvested: 60_000 }],
    currentPricesKvnd: {},
  })
  assert.equal(result.totalRealizedPnlVnd, 20_000_000)
  assert.equal(result.stockCostBasisVnd, 60_000_000)
  assert.equal(result.estimatedAvailableCashVnd, 960_000_000)
  assert.deepEqual(result.missingPriceTickers, ["MSN"])
})

test("planned ticker upsert replaces instead of duplicating", () => {
  const first = upsertPlannedTrade([], trade("MSN", 100_000_000))
  const second = upsertPlannedTrade(first, trade("MSN", 120_000_000))
  const third = upsertPlannedTrade(second, trade("VIC", 150_000_000))
  assert.equal(second.length, 1)
  assert.equal(second[0]?.positionValueVnd, 120_000_000)
  assert.deepEqual(third.map((row) => row.ticker).sort(), ["MSN", "VIC"])
  assert.deepEqual(removePlannedTrade(third, "MSN").map((row) => row.ticker), ["VIC"])
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts
```

Expected: FAIL because `planning.ts` does not exist.

- [ ] **Step 3: Implement snapshot/upsert/remove minimally**

Use exactly one kVND→VND conversion at the portfolio boundary:

```ts
const totalRealizedPnlVnd = input.totalRealizedPnlKvnd * 1000
const stockCostBasisVnd = input.positions.reduce((sum, p) => sum + p.totalInvested * 1000, 0)
const estimatedAvailableCashVnd = Math.max(0, input.initialCapitalVnd + totalRealizedPnlVnd - stockCostBasisVnd)
```

Current price fallback may use `avgCost` for display math, but every fallback ticker must be recorded in `missingPriceTickers`.

- [ ] **Step 4: Add RED risk-coverage tests**

```ts
test("unlinked holdings and unknown normalized Trades remain unknown", () => {
  const result = summarizePortfolioRiskCoverage({
    positions: [{ ticker: "MSN" }, { ticker: "VIC" }],
    openTradeRisks: [
      { tradeId: "t1", ticker: "MSN", openQty: 100, avgCostKvnd: 70, latestStopKvnd: 65, activeRiskVnd: 500_000, riskStatus: "known" },
    ],
  })
  assert.equal(result.holdingRisks.find((row) => row.ticker === "MSN")?.riskStatus, "known")
  assert.equal(result.holdingRisks.find((row) => row.ticker === "VIC")?.riskStatus, "unknown")
  assert.equal(result.unknownRiskItemCount, 1)
})

test("one unknown normalized Trade makes the holding risk unknown", () => {
  const result = summarizePortfolioRiskCoverage({
    positions: [{ ticker: "MSN" }],
    openTradeRisks: [
      { tradeId: "t1", ticker: "MSN", openQty: 100, avgCostKvnd: 70, latestStopKvnd: 65, activeRiskVnd: 500_000, riskStatus: "known" },
      { tradeId: "t2", ticker: "MSN", openQty: 100, avgCostKvnd: 72, latestStopKvnd: null, activeRiskVnd: null, riskStatus: "unknown" },
    ],
  })
  assert.equal(result.holdingRisks[0]?.riskStatus, "unknown")
  assert.equal(result.holdingRisks[0]?.activeRiskVnd, null)
  assert.equal(result.unknownRiskItemCount, 1)
})
```

Define `unknownRiskItemCount` as:

```text
unknown normalized open Trades
+ AVCO holdings with no matching normalized open Trade row
```

This count is the fail-closed input to Panel 4.

- [ ] **Step 5: Add RED basket-simulation/verdict tests**

```ts
test("simulation sums multiple planned tickers", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 400_000_000,
    knownActiveRiskVnd: 20_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskItemCount: 0,
    riskContextAvailable: true,
    plannedTrades: [trade("MSN", 120_000_000, 8_000_000), trade("VIC", 150_000_000, 9_000_000)],
  })
  assert.equal(result.plannedPositionValueVnd, 270_000_000)
  assert.equal(result.plannedRiskAddedVnd, 17_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 37_000_000)
  assert.equal(result.projectedEstimatedCashVnd, 130_000_000)
  assert.equal(result.verdict, "WITHIN PLAN")
})

test("verdict precedence matches the approved spec", () => {
  const base = {
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 500_000_000,
    knownActiveRiskVnd: 10_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskItemCount: 0,
    riskContextAvailable: true,
    plannedTrades: [trade("MSN", 100_000_000, 10_000_000)],
  }
  assert.equal(simulatePlannedTrades({ ...base, riskContextAvailable: false }).verdict, "UNAVAILABLE")
  assert.equal(simulatePlannedTrades({ ...base, unknownRiskItemCount: 1 }).verdict, "RISK UNKNOWN")
  assert.equal(simulatePlannedTrades({ ...base, accountEquityComplete: false }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, maxActiveRiskPercent: null }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, knownActiveRiskVnd: 45_000_000, estimatedAvailableCashVnd: 50_000_000 }).verdict, "EXCEEDS PLAN")
  assert.equal(simulatePlannedTrades({ ...base, estimatedAvailableCashVnd: 50_000_000 }).verdict, "REVIEW REQUIRED")
})
```

Implement verdict precedence exactly:

```ts
if (!riskContextAvailable) return "UNAVAILABLE"
if (unknownRiskItemCount > 0) return "RISK UNKNOWN"
if (!accountEquityComplete || maxActiveRiskPercent == null) return "REVIEW REQUIRED"
if (projectedKnownActiveRiskVnd > maxActiveRiskVnd) return "EXCEEDS PLAN"
if (fundingGapVnd > 0) return "REVIEW REQUIRED"
return "WITHIN PLAN"
```

This deliberately lets a proven risk-cap breach outrank a separate funding warning when evidence is complete.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio/risk-sizing/types.ts modules/portfolio/risk-sizing/planning.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts
git commit -m "feat(qeo-139): add portfolio planning domain"
```

---

### Task 2: Produce aggregate and per-Trade Active Risk in one pass

**Files:**
- Modify: `modules/portfolio/risk-sizing/active-risk.ts`
- Modify: `modules/portfolio/risk-sizing/server.ts`
- Modify: `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`

**Interfaces:**

`computeOpenTradeRiskContext()` returns:

```ts
{
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  breakdown: OpenTradeRiskBreakdown[]
}
```

`RiskSizingServerContext` adds:

```ts
openTradeRisks: OpenTradeRiskBreakdown[]
```

- [ ] **Step 1: Write RED breakdown/aggregate consistency tests**

Extend the current known+unknown fixture:

```ts
assert.equal(result.knownActiveRiskVnd, 5_000_000)
assert.equal(result.unknownRiskTradeCount, 1)
assert.deepEqual(result.breakdown.map((row) => row.riskStatus), ["known", "unknown"])
assert.equal(result.breakdown.reduce((sum, row) => sum + (row.activeRiskVnd ?? 0), 0), result.knownActiveRiskVnd)
```

Also assert the server/API context contains `openTradeRisks`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts
```

Expected: FAIL because breakdown is absent.

- [ ] **Step 3: Implement breakdown in `active-risk.ts`**

For each normalized open Trade:

```ts
if (!position || !(position.openQty > 0) || !readModel.latestStop) {
  breakdown.push({
    tradeId: trade.id,
    ticker: trade.ticker,
    openQty: position?.openQty ?? null,
    avgCostKvnd: position?.avgCost ?? null,
    latestStopKvnd: readModel.latestStop?.price ?? null,
    activeRiskVnd: null,
    riskStatus: "unknown",
  })
  continue
}

const activeRiskVnd = Math.max(0, position.avgCost - readModel.latestStop.price) * position.openQty * 1000
breakdown.push({
  tradeId: trade.id,
  ticker: trade.ticker,
  openQty: position.openQty,
  avgCostKvnd: position.avgCost,
  latestStopKvnd: readModel.latestStop.price,
  activeRiskVnd,
  riskStatus: "known",
})
```

Derive `knownActiveRiskVnd` and `unknownRiskTradeCount` from the final `breakdown` array so rows and aggregate cannot drift.

- [ ] **Step 4: Expose breakdown through the existing API context**

In `server.ts`:

```ts
openTradeRisks: active.breakdown,
```

Do not add another Supabase query or another endpoint.

- [ ] **Step 5: Run GREEN + regressions**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-sizing/active-risk.ts modules/portfolio/risk-sizing/server.ts modules/portfolio/risk-sizing/types.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts
git commit -m "feat(qeo-139): expose per-trade active risk"
```

---

### Task 3: Centralize one authenticated risk-context fetch

**Files:**
- Create: `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**

```ts
export type RiskSizingClientContext = {
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  openTradeRisks: OpenTradeRiskBreakdown[]
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

export function useRiskSizingContext(portfolioId: string): {
  context: RiskSizingClientContext | null
  loading: boolean
  error: string | null
}
```

- [ ] **Step 1: Add RED source contract**

```ts
const hookPath = "components/portfolio/risk-sizing/use-risk-sizing-context.ts"
const hook = read(hookPath)
const allocation = read(allocationPath)
assert.match(hook, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
assert.match(allocation, /useRiskSizingContext\(activePortfolioId\)/)
assert.doesNotMatch(read(calculatorPath), /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because the shared hook is absent.

- [ ] **Step 3: Move the current abort/fetch/error lifecycle into the hook**

Use `AbortController`, `cache: "no-store"`, `credentials: "same-origin"`, reset `context` on portfolio change, and leave `context=null` on failure.

- [ ] **Step 4: Bridge the current calculator to shared props**

Temporarily pass `{ context, loading, error }` from `PortfolioCapitalAllocation`; delete the calculator's internal fetch. This keeps behavior stable before Panel 3 extraction.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/risk-sizing/use-risk-sizing-context.ts components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/trade-size-calculator.tsx tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "refactor(qeo-139): share one risk context"
```

---

### Task 4: Restore Panels 1 and 2 and portfolio-level orchestration

**Files:**
- Create: `components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx`
- Create: `components/portfolio/risk-sizing/portfolio-current-state.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**

`PortfolioCapitalAllocation` owns:

```ts
const [manualAccountEquityVnd, setManualAccountEquityVnd] = useState<number | null>(null)
const [plannedTrades, setPlannedTrades] = useState<PlannedTrade[]>([])
```

Effective equity:

```ts
const effectiveAccountEquityContext: AccountEquityContext = manualAccountEquityVnd != null
  ? { valueVnd: manualAccountEquityVnd, source: "manual", missingPriceTickers: [] }
  : accountEquityContext
```

The existing `key={activePortfolioId ?? ""}` remount on `PortfolioCapitalAllocation` is the isolation mechanism; do not add cross-portfolio storage.

- [ ] **Step 1: Add RED four-panel structure contracts**

Require exact headings in the composed source:

```text
1. Portfolio Allocation Advisor
2. Current Portfolio State
3. Trade Size Advisor
4. Combined Portfolio Simulation
```

Require `lg:grid-cols-2`, and assert Panel 1 source contains no `plannedEntry`/`initialStop` state.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because dedicated Panels 1/2 do not exist.

- [ ] **Step 3: Build portfolio snapshot/risk coverage once**

In the parent:

```ts
const allocationSnapshot = useMemo(() => buildPortfolioAllocationSnapshot({...}), [...])
const riskCoverage = useMemo(() => summarizePortfolioRiskCoverage({
  positions: positions.map(({ ticker }) => ({ ticker })),
  openTradeRisks: riskContext.context?.openTradeRisks ?? [],
}), [positions, riskContext.context?.openTradeRisks])
```

If risk context is unavailable, do not interpret an empty `openTradeRisks` array as evidence; Panel 2 and Panel 4 use the explicit loading/error state.

- [ ] **Step 4: Implement Panel 1**

Render:

```text
Account Equity
Initial Capital
Realized P&L
Unrealized P&L
Stock Market Value
Estimated Available Cash
Risk per Trade
Active Risk
Max Active Risk
Remaining Risk Budget
```

`Account Equity` remains editable as the existing explicit manual override. Show source `Portfolio`, `Partial`, or `Manual`. If portfolio-derived equity is partial, list `missingPriceTickers`.

Panel 1's deterministic advisor message must describe only capacity/evidence, not market direction.

- [ ] **Step 5: Implement Panel 2**

For every AVCO holding render Ticker, Open Qty, Avg Cost, Current Price, Market Value, Unrealized P&L, stop/risk evidence, and Active Risk. Use `riskCoverage.holdingRisks`; do not use `PortfolioPosition.stopLoss*` to classify risk as known.

If multiple normalized Trades share a ticker:
- all known rows → sum their Active Risk for the holding;
- any unknown row → holding `Risk Unknown` and `activeRiskVnd=null`.

Unlinked holding → `Risk Unknown`.

- [ ] **Step 6: Compose the 2×2 grid**

At this gate, Panels 3/4 may temporarily host the bridged calculator/projection while retaining the numbered cells. Tasks 5/6 replace them completely.

- [ ] **Step 7: Run GREEN**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-account-equity-integration.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx components/portfolio/risk-sizing/portfolio-current-state.tsx tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "feat(qeo-139): restore portfolio advisor panels"
```

---

### Task 5: Build ticker-first Trade Size Advisor and planned basket

**Files:**
- Create: `components/portfolio/risk-sizing/trade-size-advisor.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Delete after migration if unreferenced: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`
- Test: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`

**Interfaces:**

```ts
<TradeSizeAdvisor
  accountEquityContext={effectiveAccountEquityContext}
  riskContext={riskSizing.context}
  loadingRiskContext={riskSizing.loading}
  riskContextError={riskSizing.error}
  plannedTrades={plannedTrades}
  onUpsertPlannedTrade={(trade) => setPlannedTrades((rows) => upsertPlannedTrade(rows, trade))}
  onRemovePlannedTrade={(ticker) => setPlannedTrades((rows) => removePlannedTrade(rows, ticker))}
/>
```

- [ ] **Step 1: Add RED UI contract**

Require Panel 3 to expose:

```text
Ticker
Risk per Trade
Planned Entry
Initial Stop
Estimated Commission
Slippage Allowance
Add Planned Trade
Planned Trades
Edit
Remove
```

Also assert the component imports/uses `calculateTradeSize`, `upsertPlannedTrade` is used by the parent, ticker normalization uses `.toUpperCase()`, and no POST/PUT/PATCH/persistence call exists for planned rows.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because Panel 3 lacks ticker/planned-row behavior.

- [ ] **Step 3: Move canonical calculator behavior into Panel 3**

Reuse the existing call unchanged in semantics:

```ts
const result = calculateTradeSize({
  side: "long",
  accountEquityVnd: accountEquityContext.valueVnd,
  riskPercent,
  plannedEntryKvnd,
  initialStopKvnd,
  estimatedCommissionVnd,
  slippageAllowanceVnd,
  lotSizeShares: DEFAULT_REGULAR_LOT_SHARES,
  advancedRiskOverrideAcknowledged,
})
```

A row is addable only when `result.status === "ready"` and normalized ticker is non-empty.

- [ ] **Step 4: Snapshot the ready result**

```ts
const next: PlannedTrade = {
  id: normalizedTicker,
  ticker: normalizedTicker,
  plannedEntryKvnd: plannedEntryKvnd!,
  initialStopKvnd: initialStopKvnd!,
  riskPercent,
  estimatedCommissionVnd,
  slippageAllowanceVnd,
  riskAmountVnd: result.riskAmountVnd!,
  riskPerShareVnd: result.riskPerShareVnd!,
  tradeSizeShares: result.tradeSizeShares,
  positionValueVnd: result.positionValueVnd!,
  riskAddedVnd: result.totalRiskConsumptionVnd!,
}
```

Send `next` to `onUpsertPlannedTrade`; do not recalculate old rows when editing another ticker.

- [ ] **Step 5: Implement Edit/Remove**

Edit loads the stored ticker/Entry/Stop/risk/costs back into the draft. Re-Add replaces that ticker. Remove deletes only that ticker and Panel 4 recalculates from the new array.

- [ ] **Step 6: Preserve QEO-139 risk provenance and Advanced section**

- Money Management Plan/default risk hydrates once from shared context unless manually touched.
- Risk >2% still requires explicit acknowledgement.
- Move existing Win Ratio / Payoff Ratio / Optimal f `<details>` into Panel 3.
- Keep exact semantics `informational`, `more aggressive`, `not auto-applied`, `not a zero-ROR guarantee`.

- [ ] **Step 7: Retire the monolithic calculator**

After all behavior is moved, delete `trade-size-calculator.tsx` if no reference remains and update UI tests to inspect `trade-size-advisor.tsx`.

- [ ] **Step 8: Run GREEN**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts
git commit -m "feat(qeo-139): add ticker-first planned trade advisor"
```

---

### Task 6: Build Combined Portfolio Simulation and dual-advisor verdict

**Files:**
- Create: `components/portfolio/risk-sizing/combined-portfolio-simulation.tsx`
- Modify: `modules/portfolio/risk-sizing/planning.ts`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Test: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**

Add to `planning.ts`:

```ts
export function describePortfolioAdvisor(simulation: PortfolioPlanSimulation): string
export function describeTradeAdvisor(plannedTrades: PlannedTrade[]): string
```

Use a pure formatter:

```ts
function formatPlanningVnd(value: number): string {
  return `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}
```

- [ ] **Step 1: Add RED advisor-message tests**

```ts
assert.match(describePortfolioAdvisor(simulationWithFundingGap), /funding gap/i)
assert.match(describePortfolioAdvisor(simulationWithUnknownRisk), /unknown/i)
assert.match(describeTradeAdvisor([trade("MSN")]), /MSN/)
assert.match(describeTradeAdvisor([trade("MSN"), trade("VIC")]), /2 planned Trades/i)
```

Advisor copy must not contain predictions such as `will rise`, `expected target`, or probability claims.

- [ ] **Step 2: Implement deterministic messages**

Messages use only simulation/basket facts. For example:

```ts
if (simulation.verdict === "RISK UNKNOWN") {
  return `Portfolio risk cannot be classified within plan because ${simulation.unknownRiskItemCount} current risk item(s) lack canonical evidence.`
}
if (simulation.fundingGapVnd > 0) {
  return `Funding gap ${formatPlanningVnd(simulation.fundingGapVnd)} requires review; the planner does not assume margin.`
}
```

Trade Advisor with >1 row summarizes ticker count, total planned position value, and total planned risk; with 1 row it may include that row's Entry/Stop/Trade Size.

- [ ] **Step 3: Add RED Panel 4 UI contract**

Require:

```text
Before
Planned
After
Portfolio Allocation Advisor
Trade Size Advisor
Combined Verdict
Projected Active Risk
Funding Gap
```

- [ ] **Step 4: Compute simulation once in the parent**

```ts
const simulation = useMemo(() => simulatePlannedTrades({
  accountEquityVnd: effectiveAccountEquityContext.valueVnd,
  accountEquityComplete: effectiveAccountEquityContext.source !== "portfolio_partial",
  estimatedAvailableCashVnd: allocationSnapshot.estimatedAvailableCashVnd,
  knownActiveRiskVnd: riskSizing.context?.knownActiveRiskVnd ?? 0,
  maxActiveRiskPercent: riskSizing.context?.maxActiveRiskPercent ?? null,
  unknownRiskItemCount: riskCoverage.unknownRiskItemCount,
  riskContextAvailable: !riskSizing.loading && riskSizing.context != null,
  plannedTrades,
}), [...])
```

While loading, Panel 4 renders Loading rather than treating `riskContextAvailable=false` as a completed error state. Once loading ends with no context, verdict is `UNAVAILABLE`.

- [ ] **Step 5: Render Panel 4 from `PortfolioPlanSimulation` only**

Before:
- Account Equity
- Estimated Available Cash
- Stock Market Value
- Known Active Risk
- Remaining Risk Budget

Planned:
- planned ticker count
- Σ Position Value
- Σ Risk Added

After:
- Projected Estimated Cash
- Projected Known Active Risk
- Projected Risk %
- Remaining Risk Budget
- Funding Gap

Render the two advisor messages separately, then render the Combined Verdict token exactly.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio/risk-sizing/planning.ts components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/combined-portfolio-simulation.tsx tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "feat(qeo-139): add combined portfolio simulation"
```

---

### Task 7: Lock integration, manifest, and CI gates

**Files:**
- Modify only if needed: `components/portfolio/portfolio-page.tsx`
- Modify: `tests/portfolio/qeo139-trade-size-ui.test.ts`
- Modify: `tests/test-contracts.json`
- Modify: `.github/workflows/qeo139-preprod.yml`

- [ ] **Step 1: Lock the final UI contract**

Assert:

```text
- four numbered panels exist in 1→4 order;
- Panel 1 has no Entry/Stop field;
- Panel 2 does not promote compatibility stopLoss fields to known Active Risk;
- Panel 3 is ticker-first and supports Edit/Remove;
- parent owns one shared planned basket for Panels 3 and 4;
- `PortfolioCapitalAllocation` remains keyed by activePortfolioId;
- fixed 7% stop path absent;
- certainty/risk-elimination copy absent;
- risk fetch exists only in shared hook;
- no client Supabase access;
- no planned-row persistence request;
- Optimal f remains informational only.
```

- [ ] **Step 2: Register the new canonical test**

Add to `tests/test-contracts.json`:

```json
{
  "path": "tests/portfolio/qeo139-planned-trade-simulation.test.ts",
  "owner": "portfolio",
  "invariant": "Preserve deterministic multi-ticker planned portfolio simulation and fail-closed combined verdict semantics.",
  "bucket": "canonical"
}
```

- [ ] **Step 3: Add it to `.github/workflows/qeo139-preprod.yml`**

```yaml
- name: QEO-139 planned portfolio simulation contract
  run: node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts
```

Keep all existing AVCO, QEO-137, QEO-138, lint, typecheck, and build gates.

- [ ] **Step 4: Run the complete focused gate**

```bash
node --test \
  tests/portfolio/qeo139-risk-sizing.test.ts \
  tests/portfolio/qeo139-risk-projection.test.ts \
  tests/portfolio/qeo139-planned-trade-simulation.test.ts \
  tests/portfolio/qeo139-risk-sizing-server-api.test.ts \
  tests/portfolio/qeo139-trade-size-ui.test.ts \
  tests/portfolio/qeo137-trade-domain.test.ts \
  tests/portfolio/qeo137-trade-read-model.test.ts \
  tests/portfolio/qeo138-risk-plan-domain.test.ts \
  tests/portfolio/qeo138-risk-profile-evidence.test.ts \
  tests/portfolio/qeo138-risk-plan-server-api.test.ts \
  tests/portfolio/qeo138-risk-plan-ui.test.ts \
  tests/portfolio-pnl.test.ts
pnpm test:manifest
pnpm lint:touched
pnpm typecheck
pnpm exec next build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/portfolio/qeo139-trade-size-ui.test.ts tests/test-contracts.json .github/workflows/qeo139-preprod.yml components/portfolio/portfolio-page.tsx
git commit -m "test(qeo-139): lock dual-advisor four-panel workflow"
```

Omit `portfolio-page.tsx` if unchanged.

---

### Task 8: Exact-head review, integration, deployment, and authenticated acceptance

**Files:** No planned runtime files. Any defect found here returns to the owning TDD task before merge.

- [ ] **Step 1: Run fresh exact-head verification**

Require fresh results for:

```text
QEO-139 Risk Sizing
QEO-137 Trade Domain
QEO-138 Risk Plan
Verify
DB Drift Reconciliation
EOD v4
CodeQL when triggered
```

Do not reuse pre-follow-up green runs.

- [ ] **Step 2: Audit the full diff against the approved spec**

Check explicitly:

```text
no fixed 7% stop resurrection
no duplicate risk formulas in JSX
no direct client Supabase
no DB migration
no planned Trade persistence
no inferred margin
unlinked holdings feed fail-closed risk coverage
unknown/unavailable risk never becomes zero
one planned row per ticker
Panel 4 sums the complete planned basket
risk-cap breach outranks funding warning only when evidence is complete
advisor messages are deterministic/non-predictive
old four-panel mental model is restored
```

Any Important/Critical finding must be fixed RED→GREEN before merge.

- [ ] **Step 3: Open/update the follow-up PR and mark ready only after exact-head green**

PR body must include the four-panel restoration, two deterministic advisors, ephemeral multi-ticker planning, no-DB scope, and exact-head CI evidence.

- [ ] **Step 4: Merge with exact-head protection**

Use the repository-approved merge method with `expected_head_sha`.

- [ ] **Step 5: Verify the exact merged Vercel production deployment**

Confirm deployment metadata points to the merged `main` SHA, state is `READY`, aliases have no error, `/portfolio` returns HTTP 200, and post-deploy `/portfolio` runtime errors are clean.

- [ ] **Step 6: Execute authenticated production acceptance**

On `/portfolio` → `Phân bổ vốn` verify:

```text
1. Four panels render in the old 2×2 mental order.
2. Panel 1 contains portfolio metrics only and manual Account Equity override still works.
3. Panel 2 lists holdings; an unlinked legacy holding is Risk Unknown.
4. Add MSN with its own Entry/Stop and get regular-lot Trade Size.
5. Add VIC with different Entry/Stop; MSN and VIC coexist.
6. Edit MSN and re-add; it replaces rather than duplicates.
7. Remove VIC; Panel 4 totals immediately decrease.
8. Widen MSN stop; its Trade Size decreases.
9. Costs can consume the risk budget and yield no valid size.
10. Risk >2% still requires acknowledgement.
11. Panel 4 sums all planned Position Value and Risk Added.
12. Complete evidence + cap breach + funding gap yields EXCEEDS PLAN.
13. Funding gap without cap breach yields REVIEW REQUIRED; no synthetic margin appears.
14. Unknown current risk yields RISK UNKNOWN, never WITHIN PLAN.
15. Missing Max Active Risk yields REVIEW REQUIRED.
16. Risk API failure yields UNAVAILABLE, never zero risk.
17. Optimal f remains informational only.
18. Switching portfolio clears draft, manual overrides, and planned basket.
19. Refresh clears planned basket and UI does not claim it was saved.
```

- [ ] **Step 7: Close QEO-139 only after observed authenticated acceptance**

Update Linear with merged SHA, deployment ID, exact-head CI, and smoke evidence. Set `Done` only after the checklist is actually observed; otherwise keep `In Review`/`In Progress` with the concrete blocker.
