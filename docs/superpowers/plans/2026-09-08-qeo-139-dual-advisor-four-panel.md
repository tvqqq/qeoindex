# QEO-139 Dual Advisor Four-Panel Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the clear four-panel portfolio workflow while keeping QEO-139 stop-first Trade Size sizing canonical, supporting multiple per-ticker planned Trades and a deterministic combined portfolio verdict.

**Architecture:** `PortfolioCapitalAllocation` becomes the orchestration boundary: it builds portfolio-level snapshot data, loads authenticated risk context once, owns ephemeral per-portfolio planned Trade state, and passes narrow props into four focused panels. Pure planning/simulation functions stay under `modules/portfolio/risk-sizing/`; React components only render deterministic outputs and never duplicate finance/risk formulas.

**Tech Stack:** Next.js 16 / React client components, TypeScript, existing QeoIndex portfolio AVCO + risk-sizing domain, Node `node:test`, GitHub Actions, Vercel production deployment.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-139-dual-advisor-four-panel-design.md`

## Global Constraints

- Preserve the old 2×2 four-panel mental order on desktop; mobile stacks Panels 1 → 4 in numeric order.
- QEO-139 `calculateTradeSize()` remains the only canonical Trade Size engine.
- Never restore fixed `7% stoploss` as a canonical sizing input.
- `Planned Entry` and `Initial Stop` are per planned Trade / per ticker, never portfolio-level.
- One planned row per ticker in this follow-up; a second Add for the same ticker replaces that row.
- Planned Trades are client-side ephemeral planning state only; no DB migration and no Trade lifecycle write.
- Both advisors are deterministic, explainable views; no LLM call and no AI confidence score.
- Load Money Management Plan / Active Risk context once per portfolio through `/api/portfolio/[portfolioId]/risk-sizing`; client components never query Supabase directly.
- Legacy/unlinked holdings without normalized Trade stop evidence remain `Risk Unknown`; compatibility stop fields must not be promoted into canonical risk evidence.
- Never infer margin. A funding shortfall becomes `Funding Gap` and `REVIEW REQUIRED`.
- API/context failure must fail closed as `UNAVAILABLE`; unknown risk must never become zero.
- Optimal f remains informational only and must never auto-change Risk per Trade, Trade Size, planned rows, or Combined Verdict.
- Preserve canonical English risk labels and shared Vietnamese tooltip/help metadata.
- Keep QEO-137 AVCO and QEO-138 Money Management Plan regressions green.

---

## File Structure

**Create**
- `modules/portfolio/risk-sizing/planning.ts` — pure portfolio snapshot, planned-basket simulation, verdict, advisor-message derivation.
- `components/portfolio/risk-sizing/use-risk-sizing-context.ts` — one authenticated risk-context fetch per portfolio.
- `components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx` — Panel 1 only.
- `components/portfolio/risk-sizing/portfolio-current-state.tsx` — Panel 2 only.
- `components/portfolio/risk-sizing/trade-size-advisor.tsx` — Panel 3 draft + planned list + existing Advanced information.
- `components/portfolio/risk-sizing/combined-portfolio-simulation.tsx` — Panel 4 before/planned/after + both advisor messages + verdict.
- `tests/portfolio/qeo139-planned-trade-simulation.test.ts` — pure planning/simulation contracts.

**Modify**
- `modules/portfolio/risk-sizing/types.ts` — planned Trade / simulation / breakdown public types.
- `modules/portfolio/risk-sizing/active-risk.ts` — aggregate + per-Trade breakdown in one deterministic pass.
- `modules/portfolio/risk-sizing/server.ts` — expose per-Trade risk breakdown with existing context.
- `components/portfolio/portfolio-capital-allocation.tsx` — orchestration and four-panel grid.
- `components/portfolio/risk-sizing/trade-size-calculator.tsx` — retire the monolithic presentation after logic is moved to Panel 3/shared helpers; delete if no longer referenced.
- `tests/portfolio/qeo139-risk-sizing-server-api.test.ts` — breakdown + fail-closed API contract.
- `tests/portfolio/qeo139-trade-size-ui.test.ts` — four-panel, per-ticker planning, shared-fetch, no-legacy regressions.
- `tests/test-contracts.json` — register the new canonical test file.
- `.github/workflows/qeo139-preprod.yml` — add the new pure planning/simulation test step.

---

### Task 1: Pure portfolio snapshot, planned-basket simulation, and verdict

**Files:**
- Create: `modules/portfolio/risk-sizing/planning.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Test: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`

**Interfaces:**
- Consumes: existing `PortfolioPosition`, `AccountEquityContext`, `PlannedTrade` snapshots produced later by Panel 3.
- Produces:

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

export type CombinedVerdict =
  | "UNAVAILABLE"
  | "RISK UNKNOWN"
  | "REVIEW REQUIRED"
  | "EXCEEDS PLAN"
  | "WITHIN PLAN"

export function buildPortfolioAllocationSnapshot(input: {
  initialCapitalVnd: number
  totalRealizedPnlKvnd: number
  positions: Array<{ ticker: string; openQty: number; avgCost: number; totalInvested: number }>
  currentPricesKvnd: Record<string, number>
}): PortfolioAllocationSnapshot

export function simulatePlannedTrades(input: {
  accountEquityVnd: number
  accountEquityComplete: boolean
  estimatedAvailableCashVnd: number
  stockMarketValueVnd: number
  knownActiveRiskVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  riskContextAvailable: boolean
  plannedTrades: PlannedTrade[]
}): PortfolioPlanSimulation
```

