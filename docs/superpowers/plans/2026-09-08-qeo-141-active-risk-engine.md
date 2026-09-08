# QEO-141 Canonical Portfolio Active-Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical portfolio Active Risk, Account Equity/Drawdown, and explainable Risk State engine, wire QEO-139 to it, then surface the same facts in `Tài sản` without changing accounting semantics.

**Architecture:** Create `modules/portfolio/risk-engine/` as the single owner of Active Risk, equity-curve and guardrail state semantics. It reuses `computePortfolioPositions()`, `buildTradeReadModel()`, QEO-138 Money Management Plan rules, QEO-140 stop↔exit evidence, canonical RAW Daily marks, and existing intraday current marks. `risk-sizing` becomes a consumer of the engine; it does not retain a competing Active Risk implementation.

**Tech Stack:** Next.js App Router, TypeScript, Node `node:test`, Supabase/Postgres read APIs, existing market services, pnpm/GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-141-active-risk-engine-design.md`

## Global Constraints

- No new database table or migration in QEO-141.
- `portfolio_transactions` + `computePortfolioPositions()` remain canonical AVCO/P&L.
- Missing stop is `RISK_UNKNOWN`, never zero.
- Latest-stop precedence is delegated to `buildTradeReadModel()`.
- Historical equity marks use `market_ohlcv_raw_daily` RAW closes only.
- Estimated Cash is not clamped to zero.
- Equity history begins from Initial Capital baseline before the first transaction.
- Known PAUSE trigger > known REDUCE trigger > UNKNOWN insufficient evidence > NORMAL.
- A stop-out requires explicit QEO-140 stop-event ↔ exit-fill evidence.
- Executed transactions are never blocked by guardrails.
- UI is Vietnamese-primary; canonical English/source terms live in tooltip metadata.
- No unrelated portfolio theme redesign.

---

### Task 1: Canonical Active Risk package and QEO-139 compatibility

**Files:**
- Create: `modules/portfolio/risk-engine/types.ts`
- Create: `modules/portfolio/risk-engine/active-risk.ts`
- Modify: `modules/portfolio/risk-sizing/active-risk.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Test: `tests/portfolio/qeo141-active-risk.test.ts`

**Interfaces:**
- Consumes: `computePortfolioPositions(fills)`, `buildTradeReadModel({ trade, fills, stopEvents, journalEntries })`.
- Produces:
  - `computeOpenTradeActiveRisk(input): PortfolioActiveRiskResult`
  - `OpenTradeActiveRiskRow`
  - `PortfolioActiveRiskResult`
- Compatibility: `modules/portfolio/risk-sizing/active-risk.ts` re-exports the canonical function during the atomic migration; no duplicate formula body remains.

- [ ] **Step 1: Write the failing Active Risk test**

Create `tests/portfolio/qeo141-active-risk.test.ts` with Node test fixtures that prove:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { computeOpenTradeActiveRisk } from "../../modules/portfolio/risk-engine/active-risk.ts"

const trade = {
  id: "trade-1", portfolio_id: "p1", user_id: "u1", ticker: "FPT",
  mode: "live" as const, status: "open" as const,
  initial_stop_loss_exit: 95, opened_at: "2026-09-01T02:00:00Z",
  created_at: "2026-09-01T02:00:00Z", updated_at: "2026-09-01T02:00:00Z",
}

const buy = {
  id: "b1", trade_id: "trade-1", ticker: "FPT", action: "buy" as const,
  quantity: 100, price: 100, fee: 10, transaction_date: "2026-09-01", tags: [],
}

test("entry fee is inside AVCO and current Active Risk is stop based", () => {
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy], stopEvents: [] })
  assert.equal(result.rows[0]?.openQty, 100)
  assert.equal(result.rows[0]?.avgCostKvnd, 100.1)
  assert.equal(result.rows[0]?.currentStopKvnd, 95)
  assert.equal(result.rows[0]?.activeRiskVnd, 510_000)
  assert.equal(result.rows[0]?.riskStatus, "known")
})

