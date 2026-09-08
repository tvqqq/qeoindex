# QEO-141 Canonical Portfolio Active-Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical portfolio Active Risk, Account Equity/Drawdown, and explainable Risk State engine, make QEO-139 consume it, then surface those same facts in `Tài sản` without changing accounting semantics.

**Architecture:** Create `modules/portfolio/risk-engine/` as the single owner of Active Risk, equity-curve and guardrail state semantics. It reuses `computePortfolioPositions()`, `buildTradeReadModel()`, QEO-138 Money Management Plan rules, QEO-140 stop↔exit evidence, canonical RAW Daily marks and existing intraday marks. `risk-sizing` becomes a consumer; no second Active Risk formula remains after acceptance.

**Tech Stack:** Next.js App Router, TypeScript, Node `node:test`, Supabase/Postgres read APIs, existing market services, pnpm/GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-141-active-risk-engine-design.md`

## Global Constraints

- No new database table or migration in QEO-141.
- `portfolio_transactions` + `computePortfolioPositions()` remain canonical AVCO/P&L.
- Missing stop is `RISK_UNKNOWN`, never zero.
- Latest-stop precedence is delegated to `buildTradeReadModel()`.
- `market_ohlcv_raw_daily` is canonical historical price evidence; persisted QEO-132 rows use `source_price_unit = VND_THOUSANDS`, matching portfolio transaction prices in k₫.
- Estimated Cash is not clamped to zero.
- Equity history begins from Initial Capital baseline immediately before the first transaction.
- Known PAUSE trigger > known REDUCE trigger > UNKNOWN insufficient evidence > NORMAL.
- A stop-out requires explicit QEO-140 stop-event ↔ exit-fill evidence.
- Executed transactions are never blocked by guardrails.
- UI is Vietnamese-primary; canonical English/source terms live in tooltip metadata.
- No unrelated portfolio theme redesign.

---

### Task 1: Canonical Active Risk package with a temporary QEO-139 adapter

**Files:**
- Create: `modules/portfolio/risk-engine/types.ts`
- Create: `modules/portfolio/risk-engine/active-risk.ts`
- Modify: `modules/portfolio/risk-sizing/active-risk.ts`
- Test: `tests/portfolio/qeo141-active-risk.test.ts`

**Interfaces:**

`modules/portfolio/risk-engine/active-risk.ts` exports:

```ts
export type OpenTradeRiskInput = {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: "live" | "paper"
  status: "open" | "partially_closed"
  initial_stop_loss_exit?: number | null
  initial_risk_amount?: number | null
  initial_risk_percent?: number | null
  opened_at?: string | null
  created_at: string
  updated_at: string
}

export type StopRiskInput = {
  id: string
  trade_id: string
  stop_type: string
  price: number
  effective_at: string
  created_at: string
}

export function computeOpenTradeActiveRisk(input: {
  trades: OpenTradeRiskInput[]
  fills: RawTransaction[]
  stopEvents: StopRiskInput[]
}): PortfolioActiveRiskResult
```

`modules/portfolio/risk-engine/types.ts` defines:

```ts
export type OpenTradeActiveRiskRow = {
  tradeId: string
  ticker: string
  openQty: number | null
  avgCostKvnd: number | null
  initialStopKvnd: number | null
  currentStopKvnd: number | null
  latestStopEffectiveAt: string | null
  initialRiskAmountVnd: number | null
  initialRiskPercent: number | null
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
  reason: "missing_open_position" | "missing_stop" | null
}

export type PortfolioActiveRiskResult = {
  rows: OpenTradeActiveRiskRow[]
  knownActiveRiskVnd: number
  unknownRiskItemCount: number
  totalInitialOpenRiskVnd: number
  initialRiskUnknownCount: number
}
```

The temporary `risk-sizing/active-risk.ts` adapter keeps QEO-139's current shape until Task 6:

```ts
export type OpenTradeRiskRow = OpenTradeRiskInput
export type StopRiskRow = StopRiskInput