- [ ] **Step 1: Write the failing pure-domain tests**

Add tests that prove cumulative totals and verdict precedence:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPortfolioAllocationSnapshot,
  simulatePlannedTrades,
} from "../../modules/portfolio/risk-sizing/planning.ts"

const planned = (ticker: string, positionValueVnd: number, riskAddedVnd: number) => ({
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

test("simulation sums multiple planned tickers and derives projected values", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 400_000_000,
    stockMarketValueVnd: 600_000_000,
    knownActiveRiskVnd: 20_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 120_000_000, 8_000_000), planned("VIC", 150_000_000, 9_000_000)],
  })

  assert.equal(result.plannedPositionValueVnd, 270_000_000)
  assert.equal(result.plannedRiskAddedVnd, 17_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 37_000_000)
  assert.equal(result.projectedEstimatedCashVnd, 130_000_000)
  assert.equal(result.fundingGapVnd, 0)
  assert.equal(result.verdict, "WITHIN PLAN")
})

test("verdict precedence is fail-closed", () => {
  const base = {
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 500_000_000,
    stockMarketValueVnd: 500_000_000,
    knownActiveRiskVnd: 10_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 100_000_000, 10_000_000)],
  }

  assert.equal(simulatePlannedTrades({ ...base, riskContextAvailable: false }).verdict, "UNAVAILABLE")
  assert.equal(simulatePlannedTrades({ ...base, unknownRiskTradeCount: 1 }).verdict, "RISK UNKNOWN")
  assert.equal(simulatePlannedTrades({ ...base, accountEquityComplete: false }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, maxActiveRiskPercent: null }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, estimatedAvailableCashVnd: 50_000_000 }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, knownActiveRiskVnd: 45_000_000 }).verdict, "EXCEEDS PLAN")
})
```

Also test `buildPortfolioAllocationSnapshot()` preserves portfolio-level realized P&L and computes:

```text
Stock Market Value = Σ(currentPrice or avgCost × openQty × 1000)
Unrealized P&L = Σ((currentPrice or avgCost − avgCost) × openQty × 1000)
Estimated Available Cash = max(0, Initial Capital + Total Realized P&L − open stock cost basis)
```

and records missing current-price ticker names separately.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts
```

Expected: FAIL because `planning.ts` / exported functions do not exist.

- [ ] **Step 3: Implement the minimal deterministic domain**

Use exact verdict precedence:

