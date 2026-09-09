# QEO-159 Deterministic Concentration & Diversification Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, user-plan-driven ticker/sector/open-position concentration checks to the current Portfolio Risk read model and QEO-139 pre-trade planner, with fail-closed `UNKNOWN` semantics and auditable override reasons.

**Architecture:** Keep concentration semantics in a focused pure domain under `modules/portfolio/concentration/`. Reuse QEO-141 Account Equity and per-open-trade Active Risk without recalculating risk, consume only structured canonical sector metadata, nest the current concentration read model into the existing Portfolio Risk response, and reuse QEO-137 planned-Trade/journal APIs for persisted override audit. QEO-139 sizing math remains unchanged; concentration projection is a post-sizing advisory layer.

**Tech Stack:** TypeScript 5.7, Node `node:test`, Next.js 16 App Router, React 19, Supabase/Postgres existing JSONB risk-plan storage, GitHub Actions, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-159-deterministic-concentration-diversification-design.md`

## Global Constraints

- No AI/LLM classification or recommendation.
- No universal ticker/sector/open-position diversification threshold may be silently introduced.
- `concentrationWarningPercent` remains advisory; it is not promoted into a hard breach threshold.
- `maxSectorRiskPercent` means sector Active Risk / current Account Equity, not sector market-value weight.
- Account Equity denominator must reuse QEO-141/QEO-158 current post-external-flow Account Equity.
- Active Risk must reuse QEO-141 `activeRiskVnd`; QEO-159 must not independently recalculate stop risk.
- Missing structured sector metadata is `UNKNOWN`; never call `sectorForTicker()` as classification evidence because its fallback guesses `Công nghiệp & Vật liệu`.
- Partial evidence may prove a hard `BREACH` when the known lower bound already exceeds the threshold; partial evidence must never prove `WITHIN_PLAN` when missing evidence could increase the metric.
- QEO-139 trade-size formula and lot rounding remain unchanged.
- Concentration warnings/breaches are advisory and never block recording an already-executed/historical fill.
- Override reasons are persisted through existing QEO-137 Trade journal `override_reason`; do not create a parallel audit table.
- Expected DB migration: none. `diversification_rules` remains versioned JSONB.

---

## File map

### New concentration domain

- `modules/portfolio/concentration/types.ts` — public current/projected check types, inputs, read model, completeness/provenance.
- `modules/portfolio/concentration/evaluate-current.ts` — pure current portfolio evaluator and status precedence.
- `modules/portfolio/concentration/project-trade.ts` — pure one-trade projection after QEO-139 sizing.
- `modules/portfolio/concentration/sector-metadata.ts` — server-only canonical sector adapter backed by `getCanonicalUniverse()` and explicit missing classification.
- `components/portfolio/concentration/portfolio-concentration-panel.tsx` — current concentration summary rendered inside Tài sản/risk dashboard.
- `components/portfolio/concentration/projected-concentration-panel.tsx` — projected checks next to QEO-139 calculator output.

### Existing files to modify

- `modules/portfolio/risk-plan/types.ts` — add optional plan fields.
- `modules/portfolio/risk-plan/validation.ts` — validate optional hard limits.
- `modules/portfolio/risk-plan/server.ts` — normalize new JSON fields without defaults.
- `components/portfolio/risk-plan/money-management-plan-form.tsx` — user-editable optional limits.
- `modules/portfolio/risk-engine/types.ts` — nest `PortfolioConcentrationReadModel` into canonical risk response.
- `modules/portfolio/risk-engine/server.ts` — compose canonical positions/current prices/QEO-141 Active Risk/current plan/sector metadata into evaluator input.
- `modules/portfolio/risk-sizing/types.ts` — expose current plan ID and canonical sector lookup metadata needed by planning/persistence; do not alter sizing result math.
- `modules/portfolio/risk-sizing/server.ts` — return concentration + canonical sector metadata for planner.
- `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx` — render current concentration panel.
- `components/portfolio/portfolio-capital-allocation.tsx` — pass concentration context into planner.
- `components/portfolio/risk-sizing/trade-size-advisor.tsx` — render projected advisory status and persist a planned Trade/journal override on explicit confirmation.
- `tests/test-contracts.json` — register QEO-159 tests.
- `.github/workflows/qeo159-preprod.yml` — focused read-only QEO-159 gate.

### Tests

- `tests/portfolio/qeo159-concentration-domain.test.ts`
- `tests/portfolio/qeo159-concentration-server.test.ts`
- `tests/portfolio/qeo159-concentration-projection.test.ts`
- `tests/portfolio/qeo159-concentration-ui.test.ts`
- modify `tests/portfolio/qeo138-risk-plan-domain.test.ts`
- modify `tests/portfolio/qeo138-risk-plan-ui.test.ts`
- modify relevant QEO-139/QEO-141 contract tests only where their public read-model contract changes.

---

### Task 1: Extend Money Management Plan diversification JSON contract

**Files:**
- Modify: `modules/portfolio/risk-plan/types.ts`
- Modify: `modules/portfolio/risk-plan/validation.ts`
- Modify: `modules/portfolio/risk-plan/server.ts`
- Modify: `components/portfolio/risk-plan/money-management-plan-form.tsx`
- Modify: `tests/portfolio/qeo138-risk-plan-domain.test.ts`
- Modify: `tests/portfolio/qeo138-risk-plan-ui.test.ts`

**Interfaces:**
- Consumes: existing versioned `portfolio_money_management_plans.diversification_rules` JSONB.
- Produces:

```ts
export type DiversificationRules = {
  enabled: boolean
  concentrationWarningPercent?: number
  maxTickerConcentrationPercent?: number
  maxSectorRiskPercent?: number
  maxConcurrentOpenPositions?: number
}
```

- [ ] **Step 1: Write RED domain tests for new optional fields**

Add cases proving:

```ts
validateMoneyManagementPlan({
  ...basePlan,
  diversificationRules: {
    enabled: true,
    concentrationWarningPercent: 20,
    maxTickerConcentrationPercent: 30,
    maxSectorRiskPercent: 6,
    maxConcurrentOpenPositions: 8,
  },
})
```

passes, while `0`, `>100`, non-finite percentages and non-positive/non-integer concurrent-position counts throw `INVALID_PLAN`. Also prove old `{ enabled: false }` and old plans with only the two legacy optional fields remain valid.

- [ ] **Step 2: Run the focused domain test and verify RED**

Run:

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts
```