test("trailing stop above AVCO reduces downside Trade Risk to zero", () => {
  const result = computeOpenTradeActiveRisk({
    trades: [trade], fills: [buy],
    stopEvents: [{ id: "s2", trade_id: "trade-1", stop_type: "trailing", price: 101, effective_at: "2026-09-02T02:00:00Z", created_at: "2026-09-02T02:00:00Z" }],
  })
  assert.equal(result.rows[0]?.activeRiskVnd, 0)
})

test("partial exit reduces open quantity and active risk", () => {
  const sell = { id: "s1", trade_id: "trade-1", ticker: "FPT", action: "sell" as const, quantity: 40, price: 110, fee: 10, transaction_date: "2026-09-03", tags: [] }
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy, sell], stopEvents: [] })
  assert.equal(result.rows[0]?.openQty, 60)
  assert.equal(result.rows[0]?.activeRiskVnd, 306_000)
})

test("missing stop is unknown and never coerced to zero", () => {
  const noStop = { ...trade, initial_stop_loss_exit: null }
  const result = computeOpenTradeActiveRisk({ trades: [noStop], fills: [buy], stopEvents: [] })
  assert.equal(result.rows[0]?.riskStatus, "unknown")
  assert.equal(result.rows[0]?.activeRiskVnd, null)
  assert.equal(result.unknownRiskItemCount, 1)
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/portfolio/qeo141-active-risk.test.ts
```

Expected: FAIL because `modules/portfolio/risk-engine/active-risk.ts` does not exist.

- [ ] **Step 3: Implement canonical Active Risk types and function**

`types.ts` defines:

```ts
export type RiskCompleteness = "complete" | "partial" | "insufficient"

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
  reason: string | null
}

export type PortfolioActiveRiskResult = {
  rows: OpenTradeActiveRiskRow[]
  knownActiveRiskVnd: number
  unknownRiskItemCount: number
  totalInitialOpenRiskVnd: number
  initialRiskUnknownCount: number
}
```

`active-risk.ts` must:

```ts
const activeRiskVnd = Math.max(0, position.avgCost - readModel.latestStop.price)
  * position.openQty
  * 1000
```

Use `buildTradeReadModel()` for latest stop. Keep unknown rows `null`; sum only known rows. Initial-risk totals use immutable `initial_risk_amount` only and do not reconstruct absent snapshots.

`risk-sizing/active-risk.ts` becomes:

```ts
export { computeOpenTradeActiveRisk as computeOpenTradeRiskContext } from "../risk-engine/active-risk.ts"
export type { OpenTradeRiskRow, StopRiskRow } from "../risk-engine/active-risk.ts"
```

Keep legacy aliases only as compatibility interfaces if existing QEO-139 imports require them.

- [ ] **Step 4: Run GREEN + QEO-139 regression**

```bash
node --test tests/portfolio/qeo141-active-risk.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-engine modules/portfolio/risk-sizing tests/portfolio/qeo141-active-risk.test.ts
git commit -m "feat(qeo-141): centralize active risk semantics"
```

---

### Task 2: Current Account Equity, historical equity series and Drawdown

**Files:**
- Create: `modules/portfolio/risk-engine/equity-curve.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-equity-drawdown.test.ts`

**Interfaces:**
- Produces:
  - `buildCurrentAccountEquity(input): AccountEquitySnapshot`
  - `buildEquityCurve(input): EquityCurveResult`
  - `deriveCurrentDrawdown(points): DrawdownSnapshot`

- [ ] **Step 1: Write RED tests**

Tests must cover four deterministic cases:

```ts
test("current equity keeps negative estimated cash instead of clamping", () => {
  const result = buildCurrentAccountEquity({
    initialCapitalVnd: 100_000_000,
    transactions: [{ id: "b", ticker: "FPT", action: "buy", quantity: 2_000, price: 60, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    currentPricesKvnd: { FPT: 65 },
  })
  assert.equal(result.estimatedCashVnd, -20_000_000)
  assert.equal(result.marketValueVnd, 130_000_000)
  assert.equal(result.equityVnd, 110_000_000)
  assert.equal(result.fundingWarning, true)
})

test("equity curve starts from initial capital baseline and measures first loss", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{ id: "b", ticker: "FPT", action: "buy", quantity: 1_000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    sessions: ["2026-09-01"],
    rawDailyCloseKvnd: { "2026-09-01": { FPT: 90 } },
  })
  assert.equal(curve.points[0]?.equityVnd, 100_000_000)
  assert.equal(curve.points[1]?.equityVnd, 90_000_000)
  assert.equal(curve.currentDrawdown.drawdownPercent, 10)
})

test("missing RAW Daily mark keeps the point incomplete", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{ id: "b", ticker: "FPT", action: "buy", quantity: 1_000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    sessions: ["2026-09-01"], rawDailyCloseKvnd: { "2026-09-01": {} },
  })
  assert.equal(curve.points[1]?.status, "incomplete")
  assert.equal(curve.currentDrawdown.completeness, "insufficient")
})