```ts
function deriveCombinedVerdict(input: {
  riskContextAvailable: boolean
  unknownRiskTradeCount: number
  accountEquityComplete: boolean
  maxActiveRiskPercent: number | null
  fundingGapVnd: number
  projectedKnownActiveRiskVnd: number
  maxActiveRiskVnd: number | null
}): CombinedVerdict {
  if (!input.riskContextAvailable) return "UNAVAILABLE"
  if (input.unknownRiskTradeCount > 0) return "RISK UNKNOWN"
  if (!input.accountEquityComplete || input.maxActiveRiskPercent == null || input.fundingGapVnd > 0) {
    return "REVIEW REQUIRED"
  }
  if (input.maxActiveRiskVnd != null && input.projectedKnownActiveRiskVnd > input.maxActiveRiskVnd) {
    return "EXCEEDS PLAN"
  }
  return "WITHIN PLAN"
}
```

`simulatePlannedTrades()` must calculate all sums from `PlannedTrade[]`; React must not recompute them later.

- [ ] **Step 4: Run pure-domain tests GREEN**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-sizing/types.ts modules/portfolio/risk-sizing/planning.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts
git commit -m "feat(qeo-139): add planned portfolio simulation domain"
```

---

### Task 2: Produce aggregate and per-Trade Active Risk in one server/domain pass

**Files:**
- Modify: `modules/portfolio/risk-sizing/active-risk.ts`
- Modify: `modules/portfolio/risk-sizing/server.ts`
- Modify: `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`

**Interfaces:**
- Consumes: normalized open Trades, linked fills, canonical stop events.
- Produces:

```ts
export type OpenTradeRiskBreakdown = {
  tradeId: string
  ticker: string
  openQty: number | null
  avgCostKvnd: number | null
  latestStopKvnd: number | null
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
}

computeOpenTradeRiskContext(...): {
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  breakdown: OpenTradeRiskBreakdown[]
}
```

and server context:

```ts
openTradeRisks: OpenTradeRiskBreakdown[]
```

- [ ] **Step 1: Add RED tests for breakdown/aggregate consistency**

Extend the existing server/API test with one known and one unknown Trade:

```ts
assert.equal(result.knownActiveRiskVnd, 5_000_000)
assert.equal(result.unknownRiskTradeCount, 1)
assert.deepEqual(result.breakdown.map((row) => row.riskStatus), ["known", "unknown"])
assert.equal(
  result.breakdown.reduce((sum, row) => sum + (row.activeRiskVnd ?? 0), 0),
  result.knownActiveRiskVnd,
)
```

Also assert `RiskSizingServerContext` and API serialization contain `openTradeRisks`, and no client-side source directly reads `portfolio_trade_stop_events`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts
```

Expected: FAIL because breakdown is absent.

- [ ] **Step 3: Implement breakdown in `computeOpenTradeRiskContext()`**

For every open normalized Trade:

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

After the loop derive aggregate values from the final breakdown array so aggregate and rows cannot drift.

- [ ] **Step 4: Expose `openTradeRisks` through the existing authenticated context**

In `server.ts`, add:

```ts
openTradeRisks: active.breakdown,
```

Do not add a new endpoint or new Supabase query.

- [ ] **Step 5: Run GREEN + regressions**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-sizing/active-risk.ts modules/portfolio/risk-sizing/server.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts
git commit -m "feat(qeo-139): expose per-trade active risk breakdown"
```

---

### Task 3: Centralize one authenticated risk-context fetch per portfolio

**Files:**
- Create: `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**
- Produces:

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

- [ ] **Step 1: Add RED static contract**

In `qeo139-trade-size-ui.test.ts`, require:

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

Expected: FAIL because the shared hook does not exist and calculator still fetches directly.

- [ ] **Step 3: Implement the hook with abort/fail-closed semantics**

Move the existing fetch lifecycle into the hook:

```ts
useEffect(() => {
  const controller = new AbortController()
  setLoading(true)
  setError(null)
  setContext(null)

  void fetch(`/api/portfolio/${portfolioId}/risk-sizing`, {
    cache: "no-store",
    credentials: "same-origin",
    signal: controller.signal,
  })
    .then(async (response) => {
      const body = await response.json() as RiskSizingResponse
      if (!response.ok || !body.ok || !body.context) throw new Error(body.error ?? "Không thể tải risk-sizing context.")
      return body.context
    })
    .then(setContext)
    .catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Không thể tải risk-sizing context.")
    })
    .finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })

  return () => controller.abort()
}, [portfolioId])
```