Expected: FAIL because the new fields are absent/unvalidated.

- [ ] **Step 3: Implement the type and validation contract**

In `types.ts`, add the two new optional fields. In `validation.ts`, validate:

```ts
if (input.diversificationRules.maxTickerConcentrationPercent != null) {
  assertPercent(input.diversificationRules.maxTickerConcentrationPercent, "Maximum ticker concentration")
}
if (input.diversificationRules.maxConcurrentOpenPositions != null) {
  assertPositiveInteger(input.diversificationRules.maxConcurrentOpenPositions, "Maximum concurrent open positions")
}
```

Do not add defaults and do not require fields when `enabled` is false.

- [ ] **Step 4: Extend request normalization without hidden defaults**

In `normalizeMoneyManagementPlanInput`, copy only present values:

```ts
...(diversificationRules.maxTickerConcentrationPercent != null
  ? { maxTickerConcentrationPercent: finiteNumber(diversificationRules.maxTickerConcentrationPercent, "diversificationRules.maxTickerConcentrationPercent") }
  : {}),
...(diversificationRules.maxConcurrentOpenPositions != null
  ? { maxConcurrentOpenPositions: finiteNumber(diversificationRules.maxConcurrentOpenPositions, "diversificationRules.maxConcurrentOpenPositions") }
  : {}),
```

The existing JSONB RPC payload remains unchanged structurally; no migration/generated DB type update is allowed in this task.

- [ ] **Step 5: Add RED→GREEN UI contract coverage**

Add two explicit optional fields under `Diversification & Risk Capital`:

- `Max Ticker Concentration` — `%`, hard limit, optional.
- `Max Concurrent Open Positions` — integer, hard limit, optional.

Submit only when diversification is enabled and input is non-empty. Keep `Concentration Warning` advisory wording and `Max Sector Risk` wording. Update `qeo138-risk-plan-ui.test.ts` to assert labels/help and JSON key serialization.

- [ ] **Step 6: Run QEO-138 focused tests**