export function computeOpenTradeRiskContext(input: {
  trades: OpenTradeRiskRow[]
  fills: RawTransaction[]
  stopEvents: StopRiskRow[]
}) {
  const current = computeOpenTradeActiveRisk(input)
  return {
    knownActiveRiskVnd: current.knownActiveRiskVnd,
    unknownRiskTradeCount: current.unknownRiskItemCount,
    breakdown: current.rows.map((row) => ({
      tradeId: row.tradeId,
      ticker: row.ticker,
      openQty: row.openQty,
      avgCostKvnd: row.avgCostKvnd,
      latestStopKvnd: row.currentStopKvnd,
      activeRiskVnd: row.activeRiskVnd,
      riskStatus: row.riskStatus,
    })),
  }
}
```

- [ ] **Step 1: Write the failing Active Risk test**

Create `tests/portfolio/qeo141-active-risk.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { computeOpenTradeActiveRisk } from "../../modules/portfolio/risk-engine/active-risk.ts"

const trade = {
  id: "trade-1", portfolio_id: "p1", user_id: "u1", ticker: "FPT",
  mode: "live" as const, status: "open" as const,
  initial_stop_loss_exit: 95, initial_risk_amount: 510_000,
  initial_risk_percent: 1, opened_at: "2026-09-01T02:00:00Z",
  created_at: "2026-09-01T02:00:00Z", updated_at: "2026-09-01T02:00:00Z",
}

const buy = {
  id: "b1", trade_id: "trade-1", ticker: "FPT", action: "buy" as const,
  quantity: 100, price: 100, fee: 10, transaction_date: "2026-09-01", tags: [],
}

test("entry fee is inside AVCO and current Active Risk is stop based", () => {
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy], stopEvents: [] })
  assert.equal(result.rows[0]?.avgCostKvnd, 100.1)
  assert.equal(result.rows[0]?.currentStopKvnd, 95)
  assert.equal(result.rows[0]?.activeRiskVnd, 510_000)
  assert.equal(result.knownActiveRiskVnd, 510_000)
})

test("trailing stop above AVCO reduces downside Trade Risk to zero", () => {
  const result = computeOpenTradeActiveRisk({
    trades: [trade], fills: [buy],
    stopEvents: [{ id: "s2", trade_id: "trade-1", stop_type: "trailing", price: 101, effective_at: "2026-09-02T02:00:00Z", created_at: "2026-09-02T02:00:00Z" }],
  })
  assert.equal(result.rows[0]?.activeRiskVnd, 0)
})

test("partial exit reduces open quantity and active risk", () => {
  const sell = { id: "x1", trade_id: "trade-1", ticker: "FPT", action: "sell" as const, quantity: 40, price: 110, fee: 10, transaction_date: "2026-09-03", tags: [] }
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy, sell], stopEvents: [] })
  assert.equal(result.rows[0]?.openQty, 60)
  assert.equal(result.rows[0]?.activeRiskVnd, 306_000)
})

test("missing stop is unknown and never coerced to zero", () => {
  const result = computeOpenTradeActiveRisk({ trades: [{ ...trade, initial_stop_loss_exit: null }], fills: [buy], stopEvents: [] })
  assert.equal(result.rows[0]?.riskStatus, "unknown")
  assert.equal(result.rows[0]?.activeRiskVnd, null)
  assert.equal(result.unknownRiskItemCount, 1)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-active-risk.test.ts
```

Expected: FAIL with module-not-found for `risk-engine/active-risk.ts`.

- [ ] **Step 3: Implement minimal canonical Active Risk**

For every Trade, filter fills by `trade_id` and ticker, reconstruct AVCO/open quantity with `computePortfolioPositions()`, and call `buildTradeReadModel()` with the Trade's stop events. Use:

```ts
const activeRiskVnd = Math.max(0, position.avgCost - readModel.latestStop.price)
  * position.openQty
  * 1000
```

Never reconstruct missing initial risk. Sum `initial_risk_amount` only when present. Missing open position or missing latest stop creates an unknown row with `activeRiskVnd: null`.

- [ ] **Step 4: Replace QEO-139 formula body with the explicit adapter above**

The adapter maps names only; it contains no Active Risk arithmetic.

- [ ] **Step 5: Run GREEN + compatibility regressions**

```bash
node --test tests/portfolio/qeo141-active-risk.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-engine modules/portfolio/risk-sizing/active-risk.ts tests/portfolio/qeo141-active-risk.test.ts
git commit -m "feat(qeo-141): centralize active risk semantics"
```

---

### Task 2: Current Account Equity, equity series and Drawdown

**Files:**
- Create: `modules/portfolio/risk-engine/equity-curve.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-equity-drawdown.test.ts`

**Interfaces:**

```ts
export type AccountEquitySnapshot = {
  equityVnd: number | null
  estimatedCashVnd: number
  marketValueVnd: number | null
  realizedPnlVnd: number
  unrealizedPnlVnd: number | null
  missingPriceTickers: string[]
  completeness: "complete" | "insufficient"
  fundingWarning: boolean
}

export type EquityPoint = {
  key: string
  kind: "baseline" | "daily" | "current"
  equityVnd: number | null
  status: "complete" | "incomplete"
  missingTickers: string[]
}

export type DrawdownSnapshot = {
  peakEquityVnd: number | null
  peakAt: string | null
  drawdownVnd: number | null
  drawdownPercent: number | null
  completeness: "complete" | "insufficient"
}

export function buildCurrentAccountEquity(input: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  currentPricesKvnd: Record<string, number>
}): AccountEquitySnapshot

export function buildEquityCurve(input: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  sessions: string[]
  rawDailyCloseKvnd: Record<string, Record<string, number>>
  current?: { key: string; pricesKvnd: Record<string, number> }
}): { points: EquityPoint[]; currentDrawdown: DrawdownSnapshot }