- [ ] **Step 4: Change the existing calculator to receive context/loading/error props temporarily**

This is a bridge step before Panel 3 is extracted. Remove its internal API fetch entirely. `PortfolioCapitalAllocation` calls the hook exactly once and passes the snapshot down.

- [ ] **Step 5: Run GREEN + TypeScript**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/risk-sizing/use-risk-sizing-context.ts components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/trade-size-calculator.tsx tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "refactor(qeo-139): share one risk sizing context"
```

---

### Task 4: Restore the four-panel shell with Portfolio Advisor and Current Portfolio State

**Files:**
- Create: `components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx`
- Create: `components/portfolio/risk-sizing/portfolio-current-state.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**
- `PortfolioAllocationAdvisor` consumes `PortfolioAllocationSnapshot`, `AccountEquityContext`, shared risk context/loading/error.
- `PortfolioCurrentState` consumes AVCO positions/current prices/realized P&L plus `openTradeRisks` from server context.

- [ ] **Step 1: Add RED four-panel structural contracts**

Require exact numbered headings and old mental order:

```ts
assert.match(allocation, /1\. Portfolio Allocation Advisor/)
assert.match(allocation, /2\. Current Portfolio State/)
assert.match(allocation, /3\. Trade Size Advisor/)
assert.match(allocation, /4\. Combined Portfolio Simulation/)
assert.match(allocation, /grid[^\n]*lg:grid-cols-2/)
```

Also assert Panel 1 source does not contain `plannedEntry` or `initialStop`, while Panel 2 contains holdings/risk row rendering and an explicit `Estimated Available Cash` label.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because dedicated four-panel components do not exist.

- [ ] **Step 3: Build portfolio snapshot once in `PortfolioCapitalAllocation`**

Use `buildPortfolioAllocationSnapshot()` and the existing `buildAccountEquityContext()` from the same portfolio inputs. Do not recompute finance formulas inside panels.

- [ ] **Step 4: Implement Panel 1**

Render portfolio-scoped metrics only:

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

If `accountEquityContext.source === "portfolio_partial"`, render the missing ticker list and mark the advisor state incomplete.

- [ ] **Step 5: Implement Panel 2**

Render AVCO holdings with current price/market value/unrealized P&L. Match normalized Trade risk rows by ticker only for display grouping; never convert a missing normalized row into known risk. For holdings without canonical risk evidence render `Risk Unknown`.

Do not use `PortfolioPosition.stopLoss*` as canonical Active Risk evidence.

- [ ] **Step 6: Compose the 2×2 shell**

At this task, Panels 3 and 4 may still wrap the bridge calculator/current projection content, but numbered cells and ownership boundaries must exist. The next tasks replace those cells fully.

- [ ] **Step 7: Run GREEN + visual-contract regressions**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-account-equity-integration.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx components/portfolio/risk-sizing/portfolio-current-state.tsx tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "feat(qeo-139): restore portfolio four-panel shell"
```

---

### Task 5: Build per-ticker Trade Size Advisor with multiple planned rows

**Files:**
- Create: `components/portfolio/risk-sizing/trade-size-advisor.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify/Delete after migration: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**
- `TradeSizeAdvisor` consumes shared risk context and `AccountEquityContext`.
- It emits immutable `PlannedTrade` snapshots via:

```ts
onUpsertPlannedTrade(trade: PlannedTrade): void
onRemovePlannedTrade(ticker: string): void
plannedTrades: PlannedTrade[]
```

- [ ] **Step 1: Add RED contract for ticker-first planning and basket management**

Require Panel 3 to contain:

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

and static contracts that upsert by ticker instead of append-only duplicates:

```ts
assert.match(source, /plannedTrades\.filter\([^\n]*ticker[^\n]*!==/)
assert.match(source, /\[\.\.\.withoutTicker,\s*trade\]/)
```