test("drawdown recovers to zero at a new equity peak", () => {
  const result = deriveCurrentDrawdown([
    { key: "baseline", kind: "baseline", equityVnd: 100, status: "complete", missingTickers: [] },
    { key: "d1", kind: "daily", equityVnd: 80, status: "complete", missingTickers: [] },
    { key: "current", kind: "current", equityVnd: 120, status: "complete", missingTickers: [] },
  ])
  assert.equal(result.peakEquityVnd, 120)
  assert.equal(result.drawdownVnd, 0)
  assert.equal(result.drawdownPercent, 0)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-equity-drawdown.test.ts
```

Expected: FAIL because the equity module does not exist.

- [ ] **Step 3: Implement equity primitives**

Use the exact cash/equity formulas from the spec. `buildEquityCurve()` reconstructs transactions up to each session via `computePortfolioPositions()`, emits a baseline, marks incomplete points when any required open ticker lacks RAW close, and never creates a zero-valued substitute point.

Define point kinds exactly:

```ts
type EquityPoint = {
  key: string
  kind: "baseline" | "daily" | "current"
  equityVnd: number | null
  status: "complete" | "incomplete"
  missingTickers: string[]
}
```

`deriveCurrentDrawdown()` only lets complete points establish peaks. If the current point or any required path segment is incomplete, return `completeness: "insufficient"` and percentage `null`.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo141-equity-drawdown.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-engine/equity-curve.ts modules/portfolio/risk-engine/types.ts tests/portfolio/qeo141-equity-drawdown.test.ts
git commit -m "feat(qeo-141): add canonical equity and drawdown primitives"
```

---

### Task 3: Closed Trade, explicit stop-out and period guardrail evidence

**Files:**
- Create: `modules/portfolio/risk-engine/trade-outcomes.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-guardrail-evidence.test.ts`

**Interfaces:**
- Produces:
  - `deriveGuardrailTradeOutcomes(input)`
  - `evaluateRollingTradeLoss(outcomes, tradeCount)`
  - `evaluateHolidayPeriodRule(input)`
  - `countConsecutiveExplicitStopOuts(outcomes)`

- [ ] **Step 1: Write RED tests**

Use logical Trade fixtures with multi-fill closes and explicit QEO-140 link rows. Assert:

```ts
test("only explicit stop↔exit evidence counts as stop-out", () => {
  const outcomes = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks })
  assert.equal(outcomes.find((row) => row.tradeId === "explicit-loss")?.explicitStopOut, true)
  assert.equal(outcomes.find((row) => row.tradeId === "plain-loss")?.explicitStopOut, false)
})

test("rolling N Trade loss triggers only with N eligible Trades and negative aggregate PnL", () => {
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 1 }], 2).status, "triggered")
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }], 2).status, "insufficient")
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 3 }], 2).status, "clear")
})

test("holiday percentage rule is insufficient without period-start equity", () => {
  const result = evaluateHolidayPeriodRule({ period: "weekly", rule: { enabled: true, lossPercent: 5 }, outcomes: [], periodStartEquityVnd: null })
  assert.equal(result.status, "insufficient")
})
```

Also assert one scale-out campaign counts once and ordering is by `closed_at`, then Trade id.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-guardrail-evidence.test.ts
```

Expected: FAIL because `trade-outcomes.ts` does not exist.

- [ ] **Step 3: Implement evidence primitives**

Reuse `deriveTradeCloseReview()` rather than reimplementing closed-Trade P&L. A Trade is explicit stop-out only when at least one linked sell fill appears in `stopExitFillLinks` for one of that Trade's stop events. Period grouping is `Asia/Ho_Chi_Minh` and fields not configured are ignored.

- [ ] **Step 4: Run GREEN + QEO-140 regression**

```bash
node --test tests/portfolio/qeo141-guardrail-evidence.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-engine/trade-outcomes.ts modules/portfolio/risk-engine/types.ts tests/portfolio/qeo141-guardrail-evidence.test.ts
git commit -m "feat(qeo-141): derive deterministic guardrail evidence"
```

---

### Task 4: Explainable Risk State and effective reduced-risk default

**Files:**
- Create: `modules/portfolio/risk-engine/risk-state.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-risk-state.test.ts`

**Interfaces:**
- Produces:
  - `derivePortfolioRiskState(input): PortfolioRiskStateResult`
  - typed `RiskRuleEvidence`

- [ ] **Step 1: Write RED state tests**

Assert precedence and recovery:

```ts
test("known PAUSE beats REDUCE and incomplete evidence", () => {
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: 0.5,
    rules: [
      { ruleId: "drawdown_pause", severity: "pause", status: "triggered", configuredThreshold: 15, observedValue: 16, reason: "...", source: "money_management_plan" },
      { ruleId: "active_risk_cap", severity: "reduce", status: "triggered", configuredThreshold: 6, observedValue: 7, reason: "...", source: "money_management_plan" },
      { ruleId: "rolling_loss", severity: "pause", status: "insufficient", configuredThreshold: 25, observedValue: null, reason: "...", source: "canonical_closed_trades" },
    ],
  })
  assert.equal(result.state, "PAUSE_AND_REVIEW")
})