export function deriveCurrentDrawdown(points: EquityPoint[]): DrawdownSnapshot
```

- [ ] **Step 1: Write RED tests**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { buildCurrentAccountEquity, buildEquityCurve, deriveCurrentDrawdown } from "../../modules/portfolio/risk-engine/equity-curve.ts"

const buy120m = [{ id: "b", ticker: "FPT", action: "buy" as const, quantity: 2_000, price: 60, fee: 0, transaction_date: "2026-09-01", tags: [] }]

test("current equity preserves negative estimated cash", () => {
  const result = buildCurrentAccountEquity({ initialCapitalVnd: 100_000_000, transactions: buy120m, currentPricesKvnd: { FPT: 65 } })
  assert.equal(result.estimatedCashVnd, -20_000_000)
  assert.equal(result.marketValueVnd, 130_000_000)
  assert.equal(result.equityVnd, 110_000_000)
  assert.equal(result.fundingWarning, true)
})

test("baseline captures loss immediately after first deployment", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{ id: "b", ticker: "FPT", action: "buy" as const, quantity: 1_000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    sessions: ["2026-09-01"], rawDailyCloseKvnd: { "2026-09-01": { FPT: 90 } },
  })
  assert.equal(curve.points[0]?.equityVnd, 100_000_000)
  assert.equal(curve.points[1]?.equityVnd, 90_000_000)
  assert.equal(curve.currentDrawdown.drawdownPercent, 10)
})

test("missing RAW Daily close makes drawdown insufficient", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{ id: "b", ticker: "FPT", action: "buy" as const, quantity: 1_000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    sessions: ["2026-09-01"], rawDailyCloseKvnd: { "2026-09-01": {} },
  })
  assert.equal(curve.points[1]?.status, "incomplete")
  assert.equal(curve.currentDrawdown.completeness, "insufficient")
})

test("new current peak recovers drawdown to zero", () => {
  const result = deriveCurrentDrawdown([
    { key: "baseline", kind: "baseline", equityVnd: 100, status: "complete", missingTickers: [] },
    { key: "d1", kind: "daily", equityVnd: 80, status: "complete", missingTickers: [] },
    { key: "current", kind: "current", equityVnd: 120, status: "complete", missingTickers: [] },
  ])
  assert.deepEqual({ peak: result.peakEquityVnd, drawdown: result.drawdownVnd, percent: result.drawdownPercent }, { peak: 120, drawdown: 0, percent: 0 })
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-equity-drawdown.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement current equity**

Use `computePortfolioPositions()`. Exact formulas:

```ts
const remainingOpenCostBasisVnd = positions.reduce((sum, p) => sum + p.totalInvested * 1000, 0)
const realizedPnlVnd = summary.totalRealizedPnl * 1000
const estimatedCashVnd = initialCapitalVnd + realizedPnlVnd - remainingOpenCostBasisVnd
```

Require a valid current mark for every open ticker before producing `marketValueVnd/equityVnd`; never substitute AVCO.

- [ ] **Step 4: Implement historical curve + drawdown**

Every RAW Daily close is already k₫ (`VND_THOUSANDS`); multiply marked market value by 1000 exactly once. Emit the baseline before session points. Any incomplete point from baseline through current prevents a complete current peak/drawdown because the omitted value could have been the peak.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/portfolio/qeo141-equity-drawdown.test.ts tests/portfolio-pnl.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-engine/equity-curve.ts modules/portfolio/risk-engine/types.ts tests/portfolio/qeo141-equity-drawdown.test.ts
git commit -m "feat(qeo-141): add canonical equity and drawdown primitives"
```

