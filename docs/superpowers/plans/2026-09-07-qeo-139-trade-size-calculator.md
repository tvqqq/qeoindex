# QEO-139 Trade Size Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy fixed-stop-percentage sizing path with a deterministic stop-first `Trade Size` calculator that consumes QEO-138 Money Management Plan context, preserves QEO-137 Trade/Fill provenance, and exposes conservative projected Active Risk without fabricating unknown stop risk.

**Architecture:** Add a pure `modules/portfolio/risk-sizing/*` domain boundary for units, sizing, projection, Optimal f and terminology. Add one authenticated read-only sizing-context API for current plan/evidence/open-Trade risk context. Keep React as a thin UI adapter and preserve the existing `/portfolio` visual language. QEO-139 does not persist calculator state and does not absorb QEO-141 drawdown/streak guardrails.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Supabase/Postgres + RLS, existing AVCO portfolio engine, Node test runner, pnpm 10.28, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-qeo-139-trade-size-calculator-design.md` plus normative corrections in `docs/superpowers/specs/2026-09-07-qeo-139-trade-size-calculator-self-review.md`.

## Global Constraints

- QEO-131 is the source authority. Primary metric labels use canonical English; Vietnamese is tooltip/help copy.
- Source-exact formula remains visible and tested: `Risk Amount = Account Size × Risk %`; `Trade Size = (Risk Amount − Commission) / Difference Between Entry and Stop`.
- Production calculation may subtract explicit `Slippage Allowance`, but it must be identified as a QeoIndex safety extension rather than a verbatim printed McDowell formula.
- User-facing canonical term is `Trade Size`, not `Position Size`. `Initial Stop` and `Risk per Share` are compact aliases only.
- `Account Equity` is a QeoIndex product term. Default value is `Initial Capital + Total Realized P&L + Total Unrealized P&L`, using portfolio-level AVCO `totalRealizedPnl`; do not derive realized P&L only from currently open positions.
- Prices and fees from the existing accounting engine are kVND. Calculator monetary boundary is full VND. All `×1000` conversions belong in `units.ts`, not scattered through components.
- Missing current prices make Account Equity provenance `portfolio_partial`; never claim full mark-to-market evidence when a ticker price is missing.
- Default risk precedence is current Money Management Plan, otherwise a disclosed `2%` onboarding starting ceiling/example. Never auto-suggest above 2%.
- `Risk per Trade > 2%` requires explicit advanced acknowledgement.
- Initial Stop is user/system evidence. Never derive it from a fixed default percentage.
- `DEFAULT_REGULAR_LOT_SHARES = 100` is an injectable QeoIndex product convention, not a McDowell formula or universal venue rule.
- Missing current stop on any open logical Trade means `Risk Unknown`, never zero.
- QEO-139 may calculate only the minimal current/projected Active Risk context needed by the calculator. Full risk state, drawdown, streak and holiday guardrails remain QEO-141.
- Calculator warnings never block recording an already-executed transaction.
- Optimal f is informational only and never modifies risk or size automatically.
- Existing AVCO accounting outputs must remain unchanged.
- QEO-139 requires no production database migration.

---

### Task 1: Pure units, Account Equity context and stop-first Trade Size calculation

**Files:**
- Create: `tests/portfolio/qeo139-risk-sizing.test.ts`
- Create: `modules/portfolio/risk-sizing/types.ts`
- Create: `modules/portfolio/risk-sizing/units.ts`
- Create: `modules/portfolio/risk-sizing/validation.ts`
- Create: `modules/portfolio/risk-sizing/calculator.ts`
- Create: `modules/portfolio/risk-sizing/README.md`

**Interfaces:**

```ts
export const DEFAULT_REGULAR_LOT_SHARES = 100

export type AccountEquityContext = {
  valueVnd: number
  source: "portfolio_mark_to_market" | "portfolio_partial" | "manual"
  missingPriceTickers: string[]
}