Run:

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio/risk-plan/types.ts modules/portfolio/risk-plan/validation.ts modules/portfolio/risk-plan/server.ts components/portfolio/risk-plan/money-management-plan-form.tsx tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
git commit -m "feat(QEO-159): extend diversification plan limits"
```

---

### Task 2: Build the pure current concentration evaluator

**Files:**
- Create: `modules/portfolio/concentration/types.ts`
- Create: `modules/portfolio/concentration/evaluate-current.ts`
- Create: `tests/portfolio/qeo159-concentration-domain.test.ts`

**Interfaces:**
- Consumes a pure input independent of Supabase/React:

```ts
export type ConcentrationPositionInput = {
  ticker: string
  openQty: number
  currentPriceKvnd: number | null
}

export type ConcentrationRiskInput = {
  tradeId: string
  ticker: string
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
}

export type StructuredSectorEvidence = {
  ticker: string
  sector: string | null
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
}

export type CurrentConcentrationInput = {
  accountEquityVnd: number | null
  positions: ConcentrationPositionInput[]
  activeRiskRows: ConcentrationRiskInput[]
  sectors: StructuredSectorEvidence[]
  rules: DiversificationRules | null
  planVersion: number | null
}
```

- Produces `PortfolioConcentrationReadModel` with `WITHIN_PLAN | WARNING | BREACH | UNKNOWN` checks.

- [ ] **Step 1: Write RED tests for deterministic metrics and status semantics**

Cover these exact behaviors:

```ts
// 40m market value / 100m equity = 40%
assert.equal(topTicker.metricValue, 40)

// known sector risk 7m / 100m equity = 7% > max 6%
assert.equal(sectorCheck.status, "BREACH")

// unknown sector classification never becomes Công nghiệp & Vật liệu
assert.deepEqual(model.unknownClassificationTickers, ["ZZZ"])
assert.equal(unknownSectorCheck.status, "UNKNOWN")

// no configured relevant threshold does not invent safety/breach
assert.equal(noRuleCheck.status, "UNKNOWN")
assert.equal(noRuleCheck.reason, "rule_not_configured")
```

Also cover warning-only ticker rule, hard ticker breach, multiple risk rows aggregated by ticker, distinct ticker position count, and non-positive Account Equity.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define normalized check/read-model types**

In `types.ts`, define:

```ts
export type ConcentrationStatus = "WITHIN_PLAN" | "WARNING" | "BREACH" | "UNKNOWN"
export type ConcentrationCompleteness = "complete" | "partial" | "insufficient"

export type ConcentrationCheck = {
  id: string
  kind: "ticker_market_value" | "ticker_active_risk" | "sector_active_risk" | "open_position_count"
  status: ConcentrationStatus
  metricValue: number | null
  metricUnit: "percent" | "count" | "vnd"
  warningThreshold: number | null
  breachThreshold: number | null
  ticker: string | null
  sector: string | null
  basis: string
  completeness: ConcentrationCompleteness
  provenance: string[]
  reason: string
}
```

Also define `PortfolioConcentrationReadModel` exactly enough to expose summary, ticker market value, ticker Active Risk, sector Active Risk, open-position check, unknown classification tickers, plan version and sector source date.

- [ ] **Step 4: Implement calculation helpers and fail-closed evaluation**

Required formulas:

```ts
marketValueVnd = openQty * currentPriceKvnd * 1_000
marketValuePercent = marketValueVnd / accountEquityVnd * 100
activeRiskPercent = knownActiveRiskVnd / accountEquityVnd * 100
```

Rules:

- hard known lower-bound `>` threshold => `BREACH` even if partial;
- hard rule below threshold + partial evidence => `UNKNOWN`;
- warning-only known complete metric >= warning => `WARNING`;
- no relevant configured threshold => `UNKNOWN/rule_not_configured`;
- disabled/no plan => metrics may exist but no invented plan compliance;
- overall precedence `BREACH > WARNING > UNKNOWN > WITHIN_PLAN`.

- [ ] **Step 5: Run domain tests and verify GREEN**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/concentration/types.ts modules/portfolio/concentration/evaluate-current.ts tests/portfolio/qeo159-concentration-domain.test.ts
git commit -m "feat(QEO-159): add deterministic concentration evaluator"
```