---

### Task 3: Closed Trade, explicit stop-out and holiday/rolling evidence

**Files:**
- Create: `modules/portfolio/risk-engine/trade-outcomes.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-guardrail-evidence.test.ts`

**Interfaces:**

```ts
export type GuardrailTradeOutcome = {
  tradeId: string
  closedAt: string
  netPnlVnd: number
  outcome: "winner" | "loser" | "breakeven"
  explicitStopOut: boolean
}

export function deriveGuardrailTradeOutcomes(input: {
  trades: Array<{ id: string; ticker: string; status: string; closed_at: string | null }>
  fills: RawTransaction[]
  stopEvents: Array<{ id: string; trade_id: string }>
  stopExitFillLinks: Array<{ stop_event_id: string; transaction_id: string; trade_id: string }>
}): GuardrailTradeOutcome[]

export function evaluateRollingTradeLoss(
  outcomes: ReadonlyArray<{ netPnlVnd: number }>,
  tradeCount: number,
): { status: "triggered" | "clear" | "insufficient"; sampleSize: number; aggregateNetPnlVnd: number | null }

export function countConsecutiveExplicitStopOuts(outcomes: GuardrailTradeOutcome[]): number
```

- [ ] **Step 1: Write RED tests with concrete fixtures**

Create two closed Trades. `t1` is a losing explicit stop-out; `t2` is a losing Trade without a stop link.

```ts
const trades = [
  { id: "t1", ticker: "FPT", status: "closed", closed_at: "2026-09-02T08:00:00Z" },
  { id: "t2", ticker: "VHM", status: "closed", closed_at: "2026-09-03T08:00:00Z" },
]
const fills = [
  { id: "b1", trade_id: "t1", ticker: "FPT", action: "buy" as const, quantity: 100, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] },
  { id: "x1", trade_id: "t1", ticker: "FPT", action: "sell" as const, quantity: 100, price: 90, fee: 0, transaction_date: "2026-09-02", tags: [] },
  { id: "b2", trade_id: "t2", ticker: "VHM", action: "buy" as const, quantity: 100, price: 80, fee: 0, transaction_date: "2026-09-01", tags: [] },
  { id: "x2", trade_id: "t2", ticker: "VHM", action: "sell" as const, quantity: 100, price: 70, fee: 0, transaction_date: "2026-09-03", tags: [] },
]
const stopEvents = [{ id: "stop-1", trade_id: "t1" }]
const links = [{ stop_event_id: "stop-1", transaction_id: "x1", trade_id: "t1" }]

test("only explicit stop↔exit evidence counts as stop-out", () => {
  const rows = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks: links })
  assert.equal(rows.find((r) => r.tradeId === "t1")?.explicitStopOut, true)
  assert.equal(rows.find((r) => r.tradeId === "t2")?.explicitStopOut, false)
})

test("rolling N Trade loss is negative aggregate, with exact sample requirement", () => {
  assert.deepEqual(evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 1 }], 2), { status: "triggered", sampleSize: 2, aggregateNetPnlVnd: -1 })
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }], 2).status, "insufficient")
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 3 }], 2).status, "clear")
})
```

Also add one Trade with two sell fills and assert it yields one `GuardrailTradeOutcome`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-guardrail-evidence.test.ts
```

- [ ] **Step 3: Implement closed Trade/stop-out primitives**

Use existing `deriveTradeCloseReview()` for one closed logical Trade outcome. Sort by `closedAt`, then `tradeId`. A Trade is an explicit stop-out only when a link references one of its stop events and one of its actual sell fills.

- [ ] **Step 4: Add deterministic holiday-period evaluator**

Export:

```ts
export function evaluateHolidayPeriodRule(input: {
  period: "daily" | "weekly" | "monthly"
  rule: HolidayPeriodRules
  outcomes: GuardrailTradeOutcome[]
  dailyNetPnlVnd: Array<{ date: string; netPnlVnd: number }>
  periodStartEquityVnd: number | null
}): RiskRuleEvaluation
```

Exact semantics come from the approved spec: amount thresholds compare current-period net P&L; percentage thresholds divide by period-start equity; `consecutiveLosingTrades` checks latest eligible Trades; `consecutiveLosingDays` checks latest active days; `losingTradeWindow` checks latest N Trades aggregate `< 0`. Enabled percentage fields without period-start equity are `insufficient`.

- [ ] **Step 5: Run GREEN + QEO-140 regression**

```bash
node --test tests/portfolio/qeo141-guardrail-evidence.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-engine/trade-outcomes.ts modules/portfolio/risk-engine/types.ts tests/portfolio/qeo141-guardrail-evidence.test.ts
git commit -m "feat(qeo-141): derive deterministic guardrail evidence"
```

---

### Task 4: Explainable Risk State and reduced-risk default

**Files:**
- Create: `modules/portfolio/risk-engine/risk-state.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-risk-state.test.ts`

**Interfaces:**

```ts
export type RiskRuleEvidence = {
  ruleId: string
  severity: "reduce" | "pause"
  configuredThreshold: number | string | null
  observedValue: number | string | null
  status: "triggered" | "clear" | "insufficient"
  reason: string
  source: "money_management_plan" | "canonical_closed_trades" | "account_equity" | "active_risk"
}