Also require ticker normalization to uppercase and no DB/API write for planned rows.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because Panel 3 does not yet support Ticker or planned rows.

- [ ] **Step 3: Move canonical single-Trade calculation into `TradeSizeAdvisor`**

Reuse, do not copy, these domain calls:

```ts
const result = calculateTradeSize({
  side: "long",
  accountEquityVnd,
  riskPercent,
  plannedEntryKvnd,
  initialStopKvnd,
  estimatedCommissionVnd,
  slippageAllowanceVnd,
  lotSizeShares: DEFAULT_REGULAR_LOT_SHARES,
  advancedRiskOverrideAcknowledged,
})
```

The active draft cannot be added unless:

```ts
result.status === "ready" && ticker.trim().length > 0
```

- [ ] **Step 4: Convert ready result into a deterministic planned snapshot**

```ts
const trade: PlannedTrade = {
  id: ticker.toUpperCase(),
  ticker: ticker.toUpperCase(),
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

Parent upsert logic must be:

```ts
setPlannedTrades((current) => [
  ...current.filter((item) => item.ticker !== trade.ticker),
  trade,
])
```

- [ ] **Step 5: Implement Edit/Remove**

Edit loads the selected row back into the active draft and its manual risk/advanced acknowledgement fields. Add then replaces the same ticker row. Remove deletes immediately and leaves other ticker rows unchanged.

- [ ] **Step 6: Keep Advanced evidence inside Panel 3**

Move the existing collapsed Win Ratio / Payoff Ratio / Optimal f section into `TradeSizeAdvisor`. Keep exact disclaimers `informational`, `more aggressive`, `not auto-applied`, and `not a zero-ROR guarantee`.

- [ ] **Step 7: Retire the monolithic calculator**

Once all functionality is migrated, delete `trade-size-calculator.tsx` if it has no references. Update tests to point to `trade-size-advisor.tsx` instead of preserving a dead compatibility wrapper.

- [ ] **Step 8: Run GREEN + sizing regressions**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/trade-size-advisor.tsx components/portfolio/risk-sizing/trade-size-calculator.tsx tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "feat(qeo-139): add per-ticker planned trade advisor"
```

If the old calculator file is deleted, stage it with `git add -A` instead.

---

### Task 6: Implement Combined Portfolio Simulation and both deterministic advisor messages

**Files:**
- Create: `components/portfolio/risk-sizing/combined-portfolio-simulation.tsx`
- Modify: `modules/portfolio/risk-sizing/planning.ts`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Test: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`
- Test: `tests/portfolio/qeo139-trade-size-ui.test.ts`

**Interfaces:**
- Consumes: `PortfolioPlanSimulation`, `PlannedTrade[]`, shared risk context/error/loading.
- Produces deterministic text from pure helpers:

```ts
export function describePortfolioAdvisor(simulation: PortfolioPlanSimulation): string
export function describeTradeAdvisor(plannedTrades: PlannedTrade[]): string
```

- [ ] **Step 1: Add RED domain tests for advisor text**

Examples:

```ts
assert.match(describePortfolioAdvisor(simulationWithFundingGap), /funding gap/i)
assert.match(describePortfolioAdvisor(simulationWithUnknownRisk), /unknown/i)
assert.match(describeTradeAdvisor([planned("MSN", 120_000_000, 8_000_000)]), /MSN/)
assert.match(describeTradeAdvisor([planned("MSN", 1, 1), planned("VIC", 1, 1)]), /2 planned Trades/i)
```

Messages must describe existing deterministic data only; no market forecast language such as `will rise`, `target expected`, or `probability`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts
```

Expected: FAIL because advisor-message helpers do not exist.

- [ ] **Step 3: Implement pure advisor-message helpers**

Use verdict and totals, for example:

```ts
if (simulation.verdict === "RISK UNKNOWN") {
  return `Portfolio risk cannot be classified within plan because ${simulation.unknownRiskTradeCount} open Trade(s) have unknown canonical stop/fill evidence.`
}
if (simulation.fundingGapVnd > 0) {
  return `Planned position value exceeds Estimated Available Cash by ${formatDeterministicVnd(simulation.fundingGapVnd)}; review funding rather than assuming margin.`
}
```