---

### Task 3: Add structured sector metadata adapter and compose current risk read model

**Files:**
- Create: `modules/portfolio/concentration/sector-metadata.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Modify: `modules/portfolio/risk-engine/server.ts`
- Create: `tests/portfolio/qeo159-concentration-server.test.ts`
- Modify relevant QEO-141 server contract test if it asserts the complete risk read-model shape.

**Interfaces:**
- Produces:

```ts
export type SectorMetadataSnapshot = {
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
  byTicker: Record<string, string | null>
}

export async function loadStructuredSectorMetadata(
  tickers?: readonly string[],
): Promise<SectorMetadataSnapshot>
```

- `PortfolioRiskReadModel` gains:

```ts
concentration: PortfolioConcentrationReadModel
```

- [ ] **Step 1: Write RED server/source-contract tests**

Tests must prove:

1. `sector-metadata.ts` imports `getCanonicalUniverse`.
2. It does not import/call `sectorForTicker`.
3. Missing requested ticker or `stock.sector == null/""` maps to `null`.
4. `getPortfolioRiskContext` passes its already-computed `summary.positions`, `currentPricesKvnd`, `active.rows`, `account.equityVnd`, latest plan diversification JSON and structured sector map into `evaluateCurrentConcentration`.
5. QEO-141 `activeRiskVnd` values are consumed unchanged.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test tests/portfolio/qeo159-concentration-server.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement canonical sector adapter**

Implementation shape:

```ts
import "server-only"
import { getCanonicalUniverse } from "@/modules/market/universe"

export async function loadStructuredSectorMetadata(tickers?: readonly string[]) {
  const snapshot = await getCanonicalUniverse()
  const wanted = tickers ? new Set(tickers.map((ticker) => ticker.toUpperCase())) : null
  const byTicker: Record<string, string | null> = {}
  for (const stock of snapshot.stocks) {
    if (wanted && !wanted.has(stock.ticker)) continue
    byTicker[stock.ticker] = stock.sector?.trim() || null
  }
  if (wanted) {
    for (const ticker of wanted) byTicker[ticker] ??= null
  }
  return { source: "canonical_market_universe" as const, sourceAsOfDate: snapshot.sourceAsOfDate || null, byTicker }
}
```

Do not add a fallback sector.

- [ ] **Step 4: Compose concentration after canonical risk/account calculations**

In `getPortfolioRiskContext`, after `summary`, `currentPricesKvnd`, `account`, `active` and current plan are available:

```ts
const sectorMetadata = await loadStructuredSectorMetadata(openTickers)
const concentration = evaluateCurrentConcentration({
  accountEquityVnd: fundingHistoryStatus === "known" ? account.equityVnd : null,
  positions: summary.positions.map((position) => ({
    ticker: position.ticker,
    openQty: position.openQty,
    currentPriceKvnd: currentPricesKvnd[position.ticker] ?? null,
  })),
  activeRiskRows: active.rows.map((row) => ({
    tradeId: row.tradeId,
    ticker: row.ticker,
    activeRiskVnd: row.activeRiskVnd,
    riskStatus: row.riskStatus,
  })),
  sectors: openTickers.map((ticker) => ({
    ticker,
    sector: sectorMetadata.byTicker[ticker] ?? null,
    source: sectorMetadata.source,
    sourceAsOfDate: sectorMetadata.sourceAsOfDate,
  })),
  rules: normalizeDiversificationRules(plan?.diversification_rules),
  planVersion: plan?.version ?? null,
})
```

Create a small fail-closed JSON normalizer for the plan fields; invalid persisted values must be treated as absent/unknown, not coerced into a threshold.

- [ ] **Step 5: Run QEO-159 + QEO-141 focused tests**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo141-*.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/concentration/sector-metadata.ts modules/portfolio/risk-engine/types.ts modules/portfolio/risk-engine/server.ts tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo141-*.test.ts
git commit -m "feat(QEO-159): compose concentration into portfolio risk"
```

---

### Task 4: Surface current concentration in Tài sản without a second browser risk fetch

**Files:**
- Create: `components/portfolio/concentration/portfolio-concentration-panel.tsx`
- Modify: `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx`
- Create/extend: `tests/portfolio/qeo159-concentration-ui.test.ts`