export type PortfolioRiskStateResult = {
  state: "NORMAL" | "REDUCE_RISK" | "PAUSE_AND_REVIEW" | "UNKNOWN"
  triggers: RiskRuleEvidence[]
  insufficientRules: RiskRuleEvidence[]
  configuredDefaultTradeRiskPercent: number
  effectiveDefaultTradeRiskPercent: number
}

export function derivePortfolioRiskState(input: {
  configuredDefaultTradeRiskPercent: number
  reductionFactor: number | null
  rules: RiskRuleEvidence[]
}): PortfolioRiskStateResult
```

- [ ] **Step 1: Write RED tests without fixture placeholders**

```ts
const pauseRule = { ruleId: "drawdown_pause", severity: "pause" as const, configuredThreshold: 15, observedValue: 16, status: "triggered" as const, reason: "Drawdown 16% >= 15%", source: "account_equity" as const }
const reduceRule = { ruleId: "drawdown_reduce", severity: "reduce" as const, configuredThreshold: 10, observedValue: 11, status: "triggered" as const, reason: "Drawdown 11% >= 10%", source: "account_equity" as const }
const insufficientRule = { ruleId: "rolling_loss", severity: "pause" as const, configuredThreshold: 25, observedValue: null, status: "insufficient" as const, reason: "Need 25 closed Trades", source: "canonical_closed_trades" as const }
const clearRule = { ...reduceRule, observedValue: 3, status: "clear" as const, reason: "Drawdown 3% < 10%" }

test("known PAUSE beats REDUCE and insufficient evidence", () => {
  assert.equal(derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: 0.5, rules: [pauseRule, reduceRule, insufficientRule] }).state, "PAUSE_AND_REVIEW")
})

test("REDUCE applies configured factor", () => {
  const result = derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: 0.75, rules: [reduceRule] })
  assert.equal(result.state, "REDUCE_RISK")
  assert.equal(result.effectiveDefaultTradeRiskPercent, 1.5)
})

test("insufficient evidence yields UNKNOWN without stronger trigger", () => {
  assert.equal(derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: null, rules: [insufficientRule] }).state, "UNKNOWN")
})

test("clear rules recover deterministically to NORMAL", () => {
  assert.equal(derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: 0.75, rules: [clearRule] }).state, "NORMAL")
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-state.test.ts
```

- [ ] **Step 3: Implement exact precedence**

```ts
const pause = rules.filter((r) => r.severity === "pause" && r.status === "triggered")
const reduce = rules.filter((r) => r.severity === "reduce" && r.status === "triggered")
const insufficient = rules.filter((r) => r.status === "insufficient")
const state = pause.length ? "PAUSE_AND_REVIEW" : reduce.length ? "REDUCE_RISK" : insufficient.length ? "UNKNOWN" : "NORMAL"
```

Only apply reduction when `state === "REDUCE_RISK"` and factor is finite, `> 0` and `< 1`; otherwise effective default equals configured default.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo141-risk-state.test.ts tests/portfolio/qeo138-risk-plan-domain.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-engine/risk-state.ts modules/portfolio/risk-engine/types.ts tests/portfolio/qeo141-risk-state.test.ts
git commit -m "feat(qeo-141): add explainable risk state engine"
```

---

### Task 5: Authenticated server read model and `/risk` API

**Files:**
- Create: `modules/portfolio/risk-engine/server.ts`
- Create: `app/api/portfolio/[id]/risk/route.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-risk-server-api.test.ts`

**Interfaces:**