export type TradeSizeInput = {
  side: "long"
  accountEquityVnd: number
  riskPercent: number
  plannedEntryKvnd: number | null
  initialStopKvnd: number | null
  estimatedCommissionVnd: number
  slippageAllowanceVnd: number
  lotSizeShares: number
  advancedRiskOverrideAcknowledged: boolean
}

export type TradeSizeStatus =
  | "ready"
  | "incomplete"
  | "invalid_account_equity"
  | "invalid_risk_percent"
  | "advanced_override_required"
  | "invalid_entry"
  | "invalid_stop_direction"
  | "zero_stop_distance"
  | "invalid_cost"
  | "costs_consume_risk_budget"
  | "below_regular_lot"
```

- [ ] **Step 1: Write failing source-exact and extended-formula tests**

Create tests that import modules which do not yet exist and assert:

```ts
const riskAmount = calculateRiskAmountVnd(500_000_000, 2)
assert.equal(riskAmount, 10_000_000)

const book = calculateBookTradeSize({
  riskAmountVnd: 10_000_000,
  commissionVnd: 500_000,
  riskPerShareVnd: 5_000,
})
assert.equal(book, 1900)

const extended = calculateTradeSize({
  side: "long",
  accountEquityVnd: 500_000_000,
  riskPercent: 2,
  plannedEntryKvnd: 100,
  initialStopKvnd: 95,
  estimatedCommissionVnd: 500_000,
  slippageAllowanceVnd: 500_000,
  lotSizeShares: 100,
  advancedRiskOverrideAcknowledged: false,
})
assert.equal(extended.status, "ready")
assert.equal(extended.tradeSizeShares, 1800)
assert.ok(extended.totalRiskConsumptionVnd <= extended.riskAmountVnd)
```

The book helper deliberately models the printed formula without a separate slippage term. The production helper models the extension.

- [ ] **Step 2: Add failing behavior/validation tests**

Cover all of these before implementation:

```ts
// wider stop => smaller size
// narrower stop => larger size
// missing stop => incomplete
// stop === entry => zero_stop_distance
// stop > entry on long => invalid_stop_direction
// account equity <= 0 => invalid_account_equity
// risk <= 0 => invalid_risk_percent
// risk > 2 with no ack => advanced_override_required
// risk > 2 with ack => may calculate
// negative commission/slippage => invalid_cost
// commission + slippage >= Risk Amount => costs_consume_risk_budget
// raw safe shares < lot => below_regular_lot with Trade Size 0
// injected lotSizeShares=10 rounds to 10-share lots
// default constant is exactly 100
```

- [ ] **Step 3: Add failing Account Equity provenance tests**

Use AVCO-style kVND values and prove full-VND conversion centrally:

```ts
const context = buildAccountEquityContext({
  initialCapitalVnd: 500_000_000,
  totalRealizedPnlKvnd: 10_000,
  positions: [{ ticker: "FPT", openQty: 1000, avgCost: 100 }],
  currentPricesKvnd: { FPT: 110 },
})
assert.equal(context.valueVnd, 520_000_000)
assert.equal(context.source, "portfolio_mark_to_market")
```

Add a missing-price case that lists the missing ticker and returns `portfolio_partial`. The fallback calculation may use AVCO cost for continuity, but provenance must remain partial.

- [ ] **Step 4: Run RED**

```bash
node --test tests/portfolio/qeo139-risk-sizing.test.ts
```

Expected: FAIL because `modules/portfolio/risk-sizing/*` does not exist.

- [ ] **Step 5: Implement only the pure domain needed for GREEN**

`units.ts` owns conversions:

```ts
export const KVND_TO_VND = 1000
export const kvndToVnd = (value: number) => value * KVND_TO_VND
export const vndToKvnd = (value: number) => value / KVND_TO_VND
```

`calculator.ts` uses:

```ts
const riskAmountVnd = accountEquityVnd * riskPercent / 100
const riskPerShareVnd = kvndToVnd(plannedEntryKvnd - initialStopKvnd)
const availableRiskBudgetVnd = riskAmountVnd - estimatedCommissionVnd - slippageAllowanceVnd
const rawTradeSizeShares = availableRiskBudgetVnd / riskPerShareVnd
const tradeSizeShares = Math.floor(rawTradeSizeShares / lotSizeShares) * lotSizeShares
const positionValueVnd = tradeSizeShares * kvndToVnd(plannedEntryKvnd)
```

Return structured values even for non-ready states where safe, but never negative quantity or an implied valid result.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo139-risk-sizing.test.ts
node --test tests/portfolio-pnl.test.ts
```

Expected: QEO-139 domain tests pass and AVCO regression stays green.

- [ ] **Step 7: Commit**

```bash
git add tests/portfolio/qeo139-risk-sizing.test.ts modules/portfolio/risk-sizing
git commit -m "feat(qeo-139): add deterministic Trade Size domain"
```

---

### Task 2: Projected Active Risk, Optimal f and shared terminology metadata

**Files:**
- Create: `tests/portfolio/qeo139-risk-projection.test.ts`
- Create: `modules/portfolio/risk-sizing/projection.ts`
- Create: `modules/portfolio/risk-sizing/optimal-f.ts`
- Create: `modules/portfolio/risk-sizing/terminology.ts`
- Modify: `modules/portfolio/risk-sizing/types.ts`

**Interfaces:**

```ts
export type CurrentActiveRiskContext = {
  knownActiveRiskVnd: number
  accountEquityVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  riskState?: "normal" | "reduce_risk" | "pause_and_review" | "unknown"
}

export function projectActiveRisk(
  context: CurrentActiveRiskContext,
  plannedTradeRiskVnd: number,
): ProjectedRiskResult

export function calculateOptimalF(
  winRatioPercent: number | null,
  payoffRatio: number | null,
): { value: number | null; status: "available" | "insufficient_history" | "invalid" }
```

- [ ] **Step 1: Write failing projection tests**

Cover:

```ts
// known risk below cap + planned risk remains below cap => within_plan
// projected known risk exceeds cap => exceeds_plan
// unknownRiskTradeCount > 0 => risk_unknown, never within_plan
// no configured max cap => no within_plan claim
// riskState reduce_risk/pause_and_review => review_required
// remaining budget floors at 0 for display but breach remains explicit
```

Assert `knownActiveRiskVnd=0` plus `unknownRiskTradeCount=1` remains unknown rather than zero-risk.

- [ ] **Step 2: Write failing Optimal f tests**

```ts
const result = calculateOptimalF(60, 2)
assert.equal(result.status, "available")
assert.ok(Math.abs((result.value ?? 0) - 0.4) < 1e-12)

assert.equal(calculateOptimalF(null, 2).status, "insufficient_history")
assert.equal(calculateOptimalF(60, null).status, "insufficient_history")
assert.equal(calculateOptimalF(60, 0).status, "invalid")
```

- [ ] **Step 3: Write terminology metadata tests**

`terminology.ts` must expose one shared object used by UI and tests. Assert entries exist for:

```text
Account Equity
Risk per Trade
Risk Amount
Planned Entry
Initial Stop
Risk per Share
Estimated Commission
Slippage Allowance
Trade Size
Position Value
Active Risk
Max Active Risk
Remaining Risk Budget
```

Each entry contains `label`, Vietnamese `help`, and `sourceKind: "book" | "product" | "extension"`. Formula-bearing entries reference shared formula text constants. `Slippage Allowance` must be `extension`; `Account Equity` and Active Risk terms must be `product`.

- [ ] **Step 4: Run RED**

```bash
node --test tests/portfolio/qeo139-risk-projection.test.ts
```

- [ ] **Step 5: Implement projection, Optimal f and terminology GREEN**

Use exact Optimal f formula:

```ts
const p = winRatioPercent / 100
const f = (((payoffRatio + 1) * p) - 1) / payoffRatio
```

Do not clamp the mathematical result into a recommended risk percentage. UI decides only whether to display it as informational.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo139-risk-projection.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add tests/portfolio/qeo139-risk-projection.test.ts modules/portfolio/risk-sizing
git commit -m "feat(qeo-139): add risk projection and sizing terminology"
```

---

### Task 3: Read-only authenticated risk-sizing context from QEO-137/QEO-138 data

**Files:**
- Create: `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`
- Create: `modules/portfolio/risk-sizing/server.ts`
- Create: `app/api/portfolio/[id]/risk-sizing/route.ts`

**Interfaces:**

```ts
export type RiskSizingServerContext = {
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

export async function getRiskSizingContext(
  context: ServerAuthContext,
  portfolioId: string,
): Promise<RiskSizingServerContext>
```

- [ ] **Step 1: Write failing server/API boundary contract**

Tests must prove:

```ts
assert.match(server, /export async function getRiskSizingContext/)
assert.match(route, /requireApiUser/)
assert.match(route, /getRiskSizingContext/)
assert.doesNotMatch(route, /\.from\(/)
```

Also assert the API is GET-only/read-only and returns `Cache-Control: no-store`.

- [ ] **Step 2: Write failing risk-context semantic tests**

Build lightweight fake Supabase/context fixtures or pure helper fixtures proving:

- current MM Plan supplies `default_trade_risk_percent` and `max_active_risk_percent`;
- no plan gives `2` and `riskSource="onboarding_default"`;
- open Trade with linked fills + known latest stop contributes deterministic known downside risk;
- trailing/current stop above average entry contributes zero downside Trade Risk, not negative risk;
- open Trade with missing stop increments `unknownRiskTradeCount` and contributes no fabricated known amount;
- open Trade with no sufficient linked fill history is unknown;
- legacy ungrouped transactions are not guessed into logical Trades;
- Win Ratio/Payoff Ratio reuse QEO-138 canonical evidence, not raw fill counts.

- [ ] **Step 3: Run RED**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts
```

Expected: FAIL because the read boundary and route do not exist.

- [ ] **Step 4: Implement minimal risk-context loader**

Use existing ownership pattern and QEO-137 read model:

```ts
const readModel = buildTradeReadModel({ trade, fills, stopEvents, journalEntries: [] })
```

For each open/partially-closed logical Trade:

1. Use linked accounting fills only.
2. Use AVCO on the Trade's linked fills to derive current remaining quantity and average cost.
3. Use `readModel.latestStop`; never legacy transaction stop fields as fabricated Trade stop evidence.
4. If quantity/fill state or stop is missing, increment unknown count.
5. Known downside risk for the long path is:

```ts
Math.max(0, avgCostKvnd - latestStopKvnd) * remainingShares * 1000
```

Do not include full QEO-141 drawdown/holiday state here.

- [ ] **Step 5: Implement thin GET route**

Follow existing API conventions:

```ts
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
```

Authenticate via `requireApiUser()`, delegate to `getRiskSizingContext`, return no-store JSON, and map invalid/not-found errors without exposing database internals.

- [ ] **Step 6: Run GREEN and QEO-137/QEO-138 regressions**

```bash
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add tests/portfolio/qeo139-risk-sizing-server-api.test.ts modules/portfolio/risk-sizing/server.ts app/api/portfolio/[id]/risk-sizing/route.ts
git commit -m "feat(qeo-139): add authenticated risk sizing context"
```

---

### Task 4: Fix portfolio-level Account Equity integration without changing AVCO accounting

**Files:**
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `tests/portfolio-pnl.test.ts`
- Extend: `tests/portfolio/qeo139-risk-sizing.test.ts`

**Interfaces:**
- `PortfolioPage` keeps the complete `PortfolioSummary` instead of discarding portfolio-level `totalRealizedPnl`.
- `PortfolioCapitalAllocation` receives enough raw portfolio data to call the pure Account Equity builder.

- [ ] **Step 1: Add a failing regression for fully closed realized P&L**

Extend the QEO-139 sizing test with a scenario where one ticker is fully closed and another remains open. Assert Account Equity includes realized P&L from the fully closed ticker via `PortfolioSummary.totalRealizedPnl`.

Do not assert by summing `positions[].realizedPnl`.

- [ ] **Step 2: Refactor `PortfolioPage` to retain the summary**

Replace:

```ts
const { positions } = useMemo(() => computePortfolioPositions(transactions), [transactions])
```

with:

```ts
const portfolioSummary = useMemo(() => computePortfolioPositions(transactions), [transactions])
const { positions, totalRealizedPnl } = portfolioSummary
```

Pass `totalRealizedPnl` and current prices into the allocation/calculator boundary. Keep AVCO engine unchanged.

- [ ] **Step 3: Remove component-local current-equity math that drops closed P&L**

`portfolio-capital-allocation.tsx` must no longer do:

```ts
positions.reduce((sum, position) => sum + position.realizedPnl * 1000, 0)
```

Use `buildAccountEquityContext` instead. Component may format results but not duplicate conversion/formula logic.

- [ ] **Step 4: Run regressions**

```bash
node --test tests/portfolio/qeo139-risk-sizing.test.ts
node --test tests/portfolio-pnl.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add components/portfolio/portfolio-page.tsx components/portfolio/portfolio-capital-allocation.tsx tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio-pnl.test.ts
git commit -m "refactor(qeo-139): use portfolio-level Account Equity context"
```

---

### Task 5: Replace legacy fixed-7%-stop UI with canonical Trade Size calculator

**Files:**
- Create: `tests/portfolio/qeo139-trade-size-ui.test.ts`
- Create: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Create: `components/portfolio/risk-sizing/risk-metric-tooltip.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`

**Interfaces:**
- UI reads `/api/portfolio/${portfolioId}/risk-sizing`.
- UI invokes `calculateTradeSize()` and `projectActiveRisk()` locally as pure deterministic functions.
- UI does not call Supabase.

- [ ] **Step 1: Write failing UI contract tests**

Assert source contains all canonical labels:

```text
Account Equity
Risk per Trade
Risk Amount
Planned Entry
Initial Stop
Risk per Share
Estimated Commission
Slippage Allowance
Trade Size
Position Value
Active Risk
Max Active Risk
Remaining Risk Budget
```

Assert:

```ts
assert.doesNotMatch(source, /triệt tiêu hoàn toàn nguy cơ/i)
assert.doesNotMatch(source, /dealStopLossPct|7\.0.*Stoploss/i)
assert.doesNotMatch(source, /createClient|supabase\.|\.from\(/)
assert.match(source, /\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing/)
assert.match(source, /RiskMetricTooltip/)
```

Also assert the calculator surface is keyed/remounted by `activePortfolioId` so draft Entry/Stop/risk overrides cannot leak across portfolios.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: FAIL because legacy UI still uses fixed stop percentage and old copy.

- [ ] **Step 3: Implement `RiskMetricTooltip` from shared terminology metadata**

Reuse the existing Base UI tooltip primitives so desktop hover/focus and mobile tap work. API:

```tsx
<RiskMetricTooltip term="tradeSize" />
```

The component resolves label/help from `RISK_SIZING_TERMS`; it must not carry duplicated formula strings.

- [ ] **Step 4: Implement stop-first inputs with no hidden defaults**

Initial state:

```ts
Account Equity: portfolio-derived context
Risk per Trade: current MM Plan or 2%
Planned Entry: ""
Initial Stop: ""
Estimated Commission: "0"
Slippage Allowance: "0"
Target: "" // optional
Advanced acknowledgement: false
```

Do not restore the old `25.0` entry or `7%` stop defaults.

Show risk provenance badge:

```text
Money Management Plan | Onboarding default | Manual override
```

If user edits Account Equity, mark provenance `manual`. If current price coverage is partial, show missing ticker warning and allow explicit manual equity.

- [ ] **Step 5: Render deterministic results and states**

For ready state show:

- Risk Amount
- derived Stop Distance absolute + %
- Risk per Share
- Available Risk Budget after costs
- Trade Size
- Position Value
- planned total risk consumption

For non-ready states render specific help instead of zero-looking fake results. `below_regular_lot` explicitly says no valid regular-lot Trade Size under the selected risk budget.

- [ ] **Step 6: Add stop guidance and corrected risk copy**

Guidance must mention structural support/resistance, volatility/price activity, trading-system rule, and that trailing stops apply after entry. It must state actual loss may exceed planned stop due to gap, liquidity, volatility, overnight moves and slippage.

- [ ] **Step 7: Render projected portfolio-risk panel**

Use API context plus `projectActiveRisk()` to display:

```text
Active Risk
Max Active Risk
Remaining Risk Budget
Risk Added by Planned Trade
Projected Active Risk
```

If unknown Trade risk exists, display `Risk Unknown` prominently and never label the portfolio `within plan`.

- [ ] **Step 8: Run GREEN**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
node --test tests/portfolio/qeo139-risk-sizing.test.ts tests/portfolio/qeo139-risk-projection.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add tests/portfolio/qeo139-trade-size-ui.test.ts components/portfolio/risk-sizing components/portfolio/portfolio-capital-allocation.tsx components/portfolio/portfolio-page.tsx
git commit -m "feat(qeo-139): rebuild allocation UI around stop-first Trade Size"
```

---

### Task 6: Advanced deterministic evidence and informational Optimal f

**Files:**
- Modify: `components/portfolio/risk-sizing/trade-size-calculator.tsx`
- Extend: `tests/portfolio/qeo139-trade-size-ui.test.ts`
- Extend: `tests/portfolio/qeo139-risk-projection.test.ts`

- [ ] **Step 1: Add failing Advanced-section UI tests**

Assert a collapsed/details surface contains:

```text
Win Ratio
Payoff Ratio
Optimal f
Insufficient History
```

Assert copy explicitly says Optimal f is informational, more aggressive, not auto-applied, and not a zero-ROR guarantee. Assert no generalized `Risk of Ruin probability` table or fabricated probability matrix appears.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
```

- [ ] **Step 3: Implement Advanced section**

Use values returned by the authenticated sizing context. Call `calculateOptimalF()` only when evidence is valid. Do not mutate `Risk per Trade`, Trade Size, or Money Management Plan from Optimal f.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-projection.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add components/portfolio/risk-sizing/trade-size-calculator.tsx tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-risk-projection.test.ts
git commit -m "feat(qeo-139): add informational Optimal f evidence"
```

---

### Task 7: Remove legacy fixed-fractional sizing helper and register canonical tests

**Files:**
- Modify: `modules/portfolio/pnl.ts`
- Modify: `tests/portfolio-pnl.test.ts`
- Modify: `tests/test-contracts.json`
- Create: `.github/workflows/qeo139-preprod.yml`

- [ ] **Step 1: Add a failing legacy-removal contract**

Extend `qeo139-trade-size-ui.test.ts` or domain test to assert production source no longer exports or calls:

```text
calculatePositionSizing
Fixed Fractional Account Risk
% Cắt lỗ deal tiếp theo
```

- [ ] **Step 2: Remove `calculatePositionSizing` from `pnl.ts`**

Delete only the obsolete sizing helper. Preserve AVCO types/functions and accounting tests.

Remove the legacy fixed-fractional sizing test/import from `tests/portfolio-pnl.test.ts`; the new QEO-139 domain suite is now the sizing authority.

- [ ] **Step 3: Register new tests in `tests/test-contracts.json`**

Add canonical entries:

```json
{
  "path": "tests/portfolio/qeo139-risk-sizing.test.ts",
  "owner": "portfolio-risk",
  "invariant": "QEO-139 keeps stop-first Trade Size sizing deterministic, unit-safe, cost-aware and source-faithful.",
  "bucket": "canonical",
  "suites": ["fast"]
}
```

Register projection/server tests in `fast`; UI contract in `fast` + `ui-contracts`. Do not mark them deep-safety because QEO-139 has no schema migration.

- [ ] **Step 4: Create focused QEO-139 workflow**

Use path filters for:

```yaml
- "modules/portfolio/risk-sizing/**"
- "modules/portfolio/pnl.ts"
- "components/portfolio/**"
- "app/api/portfolio/**"
- "tests/portfolio/qeo139-*.test.ts"
- "tests/portfolio-pnl.test.ts"
- "tests/test-contracts.json"
- ".github/workflows/qeo139-preprod.yml"
```

The workflow runs:

```bash
node --test tests/portfolio/qeo139-risk-sizing.test.ts
node --test tests/portfolio/qeo139-risk-projection.test.ts
node --test tests/portfolio/qeo139-risk-sizing-server-api.test.ts
node --test tests/portfolio/qeo139-trade-size-ui.test.ts
node --test tests/portfolio-pnl.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
pnpm lint:touched
pnpm typecheck
pnpm exec next build
```

- [ ] **Step 5: Run manifest and targeted GREEN**

```bash
pnpm test:manifest
node --test tests/portfolio/qeo139-*.test.ts tests/portfolio-pnl.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/pnl.ts tests/portfolio-pnl.test.ts tests/test-contracts.json .github/workflows/qeo139-preprod.yml tests/portfolio/qeo139-*.test.ts
git commit -m "test(qeo-139): make stop-first sizing the canonical contract"
```

---

### Task 8: Exact-head verification, PR review and production UI smoke readiness

**Files:**
- Update if necessary: `docs/superpowers/plans/2026-09-07-qeo-139-trade-size-calculator.md`
- No production migration files expected.

- [ ] **Step 1: Run all QEO-139 tests on exact head**

```bash
node --test tests/portfolio/qeo139-risk-sizing.test.ts \
  tests/portfolio/qeo139-risk-projection.test.ts \
  tests/portfolio/qeo139-risk-sizing-server-api.test.ts \
  tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run accounting and dependency regressions**

```bash
node --test tests/portfolio-pnl.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo138-risk-plan-server-api.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run repository verification gates**

```bash
pnpm test:manifest
pnpm verify:pr
pnpm typecheck
pnpm exec next build
```

Because QEO-139 adds no DB migration, run drift verification only as a regression check, not a promotion step:

```bash
pnpm db:drift:verify
```

- [ ] **Step 4: Inspect the exact PR diff for source fidelity and scope**

Confirm:

- no fixed 7% stop path remains;
- no certainty/risk-elimination copy remains;
- no fake generalized ROR table exists;
- no production DB schema changed;
- no direct Supabase call appears in client components;
- calculator tooltips resolve from shared terminology metadata;
- Account Equity does not lose fully closed realized P&L;
- partial market prices are visibly partial;
- missing stop risk remains unknown;
- Optimal f is informational only.

- [ ] **Step 5: Request code review and resolve findings**

Use `superpowers:requesting-code-review`; address technically valid findings with targeted tests before changes. Re-run Task 8 Steps 1–3 after every code change.

- [ ] **Step 6: Merge only after exact-head gates are green**

Use `superpowers:finishing-a-development-branch`. Merge into `main` only when PR is mergeable and exact-head QEO-139 + repository verification gates are green.

- [ ] **Step 7: Verify post-merge production deployment before UI smoke test**

After Vercel production is READY on the merged `main` commit, smoke test `/portfolio` → `Phân bổ vốn` with an authenticated session:

1. Confirm Risk per Trade loads from current Money Management Plan when one exists.
2. Confirm no Plan uses disclosed 2% onboarding default.
3. Enter Entry without Stop: Trade Size stays incomplete.
4. Enter valid long Stop: Trade Size appears and is rounded to the displayed regular-lot convention.
5. Increase stop distance: Trade Size decreases.
6. Increase commission/slippage until they consume risk budget: no valid size is returned.
7. Enter risk >2% without acknowledgement: advanced warning prevents a ready sizing result.
8. Confirm Active Risk displays `Risk Unknown` if any open Trade lacks a recorded stop.
9. Confirm tooltip works by hover/focus and mobile tap.
10. Confirm Advanced Optimal f never alters Risk per Trade.
11. Switch portfolio and verify calculator draft/context does not leak.

QEO-139 can move to In Review/Done only after this smoke acceptance and production exact-commit evidence are recorded in Linear.