**Interfaces:**
- Consumes `risk.concentration` from the existing `usePortfolioRiskContext()` response.
- Produces no independent current-concentration fetch/hook.

- [ ] **Step 1: Write RED UI source contract**

Assert the panel renders and labels:

- `Tập trung danh mục`
- top ticker by market-value concentration
- top ticker by Active Risk
- top sector by Active Risk
- open-position count versus configured max when configured
- `Chưa đủ dữ liệu phân ngành` when unknown classifications exist
- status labels for `BREACH`, `WARNING`, `UNKNOWN`, `WITHIN_PLAN`

Also assert `portfolio-risk-dashboard-core.tsx` passes `risk.concentration` into the new panel and does not introduce `/api/portfolio/.../concentration` fetch code.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement compact panel**

The panel should sort/render already-calculated checks only; it must not recalculate percentages in React. Use existing card/border/typography language and explicit amber/slate treatment for incomplete evidence. A green `WITHIN_PLAN` badge is permitted only when that check is complete.

- [ ] **Step 4: Integrate into current dashboard**

Place the panel after Account/Risk summary and before per-trade cards, so Tài sản shows current risk and concentration in one canonical response.

- [ ] **Step 5: Run UI + typecheck**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/concentration/portfolio-concentration-panel.tsx components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx tests/portfolio/qeo159-concentration-ui.test.ts
git commit -m "feat(QEO-159): show portfolio concentration guardrails"
```

---

### Task 5: Add pure planned-trade concentration projection

**Files:**
- Create: `modules/portfolio/concentration/project-trade.ts`
- Create: `tests/portfolio/qeo159-concentration-projection.test.ts`

**Interfaces:**
- Consumes:

```ts
export type PlannedConcentrationTradeInput = {
  ticker: string
  plannedQty: number
  plannedEntryKvnd: number
  plannedRiskVnd: number
  sector: string | null
}

export type ProjectTradeConcentrationInput = {
  current: PortfolioConcentrationReadModel
  accountEquityVnd: number | null
  currentTickerMarketValueVnd: number
  currentTickerKnownActiveRiskVnd: number
  currentSectorKnownActiveRiskVnd: number
  currentOpenPositionCount: number
  tickerAlreadyOpen: boolean
  rules: DiversificationRules | null
  trade: PlannedConcentrationTradeInput
}

export function projectTradeConcentration(
  input: ProjectTradeConcentrationInput,
): ProjectedTradeConcentrationResult
```

- [ ] **Step 1: Write RED projection tests**

Cover:

```ts
// new ticker pushes market-value concentration over configured max
assert.equal(result.tickerMarketValue.status, "BREACH")

// scale-in does not increment open-position count
assert.equal(result.openPositions.metricValue, currentCount)

// new ticker increments count by one
assert.equal(result.openPositions.metricValue, currentCount + 1)

// unknown planned sector
assert.equal(result.sectorActiveRisk.status, "UNKNOWN")
```

Also prove projected sector Active Risk adds `plannedRiskVnd`, projected ticker Active Risk adds `plannedRiskVnd`, denominator remains current Account Equity, and QEO-139 sizing/quantity is never modified.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test tests/portfolio/qeo159-concentration-projection.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the pure projector**

Required arithmetic:

```ts
const plannedMarketValueVnd = plannedQty * plannedEntryKvnd * 1_000
const projectedTickerMarketValueVnd = currentTickerMarketValueVnd + plannedMarketValueVnd
const projectedTickerKnownActiveRiskVnd = currentTickerKnownActiveRiskVnd + plannedRiskVnd
const projectedSectorKnownActiveRiskVnd = currentSectorKnownActiveRiskVnd + plannedRiskVnd
const projectedOpenPositionCount = currentOpenPositionCount + (tickerAlreadyOpen ? 0 : plannedQty > 0 ? 1 : 0)
```

Reuse the same threshold/status helpers as current evaluation so current and projected semantics cannot drift.

- [ ] **Step 4: Run current + projection domain tests**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/concentration/project-trade.ts tests/portfolio/qeo159-concentration-projection.test.ts
git commit -m "feat(QEO-159): project planned trade concentration"
```