test("REDUCE applies factor only when a valid factor exists", () => {
  const result = derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: 0.75, rules: [reduceTrigger] })
  assert.equal(result.state, "REDUCE_RISK")
  assert.equal(result.effectiveDefaultTradeRiskPercent, 1.5)
})

test("insufficient required evidence yields UNKNOWN when no stronger trigger exists", () => {
  assert.equal(derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: null, rules: [insufficientRule] }).state, "UNKNOWN")
})

test("state recovers to NORMAL without hidden sticky state", () => {
  assert.equal(derivePortfolioRiskState({ configuredDefaultTradeRiskPercent: 2, reductionFactor: 0.75, rules: [clearRule] }).state, "NORMAL")
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-state.test.ts
```

- [ ] **Step 3: Implement deterministic state reducer**

Implementation order is exact:

```ts
const pause = rules.filter((r) => r.severity === "pause" && r.status === "triggered")
const reduce = rules.filter((r) => r.severity === "reduce" && r.status === "triggered")
const insufficient = rules.filter((r) => r.status === "insufficient")

const state = pause.length > 0
  ? "PAUSE_AND_REVIEW"
  : reduce.length > 0
    ? "REDUCE_RISK"
    : insufficient.length > 0
      ? "UNKNOWN"
      : "NORMAL"
```

Only a valid `(0,1)` factor under `REDUCE_RISK` changes the effective default. No factor is invented for cap-only reduction.

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

### Task 5: Authenticated portfolio risk server boundary and API

**Files:**
- Create: `modules/portfolio/risk-engine/server.ts`
- Create: `app/api/portfolio/[id]/risk/route.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Test: `tests/portfolio/qeo141-risk-server-api.test.ts`

**Interfaces:**
- Produces `getPortfolioRiskContext(context, portfolioId, now?)` and GET `/api/portfolio/[id]/risk`.
- Server response sections: `account`, `activeRisk`, `drawdown`, `riskState`, `evidence`.

- [ ] **Step 1: Write RED server/API contract**

The test reads source boundaries and/or mocks Supabase using existing repo patterns. Assert:

```ts
assert.match(serverSource, /getPortfolioRiskContext/)
assert.match(serverSource, /portfolio_transactions/)
assert.match(serverSource, /portfolio_trades/)
assert.match(serverSource, /portfolio_trade_stop_events/)
assert.match(serverSource, /portfolio_trade_stop_exit_fills/)
assert.match(serverSource, /market_ohlcv_raw_daily/)
assert.match(routeSource, /requireApiUser|requireApiFeature/)
assert.match(routeSource, /getPortfolioRiskContext/)
assert.doesNotMatch(routeSource, /\.from\(/)
```

Behavioral mock asserts missing current price produces incomplete account/drawdown rather than AVCO fallback.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-server-api.test.ts
```

- [ ] **Step 3: Implement server adapter**

Load user/portfolio scoped portfolio metadata, all transactions, relevant open/closed Trades, stop events, link evidence and current Money Management Plan. Build ticker set from canonical open positions. For current marks use existing server-side intraday service; for historical marks query `market_ohlcv_raw_daily` from first transaction date to current date for required tickers.

Do not query RAW Daily once per ticker/session. Fetch the portfolio ticker/date range once and build an in-memory `Record<session, Record<ticker, close>>`.

The endpoint is a thin wrapper:

```ts
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params
  const risk = await getPortfolioRiskContext(auth.context, id)
  return NextResponse.json({ ok: true, risk }, { headers: NO_STORE_HEADERS })
}
```

- [ ] **Step 4: Run GREEN + auth/accounting regressions**

```bash
node --test tests/portfolio/qeo141-risk-server-api.test.ts tests/portfolio-pnl.test.ts tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-engine app/api/portfolio/[id]/risk tests/portfolio/qeo141-risk-server-api.test.ts
git commit -m "feat(qeo-141): expose authenticated portfolio risk context"
```

---

### Task 6: Reconcile QEO-139 planning/sizing with the canonical engine

**Files:**
- Modify: `modules/portfolio/risk-sizing/server.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Modify: `modules/portfolio/risk-sizing/projection.ts`
- Modify: `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- Test: `tests/portfolio/qeo141-qeo139-reconciliation.test.ts`
- Test existing: `tests/portfolio/qeo139-risk-projection.test.ts`
- Test existing: `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`
- Test existing: `tests/portfolio/qeo139-planned-trade-simulation.test.ts`

**Interfaces:**
- QEO-139 consumes `getPortfolioRiskContext()` outputs rather than recomputing Active Risk from its own DB queries.
- Risk sizing context exposes both `configuredDefaultTradeRiskPercent` and `effectiveDefaultTradeRiskPercent`, plus canonical risk state/reasons.

- [ ] **Step 1: Write RED reconciliation test**

```ts
test("QEO-139 projected known Active Risk starts from the exact QEO-141 subtotal", () => {
  const current = { knownActiveRiskVnd: 12_000_000, unknownRiskItemCount: 0, accountEquityVnd: 500_000_000, maxActiveRiskPercent: 6 }
  const result = projectActiveRisk({
    knownActiveRiskVnd: current.knownActiveRiskVnd,
    accountEquityVnd: current.accountEquityVnd,
    maxActiveRiskPercent: current.maxActiveRiskPercent,
    unknownRiskTradeCount: current.unknownRiskItemCount,
    riskState: "normal",
  }, 5_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 17_000_000)
})

test("reduce-risk state supplies reduced default without mutating configured plan risk", () => {
  assert.equal(context.configuredDefaultTradeRiskPercent, 2)
  assert.equal(context.effectiveDefaultTradeRiskPercent, 1.5)
})
```

Static contract also asserts `risk-sizing/server.ts` imports `getPortfolioRiskContext` and no longer imports its old active-risk implementation.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-qeo139-reconciliation.test.ts
```

- [ ] **Step 3: Implement canonical mapping**

`getRiskSizingContext()` calls `getPortfolioRiskContext()` once and maps canonical fields. Preserve Win Ratio/Payoff Ratio evidence from QEO-138 overview if they are not already part of the risk-engine response; avoid a second Active Risk DB read.

`projectActiveRisk()` keeps unknown coverage fail-closed. A negative remaining budget remains visible in the canonical portfolio engine; if QEO-139 legacy UI expects a display-clamped budget, expose both raw and display value rather than silently changing canonical arithmetic.

- [ ] **Step 4: Run GREEN QEO-139 suite**

```bash
node --test tests/portfolio/qeo141-qeo139-reconciliation.test.ts tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-sizing components/portfolio/risk-sizing tests/portfolio/qeo141-qeo139-reconciliation.test.ts
git commit -m "refactor(qeo-141): make risk sizing consume canonical portfolio risk"
```

---

### Task 7: Tài sản UI, terminology, workflow and final acceptance gates

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
- UI fetches only `/api/portfolio/${portfolioId}/risk`; it does not reconstruct risk client-side.
- Primary labels Vietnamese; tooltip includes canonical English term and calculation/limitation.

- [ ] **Step 1: Write RED UI contract**

Assert source contains Vietnamese primary labels and canonical English tooltip metadata for:

```text
Account Equity → Vốn chủ tài khoản
Active Risk → Rủi ro đang hoạt động
Active Risk % → Tỷ lệ rủi ro đang hoạt động
Max Active Risk → Rủi ro hoạt động tối đa
Remaining Risk Budget → Ngân sách rủi ro còn lại
Initial Risk → Rủi ro ban đầu
Current Stop → Dừng lỗ hiện tại
Drawdown → Mức sụt giảm
Risk State → Trạng thái rủi ro
```

Assert missing-stop copy includes `Rủi ro chưa xác định` and tooltip includes `Risk Unknown`. Assert the dashboard renders exact risk-state reasons returned by the API rather than inventing client rules.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo141-risk-ui.test.ts
```

- [ ] **Step 3: Implement UI without theme redesign**

Place the risk dashboard inside the existing `Tài sản` tab above/alongside the positions table using existing rounded-card vocabulary. Add risk columns to positions only where desktop space permits; mobile keeps expandable/stacked details.

The hook state is portfolio-scoped to avoid stale switch rendering, mirroring current transaction scoping:

```ts
type PortfolioRiskState = { portfolioId: string | null; risk: PortfolioRiskReadModel | null }
```

On fetch failure, visible unavailable controls/messages use the existing planner unavailable policy only for genuinely unavailable actions; working read-only metrics display explicit unavailable/incomplete states rather than `alert()`.

- [ ] **Step 4: Add canonical test manifest entries**

Add QEO-141 tests to `tests/test-contracts.json`, owner `portfolio`, bucket `canonical`, suite `fast` (UI test also `ui-contracts`). Preserve existing entries byte-for-byte except insertion of new entries.

- [ ] **Step 5: Add QEO-141 workflow**

Create `.github/workflows/qeo141-preprod.yml` with PR path filters for:

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

Run, in order:

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

- [ ] **Step 6: Run final local/exact-head gates**

Expected: every command above PASS. In CI, also require existing QEO-137/QEO-138/QEO-139 and Verify workflows triggered by touched paths to conclude SUCCESS on the exact final head.

- [ ] **Step 7: Review diff for forbidden scope**

Confirm no migration file, no `portfolio_transactions` accounting rewrite, no duplicated Active Risk formula under `risk-sizing`, and no QEO-142 scorecard/ledger implementation.

- [ ] **Step 8: Commit**

```bash
git add components/portfolio app/api/portfolio tests/portfolio tests/test-contracts.json .github/workflows/qeo141-preprod.yml
git commit -m "feat(qeo-141): surface canonical portfolio risk in assets"
```

- [ ] **Step 9: PR/production acceptance**

Open/update one PR for QEO-141. Mark ready only after fresh exact-head GREEN. Squash merge with expected head SHA. Verify the Git-integrated Vercel production deployment is READY on the merge SHA, canonical `/portfolio` returns 200, and there are no new runtime errors. Authenticated UI interaction must only be claimed if actually observed with an authenticated session.