```ts
export type PortfolioRiskReadModel = {
  account: AccountEquitySnapshot
  activeRisk: PortfolioActiveRiskResult & {
    activeRiskPercent: number | null
    maxActiveRiskVnd: number | null
    remainingRiskBudgetVnd: number | null
    coverage: "complete" | "partial"
  }
  drawdown: DrawdownSnapshot
  riskState: PortfolioRiskStateResult
  evidence: {
    rawDailyCoverage: "complete" | "partial" | "insufficient"
    currentPriceMissingTickers: string[]
  }
}

export async function getPortfolioRiskContext(
  context: ServerAuthContext,
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioRiskReadModel>
```

- [ ] **Step 1: Write a concrete source-boundary RED test**

`tests/portfolio/qeo141-risk-server-api.test.ts` reads the two source files and asserts:

```ts
assert.match(serverSource, /getPortfolioRiskContext/)
for (const table of ["portfolio_transactions", "portfolio_trades", "portfolio_trade_stop_events", "portfolio_trade_stop_exit_fills", "market_ohlcv_raw_daily"]) assert.match(serverSource, new RegExp(table))
assert.match(serverSource, /getRiskPlanOverview/)
assert.match(serverSource, /getCachedIntraday5mSnapshot|getIntraday5mSnapshot/)
assert.match(routeSource, /requireApiUser/)
assert.match(routeSource, /getPortfolioRiskContext/)
assert.doesNotMatch(routeSource, /\.from\(/)
assert.match(routeSource, /private, no-store/)
```

The missing-current-price behavior remains covered behaviorally by Task 2; this task verifies the authenticated adapter does not bypass canonical modules.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-server-api.test.ts
```

Expected: FAIL because server/API files do not exist.

- [ ] **Step 3: Implement authenticated data adapter**

Load one portfolio row including `initial_capital`, all portfolio transactions in ascending transaction date order, normalized Trades, stops, stop-exit links and the current Money Management Plan. Reuse `getRiskPlanOverview()` for plan decoding.

Build open tickers once from canonical positions. Fetch current marks using cached intraday snapshot first, then existing provider-backed snapshot only when cache has no usable row. Missing marks remain missing.

Fetch RAW Daily rows in one portfolio-scoped ticker/date-range query:

```ts
.from("market_ohlcv_raw_daily")
.select("ticker,session_date,close,source_price_unit,price_basis")
.in("ticker", tickers)
.gte("session_date", firstTransactionDate)
.lte("session_date", currentDate)
.order("session_date", { ascending: true })
```

Reject/ignore rows not explicitly `price_basis === "RAW"` or `source_price_unit === "VND_THOUSANDS"` when assembling canonical historical marks.

- [ ] **Step 4: Assemble rule evidence**

Create active-risk cap, drawdown reduce/pause, explicit stop-out streak, rolling Trade loss and enabled holiday-rule evidence. Period-start equity comes from the same equity curve; if unavailable, percentage rules are insufficient.

- [ ] **Step 5: Implement thin GET route**

```ts
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params
  const risk = await getPortfolioRiskContext(auth.context, id)
  return NextResponse.json({ ok: true, risk }, { headers: NO_STORE_HEADERS })
}
```

- [ ] **Step 6: Run GREEN + regressions**

```bash
node --test tests/portfolio/qeo141-risk-server-api.test.ts tests/portfolio/qeo141-active-risk.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts tests/portfolio/qeo141-guardrail-evidence.test.ts tests/portfolio/qeo141-risk-state.test.ts tests/portfolio-pnl.test.ts tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio/risk-engine app/api/portfolio/[id]/risk tests/portfolio/qeo141-risk-server-api.test.ts
git commit -m "feat(qeo-141): expose authenticated portfolio risk context"
```

---

### Task 6: Make QEO-139 consume the canonical engine

**Files:**
- Modify: `modules/portfolio/risk-sizing/server.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Modify: `modules/portfolio/risk-sizing/projection.ts`
- Modify: `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- Delete or reduce to pure type re-export: `modules/portfolio/risk-sizing/active-risk.ts`
- Test: `tests/portfolio/qeo141-qeo139-reconciliation.test.ts`

**Interfaces:**

Risk sizing server context adds:

```ts
configuredDefaultTradeRiskPercent: number
effectiveDefaultTradeRiskPercent: number
riskState: "normal" | "reduce_risk" | "pause_and_review" | "unknown"
riskStateReasons: string[]
```

Existing `defaultTradeRiskPercent` may remain as a compatibility alias to `effectiveDefaultTradeRiskPercent` until all QEO-139 UI consumers migrate in the same task.

- [ ] **Step 1: Write RED reconciliation contract**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import { projectActiveRisk } from "../../modules/portfolio/risk-sizing/projection.ts"

const current = { knownActiveRiskVnd: 12_000_000, accountEquityVnd: 500_000_000, maxActiveRiskPercent: 6, unknownRiskItemCount: 0 }

test("projected risk starts from canonical QEO-141 subtotal", () => {
  const result = projectActiveRisk({ knownActiveRiskVnd: current.knownActiveRiskVnd, accountEquityVnd: current.accountEquityVnd, maxActiveRiskPercent: current.maxActiveRiskPercent, unknownRiskTradeCount: current.unknownRiskItemCount, riskState: "normal" }, 5_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 17_000_000)
})

test("risk sizing server delegates current portfolio risk to QEO-141", () => {
  const source = fs.readFileSync(new URL("../../modules/portfolio/risk-sizing/server.ts", import.meta.url), "utf8")
  assert.match(source, /getPortfolioRiskContext/)
  assert.doesNotMatch(source, /computeOpenTradeRiskContext/)
})
```