---

### Task 6: Extend QEO-139 planning context with canonical sector metadata and concentration data

**Files:**
- Modify: `modules/portfolio/risk-sizing/types.ts`
- Modify: `modules/portfolio/risk-sizing/server.ts`
- Modify: `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- Modify: relevant QEO-139 server/API tests.

**Interfaces:**
- `RiskSizingServerContext` gains:

```ts
moneyManagementPlanId: string | null
concentration: PortfolioConcentrationReadModel
sectorMetadata: {
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
  byTicker: Record<string, string | null>
}
```

The sector map may contain the current canonical universe (<= current product max 200 names) so free-text planner tickers can be resolved without a per-keystroke server request. A ticker absent from the map is `null/UNKNOWN`.

- [ ] **Step 1: Write RED QEO-139 context tests**

Assert:

- `concentration` is the exact nested object returned by QEO-141 risk context;
- `moneyManagementPlanId` comes from the current latest plan or null;
- `sectorMetadata` comes from `loadStructuredSectorMetadata()` and never `sectorForTicker()`;
- existing `defaultTradeRiskPercent`, `knownActiveRiskVnd`, `maxActiveRiskPercent`, win/payoff and risk-state fields remain unchanged.

- [ ] **Step 2: Run focused QEO-139 tests and verify RED**

```bash
node --test tests/portfolio/qeo139-*.test.ts
```

Expected: FAIL on missing new context fields only; calculator math tests remain GREEN.

- [ ] **Step 3: Implement server/client context pass-through**

`getRiskSizingContext` should reuse `risk.concentration`; call `loadStructuredSectorMetadata()` once for the canonical universe map and return it. Do not call concentration formulas again here.

- [ ] **Step 4: Run QEO-139 + QEO-141 + QEO-159 server tests**

```bash
node --test tests/portfolio/qeo139-*.test.ts tests/portfolio/qeo141-*.test.ts tests/portfolio/qeo159-concentration-server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/risk-sizing/types.ts modules/portfolio/risk-sizing/server.ts components/portfolio/risk-sizing/use-risk-sizing-context.ts tests/portfolio/qeo139-*.test.ts
git commit -m "feat(QEO-159): expose concentration planning context"
```

---

### Task 7: Show projected conflict and persist auditable override on planned Trade confirmation

**Files:**
- Create: `components/portfolio/concentration/projected-concentration-panel.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx`
- Modify: `components/portfolio/risk-sizing/trade-size-advisor.tsx`
- Modify: `tests/portfolio/qeo159-concentration-ui.test.ts`
- Add/modify a QEO-159 API/source contract test covering existing Trade + journal calls.

**Interfaces:**
- Consumes QEO-139 `TradeSizeResult` only after it is `ready`.
- Persists through existing endpoints:

```text
POST /api/portfolio/{portfolioId}/trades
POST /api/portfolio/{portfolioId}/trades/{tradeId}/journal
```

- Planned Trade create payload uses existing frozen QEO-137 fields and does not invent new persistence:

```ts
{
  ticker,
  mode,
  status: "planned",
  trade_type: null,
  timeframe: null,
  system_tags: [],
  setup_tags: [],
  money_management_plan_id: riskContext.moneyManagementPlanId,
  planned_entry: plannedEntryKvnd,
  initial_stop_loss_exit: initialStopKvnd,
  initial_account_equity: accountEquityContext.valueVnd,
  initial_risk_percent: riskPercent,
  initial_risk_amount: result.riskAmountVnd,
  initial_risk_amount_per_share: result.riskPerShareVnd,
  planned_trade_size: result.tradeSizeShares,
  planned_position_value: result.positionValueVnd,
  estimated_commission: estimatedCommissionVnd,
  slippage_allowance: slippageAllowanceVnd,
  pre_trade_plan: null,
  thesis_summary: null
}
```

- [ ] **Step 1: Write RED projection UI tests**

Assert the calculator displays, for a ready draft:

- projected ticker concentration;
- projected ticker Active Risk;
- projected sector Active Risk or `Chưa đủ dữ liệu phân ngành`;
- projected open-position rule;
- explicit text that the sizing formula/Trade Size is unchanged by the advisory result.

Use `projectTradeConcentration()` in the component; do not reproduce formulas in JSX.

- [ ] **Step 2: Write RED override-audit contract tests**

Contract must prove:

1. `BREACH` or `WARNING` does **not** disable the ordinary calculation result.
2. Explicit `Lưu Trade dự kiến` confirmation requires the user to choose `live|paper` because QEO-137 Trade persistence requires mode; do not silently default a mode.
3. If projected overall state is `WARNING` or `BREACH`, confirmation requires a non-empty override reason.
4. After `POST /trades` returns `trade.id`, the client posts a journal entry:

```ts
{
  phase: "before",
  note: "Concentration/diversification override",
  emotion_tags: [],
  behavior_tags: ["concentration_override"],
  adherence_status: "deviated",
  override_reason: overrideReason.trim(),
  occurred_at: new Date().toISOString()
}
```

5. If no warning/breach exists, no override journal is required.
6. No transaction/fill route or `add-transaction-dialog.tsx` validation is changed by QEO-159.

- [ ] **Step 3: Run UI tests and verify RED**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement projected panel using canonical planner context**

Determine planned sector only by:

```ts
const plannedSector = riskContext?.sectorMetadata.byTicker[normalizedTicker] ?? null
```

Determine `tickerAlreadyOpen` from current canonical concentration/position rows, not from whether another local planned row exists.

Render status with advisory copy. Never modify `result.tradeSizeShares`, `result.riskAmountVnd` or calculator inputs from concentration output.

- [ ] **Step 5: Implement explicit persisted planned-Trade confirmation**

Keep the existing local `Thêm giao dịch dự kiến` simulation behavior. Add a separate explicit persist action such as `Lưu Trade dự kiến` so QEO-159 does not silently turn every local simulation into database state.

Confirmation requirements:

- `TradeSizeResult.status === "ready"`;
- normalized ticker present;
- explicit `live|paper` mode selected;
- if projected state has any `WARNING`/`BREACH`, override reason is non-empty.

Call existing Trade endpoint. On success, if override is required, immediately call existing journal endpoint with the returned trade ID. If the journal write fails after Trade creation, surface an explicit audit failure and do not claim the override was recorded; do not delete the created Trade automatically.

- [ ] **Step 6: Preserve executed/historical fill behavior**

Do not modify `components/portfolio/add-transaction-dialog.tsx`, transaction POST validation, or fill APIs. Add a source-contract assertion that those files/routes are not imported by the concentration confirmation gate.

- [ ] **Step 7: Run UI + Trade-domain regressions**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts tests/portfolio/qeo137-*.test.ts tests/portfolio/qeo139-*.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/portfolio/concentration/projected-concentration-panel.tsx components/portfolio/portfolio-capital-allocation.tsx components/portfolio/risk-sizing/trade-size-advisor.tsx tests/portfolio/qeo159-concentration-ui.test.ts tests/portfolio/qeo137-*.test.ts tests/portfolio/qeo139-*.test.ts
git commit -m "feat(QEO-159): add projected guardrails and override audit"
```