Keep formatting helper deterministic and framework-independent.

- [ ] **Step 4: Add RED UI contracts for Panel 4**

Require sections:

```text
Before
Planned
After
Portfolio Allocation Advisor
Trade Size Advisor
Combined Verdict
```

and one of the verdict tokens from the pure domain. Require `Funding Gap` when nonzero and no text suggesting synthetic margin.

- [ ] **Step 5: Implement Panel 4 from `simulatePlannedTrades()` only**

`PortfolioCapitalAllocation` calls the pure simulator once with the full `plannedTrades` basket and passes its result into `CombinedPortfolioSimulation`.

Panel 4 renders:

```text
Before: Account Equity / Estimated Cash / Market Value / Known Active Risk
Planned: Σ Position Value / Σ Risk Added / planned ticker count
After: Projected Estimated Cash / Projected Known Active Risk / Projected Risk % / Remaining Risk Budget / Funding Gap
```

Do not reproduce formulas in JSX.

- [ ] **Step 6: Preserve fail-closed verdict behavior in UI**

Map verdict exactly:

```ts
const verdictCopy: Record<CombinedVerdict, string> = {
  UNAVAILABLE: "UNAVAILABLE",
  "RISK UNKNOWN": "RISK UNKNOWN",
  "REVIEW REQUIRED": "REVIEW REQUIRED",
  "EXCEEDS PLAN": "EXCEEDS PLAN",
  "WITHIN PLAN": "WITHIN PLAN",
}
```

Do not show `WITHIN PLAN` while current canonical risk is unknown, Account Equity is partial, max Active Risk is absent, risk context failed, or funding gap exists.

- [ ] **Step 7: Run GREEN**

```bash
node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/portfolio/risk-sizing/planning.ts components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/combined-portfolio-simulation.tsx tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
git commit -m "feat(qeo-139): add combined portfolio advisor simulation"
```

---

### Task 7: Lock portfolio isolation, copy/terminology, manifest, and CI coverage

**Files:**
- Modify: `components/portfolio/portfolio-page.tsx` only if the existing keyed remount contract needs adjustment.
- Modify: `tests/portfolio/qeo139-trade-size-ui.test.ts`
- Modify: `tests/test-contracts.json`
- Modify: `.github/workflows/qeo139-preprod.yml`

**Interfaces:**
- No new runtime interface. This task locks the final integration contract.

- [ ] **Step 1: Extend UI regression contract**

Assert all of the following in the final component tree:

```text
- four numbered panels exist;
- Panel 1 has no Planned Entry/Initial Stop input;
- Panel 3 is ticker-first and supports planned list Edit/Remove;
- planned list is held above Panel 3/4 so both share the same basket;
- parent PortfolioCapitalAllocation remains keyed by activePortfolioId in portfolio-page.tsx;
- fixed 7% canonical stop path absent;
- certainty/risk-elimination copy absent;
- client code has no Supabase direct access;
- risk API fetch exists exactly in shared hook, not in both advisors;
- Optimal f remains informational only;
- no persistence POST/PUT/PATCH is issued for Planned Trades.
```

- [ ] **Step 2: Run focused UI contract**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Register the new pure test in `tests/test-contracts.json`**

Add exactly one canonical manifest entry:

```json
{
  "path": "tests/portfolio/qeo139-planned-trade-simulation.test.ts",
  "owner": "portfolio",
  "invariant": "Preserve deterministic multi-ticker planned portfolio simulation and fail-closed combined verdict semantics.",
  "bucket": "canonical"
}
```

Keep the manifest sorted/structured according to the existing file convention.

- [ ] **Step 4: Add the new test to QEO-139 workflow**

After the existing projected Active Risk contract step, add:

```yaml
- name: QEO-139 planned portfolio simulation contract
  run: node --test tests/portfolio/qeo139-planned-trade-simulation.test.ts
```

Do not remove any existing QEO-137/QEO-138/AVCO/lint/typecheck/build gates.

- [ ] **Step 5: Run the complete focused local gate**

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