Add a server-context fixture in the same test:

```ts
const canonicalState = {
  configuredDefaultTradeRiskPercent: 2,
  effectiveDefaultTradeRiskPercent: 1.5,
  state: "REDUCE_RISK" as const,
}
assert.equal(canonicalState.configuredDefaultTradeRiskPercent, 2)
assert.equal(canonicalState.effectiveDefaultTradeRiskPercent, 1.5)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-qeo139-reconciliation.test.ts
```

- [ ] **Step 3: Replace the temporary adapter path**

`getRiskSizingContext()` calls `getPortfolioRiskContext()` for canonical current risk/equity/cap/state. Preserve Win Ratio and Payoff Ratio evidence from `getRiskPlanOverview()` only; do not perform a second Trade/fill/stop risk query.

Map QEO-141 states to current QEO-139 lower-case enum exactly:

```ts
NORMAL -> normal
REDUCE_RISK -> reduce_risk
PAUSE_AND_REVIEW -> pause_and_review
UNKNOWN -> unknown
```

Use `effectiveDefaultTradeRiskPercent` as the default suggestion and retain configured value separately.

- [ ] **Step 4: Remove duplicate Active Risk ownership**

`risk-sizing/active-risk.ts` must contain no formula and no DB/read-model assembly after this task. Remove it entirely if no imports remain; otherwise keep only explicit type re-exports from `risk-engine`.

- [ ] **Step 5: Run GREEN QEO-139 suite**

```bash
node --test tests/portfolio/qeo141-qeo139-reconciliation.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-sizing components/portfolio/risk-sizing tests/portfolio/qeo141-qeo139-reconciliation.test.ts
git commit -m "refactor(qeo-141): make risk sizing consume canonical portfolio risk"
```

---

### Task 7: `Tài sản` UI, terminology, CI contract and release gates

**Files:**
- Create: `components/portfolio/risk-engine/portfolio-risk-dashboard.tsx`
- Create: `components/portfolio/risk-engine/risk-term-tooltip.tsx`
- Create: `components/portfolio/risk-engine/use-portfolio-risk-context.ts`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `components/portfolio/portfolio-positions-table.tsx`
- Create: `tests/portfolio/qeo141-risk-ui.test.ts`
- Modify: `tests/test-contracts.json`
- Create: `.github/workflows/qeo141-preprod.yml`

**Interfaces:**

The UI fetches only `/api/portfolio/${portfolioId}/risk`. It never reconstructs Active Risk, Drawdown or Risk State client-side.

Required Vietnamese-primary terminology:

```ts
const RISK_TERMS = {
  accountEquity: { labelVi: "Vốn chủ tài khoản", labelEn: "Account Equity" },
  activeRisk: { labelVi: "Rủi ro đang hoạt động", labelEn: "Active Risk" },
  activeRiskPercent: { labelVi: "Tỷ lệ rủi ro đang hoạt động", labelEn: "Active Risk %" },
  maxActiveRisk: { labelVi: "Rủi ro hoạt động tối đa", labelEn: "Max Active Risk" },
  remainingRiskBudget: { labelVi: "Ngân sách rủi ro còn lại", labelEn: "Remaining Risk Budget" },
  initialRisk: { labelVi: "Rủi ro ban đầu", labelEn: "Initial Risk" },
  currentStop: { labelVi: "Dừng lỗ hiện tại", labelEn: "Current Stop" },
  drawdown: { labelVi: "Mức sụt giảm", labelEn: "Drawdown" },
  riskState: { labelVi: "Trạng thái rủi ro", labelEn: "Risk State" },
} as const
```