---

### Task 8: Register tests and add a focused read-only QEO-159 workflow

**Files:**
- Modify: `tests/test-contracts.json`
- Create: `.github/workflows/qeo159-preprod.yml`

**Interfaces:**
- Produces focused CI with no write permissions and no self-mutating generated files.

- [ ] **Step 1: Register all new tests in the canonical manifest**

Add QEO-159 test files to the appropriate current/UI suites so `pnpm test:manifest` recognizes them.

- [ ] **Step 2: Create workflow path filters**

Trigger on PR/push changes to:

```yaml
- "modules/portfolio/concentration/**"
- "modules/portfolio/risk-plan/**"
- "modules/portfolio/risk-engine/**"
- "modules/portfolio/risk-sizing/**"
- "modules/portfolio/trades/**"
- "components/portfolio/**"
- "app/api/portfolio/**"
- "tests/portfolio/qeo159-*.test.ts"
- "tests/portfolio/qeo138-*.test.ts"
- "tests/portfolio/qeo139-*.test.ts"
- "tests/portfolio/qeo141-*.test.ts"
- "tests/test-contracts.json"
- ".github/workflows/qeo159-preprod.yml"
```

Set:

```yaml
permissions:
  contents: read
```

Do not grant `contents: write` and do not commit/push generated artifacts.