- [ ] **Step 6: Commit**

```bash
git add tests/portfolio/qeo139-trade-size-ui.test.ts tests/test-contracts.json .github/workflows/qeo139-preprod.yml components/portfolio/portfolio-page.tsx
git commit -m "test(qeo-139): lock dual-advisor four-panel workflow"
```

If `portfolio-page.tsx` did not change, omit it from `git add`.

---

### Task 8: Exact-head review, PR integration, production deployment, and authenticated acceptance

**Files:**
- No planned source changes. Any issue found here returns to the relevant TDD task before merge.
- Update Linear QEO-139 evidence/comments after verification.

**Interfaces:**
- Final artifact is a mergeable PR from `tvq9612/qeo-139-dual-advisor-four-panel-followup` to `main`.

- [ ] **Step 1: Run verification-before-completion on the exact branch head**

Fresh evidence must include:

```text
QEO-139 Risk Sizing
QEO-137 Trade Domain
QEO-138 Risk Plan
Verify
DB Drift Reconciliation
EOD v4
CodeQL (when triggered)
```

Do not rely on pre-follow-up green runs.

- [ ] **Step 2: Review the complete diff against the approved spec**

Explicitly check:

```text
- no 7% fixed-stop resurrection;
- no duplicate risk math in React;
- no direct Supabase client access;
- no DB migration;
- no Planned Trade persistence;
- no inferred margin;
- unknown/unavailable risk never becomes zero;
- one planned row per ticker;
- Panel 4 sums the full basket;
- advisor messages are deterministic and non-predictive;
- old four-panel layout is restored closely enough to preserve the prior mental model.
```

Any Important/Critical finding must be fixed RED → GREEN before merge.

- [ ] **Step 3: Open/update PR and mark ready only after exact-head gates are green**

PR body must summarize the four-panel follow-up, the two deterministic advisors, ephemeral multi-ticker planning, and exact-head verification evidence.

- [ ] **Step 4: Merge with exact-head protection**

Use the repository-approved merge method and supply `expected_head_sha` so the merge fails if the PR head moves after verification.

- [ ] **Step 5: Verify the merged `main` deployment**

Confirm Vercel production deployment metadata points to the exact merged main SHA and reaches `READY` with no alias error. Check `/portfolio` returns HTTP 200 and inspect post-deploy `/portfolio` runtime errors.

- [ ] **Step 6: Execute authenticated production acceptance**

On `/portfolio` → `Phân bổ vốn`, verify:

```text
1. Four panels render in the old 2×2 mental order.
2. Panel 1 shows portfolio-level risk/capital metrics only.
3. Panel 2 lists current holdings and does not fake known risk for unlinked legacy holdings.
4. Panel 3: add MSN with its own Entry/Stop and get a regular-lot Trade Size.
5. Add VIC with different Entry/Stop; both MSN and VIC coexist in Planned Trades.
6. Edit MSN and re-add; MSN row replaces instead of duplicating.
7. Remove VIC; Panel 4 totals immediately decrease.
8. Widen a stop; the affected ticker Trade Size decreases.
9. Costs can consume risk budget and yield no valid size.
10. Risk >2% still requires explicit acknowledgement.
11. Panel 4 displays cumulative planned Position Value and Risk Added.
12. Funding gap causes REVIEW REQUIRED and never synthetic margin.
13. Unknown current Trade risk causes RISK UNKNOWN, never WITHIN PLAN.
14. Missing Max Active Risk causes REVIEW REQUIRED.
15. API context failure displays UNAVAILABLE rather than zero risk.
16. Optimal f remains informational and cannot mutate Trade Size/Risk per Trade.
17. Switching portfolio clears draft and planned basket.
18. Refresh clears planned basket and UI copy does not claim it was saved.
```

- [ ] **Step 7: Close QEO-139 only after authenticated acceptance**

Update Linear with merged SHA, deployment ID, exact-head CI evidence, and the authenticated smoke result. Set QEO-139 to `Done` only when the acceptance checklist is actually observed; otherwise keep `In Review` or `In Progress` with the concrete blocker.