- [ ] **Step 1: Write RED UI source contract**

Assert all Vietnamese labels above exist in the risk dashboard/tooltip module, each English term appears as `Thuật ngữ gốc`, missing stop copy contains `Rủi ro chưa xác định`, and `Risk Unknown` exists in explanatory help. Assert dashboard iterates `riskState.triggers`/`insufficientRules` instead of deriving rules in JSX.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-ui.test.ts
```

- [ ] **Step 3: Implement portfolio-scoped fetch hook**

Use the same stale-switch protection pattern as transactions:

```ts
type PortfolioRiskState = { portfolioId: string | null; risk: PortfolioRiskReadModel | null }
```

A request result only updates state when its request id is current and its portfolio id still matches.

- [ ] **Step 4: Implement dashboard within existing theme**

Render Account Equity, cash, market value, realized/unrealized P&L, Drawdown, initial open risk, Active Risk, Active Risk %, Max Active Risk, Remaining Risk Budget and Risk State. Known subtotals with partial coverage must visibly say coverage is incomplete. Tooltip for Active Risk states that gaps/slippage/liquidity can make actual loss larger.

- [ ] **Step 5: Enrich positions without changing accounting**

Join API `activeRisk.rows` to existing position rows by ticker for display only. Do not replace position quantities/AVCO/P&L from `computePortfolioPositions()`. Desktop may show current/initial stop and Active Risk; mobile uses stacked/expanded details.

- [ ] **Step 6: Add canonical test manifest entries**

Add all seven `tests/portfolio/qeo141-*.test.ts` entries to `tests/test-contracts.json`, `owner: "portfolio"`, `bucket: "canonical"`, suites `fast`; `qeo141-risk-ui.test.ts` also has `ui-contracts`. Do not modify any existing manifest entry.

- [ ] **Step 7: Add `.github/workflows/qeo141-preprod.yml`**

Path filters:

```text
modules/portfolio/risk-engine/**
modules/portfolio/risk-sizing/**
modules/portfolio/pnl.ts
modules/portfolio/trades/**
modules/portfolio/risk-plan/**
components/portfolio/**
app/api/portfolio/**
tests/portfolio/qeo141-*.test.ts
tests/portfolio/qeo139-*.test.ts
tests/test-contracts.json
.github/workflows/qeo141-preprod.yml
```

Workflow commands, in order:

```bash
node --test tests/portfolio/qeo141-active-risk.test.ts
node --test tests/portfolio/qeo141-equity-drawdown.test.ts
node --test tests/portfolio/qeo141-guardrail-evidence.test.ts
node --test tests/portfolio/qeo141-risk-state.test.ts
node --test tests/portfolio/qeo141-risk-server-api.test.ts
node --test tests/portfolio/qeo141-qeo139-reconciliation.test.ts
node --test tests/portfolio/qeo141-risk-ui.test.ts
node --test tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
node --test tests/portfolio-pnl.test.ts
pnpm test:manifest
pnpm lint:touched
pnpm typecheck
pnpm exec next build
```

- [ ] **Step 8: Run final exact-head gates**

Require QEO-141 workflow plus existing QEO-137, QEO-138, QEO-139 and Verify to conclude SUCCESS on the same final head.

- [ ] **Step 9: Diff audit**

Confirm: no migration; no rewrite of `computePortfolioPositions()`; no second Active Risk formula under `risk-sizing`; no QEO-142 scorecard/ledger UI; no fabricated price/stop/equity evidence.

- [ ] **Step 10: Commit**

```bash
git add components/portfolio app/api/portfolio tests/portfolio tests/test-contracts.json .github/workflows/qeo141-preprod.yml
git commit -m "feat(qeo-141): surface canonical portfolio risk in assets"
```

- [ ] **Step 11: PR and production acceptance**

Open one draft PR early for CI traceability. Mark ready only after fresh exact-head GREEN. Squash merge with expected head SHA. Verify Git-integrated Vercel deployment is READY on the merge SHA, canonical `/portfolio` returns HTTP 200, and no new runtime errors exist. Claim authenticated UI interaction only if actually observed with an authenticated session.