- [ ] **Step 3: Add focused jobs**

At minimum:

```yaml
- domain: node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
- integration: node --test tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo138-*.test.ts tests/portfolio/qeo139-*.test.ts tests/portfolio/qeo141-*.test.ts
- ui-contract: node --test tests/portfolio/qeo159-concentration-ui.test.ts
- verify-contract: pnpm test:manifest && pnpm typecheck
```

Do not add local Supabase replay to this focused workflow because QEO-159 has no migration. DB Drift/Verify remain independent canonical gates.

- [ ] **Step 4: Run manifest verification locally**

```bash
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test-contracts.json .github/workflows/qeo159-preprod.yml
git commit -m "ci(QEO-159): add concentration guardrail gate"
```

---

### Task 9: Full regression, exact-head PR, and acceptance evidence handoff

**Files:**
- Modify only if evidence/result documentation is required after tests; no source changes after final exact-head gate without rerunning the gate.

**Interfaces:**
- Produces a frozen PR head with exact-head evidence and a QEO-144 handoff.

- [ ] **Step 1: Run focused tests from a clean branch/worktree**

```bash
node --test \
  tests/portfolio/qeo159-concentration-domain.test.ts \
  tests/portfolio/qeo159-concentration-server.test.ts \
  tests/portfolio/qeo159-concentration-projection.test.ts \
  tests/portfolio/qeo159-concentration-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mandatory regressions**

```bash
node --test tests/portfolio/qeo138-*.test.ts
node --test tests/portfolio/qeo139-*.test.ts
node --test tests/portfolio/qeo141-*.test.ts
node --test tests/portfolio/qeo142-*.test.ts
node --test tests/portfolio/qeo158-*.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run canonical repository gates**

```bash
pnpm test:manifest
pnpm lint:touched
pnpm typecheck
pnpm build
```

Expected: PASS.

Because QEO-159 has no migration, generated DB types must remain unchanged. If `git diff -- modules/shared/supabase/database.types.ts supabase/migrations` shows a QEO-159 change, stop and review the architecture before proceeding.

- [ ] **Step 4: Open/update PR as Draft until CI is exact-head GREEN**

PR title:

```text
QEO-159: deterministic concentration and diversification guardrails
```

PR body must state:

- user plan is authoritative; no universal diversification defaults;
- structured sector source with explicit `UNKNOWN`;
- ticker market-value, ticker Active Risk, sector Active Risk, open-position checks;
- QEO-139 projection does not alter sizing formula;
- override reason persists through QEO-137 journal;
- no migration expected.

- [ ] **Step 5: Require exact-head GitHub Actions**

At minimum confirm success on the same final SHA for:

- Verify;
- DB Drift Reconciliation;
- QEO-159 focused workflow;
- QEO-138 Risk Plan;
- QEO-139 Risk Sizing;
- QEO-141 Portfolio Risk Engine;
- QEO-142 Performance;
- QEO-158 External Cash Flows;
- QEO-137 Trade Domain when touched by override integration.

If a workflow fails from infrastructure only, inspect logs and rerun only failed jobs without changing source. If source changes, all exact-head evidence must be refreshed.

- [ ] **Step 6: Production/preproduction acceptance after merge/deploy**

Verify with real production data without fabricating rows:

- latest plan JSON round-trips configured diversification fields if a safe existing test plan/value exists; otherwise verify read compatibility without mutating user settings;
- current ticker market-value percentage reconciles to canonical holding market value / current Account Equity;
- ticker Active Risk sums exactly to QEO-141 rows;
- sector Active Risk uses structured sector values only;
- missing classification remains explicit `UNKNOWN`;
- no QEO-159 migration exists or needs applying;
- production page/API responds without runtime errors.

Do not create artificial deposit/trade/fill history merely to produce acceptance evidence.

- [ ] **Step 7: Update Linear/QEO-144 evidence**

Add QEO-159 final PR SHA, workflow run IDs, production deploy ID, no-migration statement, reconciliation facts and any remaining data-completeness limitation to QEO-159 and QEO-144. Move QEO-159 to `Done` only after merge + required production acceptance is complete.
