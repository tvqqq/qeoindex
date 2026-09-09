# QEO-159 Deterministic Concentration & Diversification Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, user-plan-driven ticker/sector/open-position concentration checks to Portfolio Risk and the QEO-139 pre-trade planner, with fail-closed `UNKNOWN` semantics and auditable override reasons.

**Architecture:** Keep all concentration math/status rules in `modules/portfolio/concentration/`. QEO-141 remains authoritative for Account Equity and per-open-trade Active Risk; canonical market-universe sector metadata is the only classification input. Current concentration is nested into the existing Portfolio Risk response so Tài sản needs no second risk fetch. QEO-139 sizing is unchanged; a pure post-sizing projector consumes the current concentration exposure snapshot. Persisted overrides use existing QEO-137 planned-Trade + journal APIs.

**Tech Stack:** TypeScript 5.7, Node `node:test`, Next.js 16 App Router, React 19, Supabase/Postgres existing JSONB risk-plan storage, GitHub Actions, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-159-deterministic-concentration-diversification-design.md`

## Global Constraints

- No AI/LLM classification or recommendation.
- No universal diversification threshold may be silently introduced.
- `concentrationWarningPercent` is advisory; it is never promoted to a hard breach threshold.
- `maxSectorRiskPercent` means sector Active Risk / current Account Equity.
- Account Equity denominator is the QEO-141/QEO-158 current post-external-flow value.
- Active Risk is reused from QEO-141 `activeRiskVnd`; QEO-159 never recalculates stop risk independently.
- Missing structured sector metadata is `UNKNOWN`; do not call `sectorForTicker()` as classification evidence because its fallback guesses `Công nghiệp & Vật liệu`.
- Partial evidence may prove `BREACH` when the known lower bound already exceeds a hard threshold; partial evidence must not prove `WITHIN_PLAN` when missing evidence can increase the metric.
- QEO-139 sizing formula, lot rounding, risk amount and Trade Size remain unchanged.
- Warnings/breaches are advisory and never block recording already-executed/historical fills.
- Override reasons persist through QEO-137 journal `override_reason`; no parallel audit table.
- Expected DB migration: none; `diversification_rules` remains versioned JSONB.

## File Map

**Create**
- `modules/portfolio/concentration/types.ts`
- `modules/portfolio/concentration/evaluate-current.ts`
- `modules/portfolio/concentration/project-trade.ts`
- `modules/portfolio/concentration/sector-metadata.ts`
- `components/portfolio/concentration/portfolio-concentration-panel.tsx`
- `components/portfolio/concentration/projected-concentration-panel.tsx`
- `tests/portfolio/qeo159-concentration-domain.test.ts`
- `tests/portfolio/qeo159-concentration-server.test.ts`
- `tests/portfolio/qeo159-concentration-projection.test.ts`
- `tests/portfolio/qeo159-concentration-ui.test.ts`
- `.github/workflows/qeo159-preprod.yml`

**Modify**
- `modules/portfolio/risk-plan/types.ts`
- `modules/portfolio/risk-plan/validation.ts`
- `modules/portfolio/risk-plan/server.ts`
- `components/portfolio/risk-plan/money-management-plan-form.tsx`
- `modules/portfolio/risk-engine/types.ts`
- `modules/portfolio/risk-engine/server.ts`
- `modules/portfolio/risk-sizing/types.ts`
- `modules/portfolio/risk-sizing/server.ts`
- `components/portfolio/risk-sizing/use-risk-sizing-context.ts`
- `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx`
- `components/portfolio/portfolio-capital-allocation.tsx`
- `components/portfolio/risk-sizing/trade-size-advisor.tsx`
- `tests/portfolio/qeo138-risk-plan-domain.test.ts`
- `tests/portfolio/qeo138-risk-plan-ui.test.ts`
- relevant QEO-139/QEO-141 contract tests when public response shapes change
- `tests/test-contracts.json`

---

### Task 1: Extend the versioned diversification-plan JSON contract

**Files:** risk-plan types/validation/server/form + QEO-138 domain/UI tests.

**Produces**

```ts
export type DiversificationRules = {
  enabled: boolean
  concentrationWarningPercent?: number
  maxTickerConcentrationPercent?: number
  maxSectorRiskPercent?: number
  maxConcurrentOpenPositions?: number
}
```

- [ ] **Write RED domain tests.** Prove `maxTickerConcentrationPercent` accepts finite `(0,100]`; `maxConcurrentOpenPositions` accepts positive integers only; legacy `{enabled:false}` and old two-field JSON remain valid.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts
```

Expected: new-field cases fail.

- [ ] **Implement type + validation:**

```ts
if (input.diversificationRules.maxTickerConcentrationPercent != null) {
  assertPercent(input.diversificationRules.maxTickerConcentrationPercent, "Maximum ticker concentration")
}
if (input.diversificationRules.maxConcurrentOpenPositions != null) {
  assertPositiveInteger(input.diversificationRules.maxConcurrentOpenPositions, "Maximum concurrent open positions")
}
```

- [ ] **Normalize request fields only when present:**

```ts
...(diversificationRules.maxTickerConcentrationPercent != null
  ? { maxTickerConcentrationPercent: finiteNumber(diversificationRules.maxTickerConcentrationPercent, "diversificationRules.maxTickerConcentrationPercent") }
  : {}),
...(diversificationRules.maxConcurrentOpenPositions != null
  ? { maxConcurrentOpenPositions: finiteNumber(diversificationRules.maxConcurrentOpenPositions, "diversificationRules.maxConcurrentOpenPositions") }
  : {}),
```

Do not persist defaults.

- [ ] **Add UI fields:** `Max Ticker Concentration` (%) and `Max Concurrent Open Positions` (integer), both optional and serialized only when diversification is enabled and the input is non-empty. Preserve advisory wording for `Concentration Warning`.
- [ ] **Run GREEN:**

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
```

- [ ] **Commit:**

```bash
git add modules/portfolio/risk-plan/types.ts modules/portfolio/risk-plan/validation.ts modules/portfolio/risk-plan/server.ts components/portfolio/risk-plan/money-management-plan-form.tsx tests/portfolio/qeo138-risk-plan-domain.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
git commit -m "feat(QEO-159): extend diversification plan limits"
```

---

### Task 2: Implement pure current concentration evaluation

**Files:** create concentration types/evaluator/domain test.

**Consumes**

```ts
export type ConcentrationPositionInput = {
  ticker: string
  marketValueVnd: number | null
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

**Produces**

```ts
export type ConcentrationStatus = "WITHIN_PLAN" | "WARNING" | "BREACH" | "UNKNOWN"

export type ConcentrationCheck = {
  id: string
  kind: "ticker_market_value" | "ticker_active_risk" | "sector_active_risk" | "open_position_count"
  status: ConcentrationStatus
  metricValue: number | null       // percentage for exposure checks, count for position count
  amountVnd: number | null         // raw market value / known Active Risk used for projection and audit
  warningThreshold: number | null
  breachThreshold: number | null
  ticker: string | null
  sector: string | null
  basis: string
  completeness: "complete" | "partial" | "insufficient"
  provenance: string[]
  reason: string
}

export type ConcentrationExposureSnapshot = {
  openTickers: string[]
  tickerMarketValueVnd: Record<string, number | null>
  tickerKnownActiveRiskVnd: Record<string, number>
  tickerRiskComplete: Record<string, boolean>
  sectorKnownActiveRiskVnd: Record<string, number>
  sectorRiskComplete: Record<string, boolean>
}
```

`PortfolioConcentrationReadModel` contains summary/status arrays plus this `exposure` snapshot so projection never recomputes current portfolio aggregation in React.

- [ ] **Write RED tests** for: 40m/100m = 40%; ticker hard breach; warning-only state; sector 7m/100m > 6% breach; missing sector => `UNKNOWN`; no configured rule => `UNKNOWN/rule_not_configured`; multiple Trade rows aggregate one ticker; distinct ticker position count; non-positive equity => percentage `UNKNOWN`; partial known lower-bound breach remains `BREACH`; partial below threshold => `UNKNOWN`.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts
```

- [ ] **Implement evaluator** with formulas:

```ts
percent = amountVnd / accountEquityVnd * 100
```

and overall precedence:

```text
BREACH > WARNING > UNKNOWN > WITHIN_PLAN
```

No rule means no invented plan compliance.

- [ ] **Run GREEN:**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts
```

- [ ] **Commit:**

```bash
git add modules/portfolio/concentration/types.ts modules/portfolio/concentration/evaluate-current.ts tests/portfolio/qeo159-concentration-domain.test.ts
git commit -m "feat(QEO-159): add deterministic concentration evaluator"
```

---

### Task 3: Add structured sector evidence and compose it into QEO-141 risk context

**Files:** create sector adapter; modify risk-engine types/server; create QEO-159 server test; update QEO-141 shape tests if needed.

**Produces**

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

and:

```ts
export type PortfolioRiskReadModel = {
  // existing fields unchanged
  concentration: PortfolioConcentrationReadModel
}
```

- [ ] **Write RED server tests** proving `sector-metadata.ts` uses `getCanonicalUniverse()`, never imports `sectorForTicker`, maps missing/blank sector to `null`, and `getPortfolioRiskContext` feeds its already-computed Account Equity/current position values/QEO-141 `active.rows` into `evaluateCurrentConcentration`.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo159-concentration-server.test.ts
```

- [ ] **Implement sector adapter:**

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
  if (wanted) for (const ticker of wanted) byTicker[ticker] ??= null
  return { source: "canonical_market_universe" as const, sourceAsOfDate: snapshot.sourceAsOfDate || null, byTicker }
}
```

- [ ] **Compose current market values server-side** from canonical positions/current prices already loaded by risk-engine:

```ts
marketValueVnd: currentPricesKvnd[position.ticker] == null
  ? null
  : position.openQty * currentPricesKvnd[position.ticker]! * 1_000
```

Pass `account.equityVnd` only when current funding/equity denominator is reliable; otherwise percentage checks stay `UNKNOWN`. Parse persisted diversification JSON fail-closed: invalid persisted fields become absent, never thresholds.

- [ ] **Run regressions:**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo141-*.test.ts
```

- [ ] **Commit:**

```bash
git add modules/portfolio/concentration/sector-metadata.ts modules/portfolio/risk-engine/types.ts modules/portfolio/risk-engine/server.ts tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo141-*.test.ts
git commit -m "feat(QEO-159): compose concentration into portfolio risk"
```

---

### Task 4: Render current concentration in Tài sản with no extra risk fetch

**Files:** create current panel; modify `portfolio-risk-dashboard-core.tsx`; extend UI test.

- [ ] **Write RED UI contract** asserting labels `Tập trung danh mục`, top ticker market-value concentration, top ticker Active Risk, top sector Active Risk, open-position rule and `Chưa đủ dữ liệu phân ngành`; assert status copy for all four states.
- [ ] **Assert architecture:** dashboard consumes `risk.concentration`; new component must not fetch `/api/portfolio/.../concentration` or recalculate percentages.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
```

- [ ] **Implement panel** by sorting/rendering already-calculated checks. A green `WITHIN_PLAN` treatment is allowed only for complete evidence.
- [ ] **Integrate after Account/Risk summary and before per-Trade cards.**
- [ ] **Run GREEN + types:**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
pnpm typecheck
```

- [ ] **Commit.**

---

### Task 5: Implement pure one-trade concentration projection

**Files:** create projector + projection test.

**Consumes**

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
  rules: DiversificationRules | null
  trade: PlannedConcentrationTradeInput
}
```

**Derives only from `current.exposure`:**

```ts
plannedMarketValueVnd = plannedQty * plannedEntryKvnd * 1_000
projectedTickerMarketValueVnd = (current.exposure.tickerMarketValueVnd[ticker] ?? 0) + plannedMarketValueVnd
projectedTickerKnownActiveRiskVnd = (current.exposure.tickerKnownActiveRiskVnd[ticker] ?? 0) + plannedRiskVnd
projectedSectorKnownActiveRiskVnd = sector == null
  ? null
  : (current.exposure.sectorKnownActiveRiskVnd[sector] ?? 0) + plannedRiskVnd
projectedOpenPositionCount = current.summary.openPositionCount + (current.exposure.openTickers.includes(ticker) ? 0 : plannedQty > 0 ? 1 : 0)
```

- [ ] **Write RED tests:** projected ticker breach, sector breach, unknown planned sector, scale-in count unchanged, new ticker count +1, denominator remains current Account Equity, and returned result never mutates planned Qty/Risk/Trade Size.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo159-concentration-projection.test.ts
```

- [ ] **Implement projector** reusing the same status helper used by current evaluation. Missing current risk/sector completeness must propagate `UNKNOWN` unless a known lower-bound hard breach is already proven.
- [ ] **Run GREEN:**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
```

- [ ] **Commit.**

---

### Task 6: Expose current concentration + canonical sector lookup to QEO-139 planner

**Files:** risk-sizing types/server/hook + QEO-139 context tests.

**RiskSizingServerContext gains**

```ts
moneyManagementPlanId: string | null
concentration: PortfolioConcentrationReadModel
sectorMetadata: {
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
  byTicker: Record<string, string | null>
}
```

The sector map may contain the current canonical universe (product max <= 200 rows), allowing free-text planner ticker lookup without per-keystroke server calls. Absent ticker => `null/UNKNOWN`.

- [ ] **Write RED QEO-139 tests:** concentration object is passed through exactly from risk context; current latest plan ID is returned; sector map comes from `loadStructuredSectorMetadata()`; existing risk amount/default/Optimal-f evidence fields are unchanged.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo139-*.test.ts
```

Calculator tests should remain green; context tests fail for missing fields.

- [ ] **Implement server/hook pass-through.** Do not recompute concentration here.
- [ ] **Run:**

```bash
node --test tests/portfolio/qeo139-*.test.ts tests/portfolio/qeo141-*.test.ts tests/portfolio/qeo159-concentration-server.test.ts
```

- [ ] **Commit.**

---

### Task 7: Show projected conflicts and persist advisory override through QEO-137 journal

**Files:** projected panel + capital allocation + trade-size advisor + QEO-159 UI/API contracts.

**Existing persistence endpoints only**

```text
POST /api/portfolio/{portfolioId}/trades
POST /api/portfolio/{portfolioId}/trades/{tradeId}/journal
```

- [ ] **Write RED UI tests** proving a ready calculator draft renders projected ticker market value, ticker Active Risk, sector Active Risk/unknown state and open-position status, plus explicit copy that diversification does not change sizing math.
- [ ] **Write RED audit tests** proving `WARNING/BREACH` does not disable calculation; persisted confirmation requires explicit `live|paper` mode; conflict confirmation requires non-empty override reason; normal confirmation needs no override reason; transaction/fill UI/routes remain untouched.
- [ ] **Run RED:**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts
```

- [ ] **Compute draft projection** with:

```ts
const plannedSector = riskContext?.sectorMetadata.byTicker[normalizedTicker] ?? null
const projected = projectTradeConcentration({
  current: riskContext.concentration,
  accountEquityVnd: accountEquityContext.valueVnd,
  rules: riskContext.concentration.rules,
  trade: {
    ticker: normalizedTicker,
    plannedQty: result.tradeSizeShares,
    plannedEntryKvnd: plannedEntryKvnd!,
    plannedRiskVnd: result.totalRiskConsumptionVnd!,
    sector: plannedSector,
  },
})
```

If the final read-model shape stores rules under a differently named typed field, use that exact field consistently in Task 2/5/7; do not reparse JSON in React.

- [ ] **Preserve existing local simulation action.** Add a separate explicit `Lưu Trade dự kiến` persistence action; do not silently persist every local simulation.
- [ ] **Build existing QEO-137 `TradeCreateInput`:**

```ts
{
  ticker: normalizedTicker,
  mode: selectedMode,
  status: "planned",
  trade_type: null,
  timeframe: null,
  system_tags: [],
  setup_tags: [],
  money_management_plan_id: riskContext?.moneyManagementPlanId ?? null,
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

- [ ] **When any projected check is `WARNING` or `BREACH`, after Trade creation POST this existing journal input:**

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

If Trade creation succeeds but journal persistence fails, show an explicit audit failure and do not claim the override was recorded; do not auto-delete the Trade.

- [ ] **Do not modify** `components/portfolio/add-transaction-dialog.tsx` or transaction/fill validation. Historical/executed fills remain recordable regardless of concentration state.
- [ ] **Run:**

```bash
node --test tests/portfolio/qeo159-concentration-ui.test.ts tests/portfolio/qeo137-*.test.ts tests/portfolio/qeo139-*.test.ts
pnpm typecheck
```

- [ ] **Commit.**

---

### Task 8: Register QEO-159 tests and add a read-only focused workflow

**Files:** `tests/test-contracts.json`, create `.github/workflows/qeo159-preprod.yml`.

- [ ] **Register all four QEO-159 tests** in canonical current/UI suites.
- [ ] **Create path filters** covering `modules/portfolio/concentration/**`, risk-plan/risk-engine/risk-sizing/trades, `components/portfolio/**`, portfolio APIs, QEO-138/139/141/159 tests, manifest and the workflow itself.
- [ ] **Use read-only permission:**

```yaml
permissions:
  contents: read
```

- [ ] **Focused jobs:**

```yaml
# domain
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
# integration
node --test tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo138-*.test.ts tests/portfolio/qeo139-*.test.ts tests/portfolio/qeo141-*.test.ts
# ui
node --test tests/portfolio/qeo159-concentration-ui.test.ts
# contract
pnpm test:manifest && pnpm typecheck
```

No Supabase replay is added to this focused workflow because QEO-159 introduces no migration. DB Drift stays an independent canonical gate.

- [ ] **Run:**

```bash
pnpm test:manifest
```

- [ ] **Commit.**

---

### Task 9: Exact-head regression, PR, preview/browser acceptance and QEO-144 handoff

- [ ] **Run focused suite:**

```bash
node --test tests/portfolio/qeo159-concentration-domain.test.ts tests/portfolio/qeo159-concentration-server.test.ts tests/portfolio/qeo159-concentration-projection.test.ts tests/portfolio/qeo159-concentration-ui.test.ts
```

- [ ] **Run mandatory regressions:**

```bash
node --test tests/portfolio/qeo138-*.test.ts
node --test tests/portfolio/qeo139-*.test.ts
node --test tests/portfolio/qeo141-*.test.ts
node --test tests/portfolio/qeo142-*.test.ts
node --test tests/portfolio/qeo158-*.test.ts
node --test tests/portfolio/qeo137-*.test.ts
```

- [ ] **Run repository gates:**

```bash
pnpm test:manifest
pnpm lint:touched
pnpm typecheck
pnpm build
```

`modules/shared/supabase/database.types.ts` and `supabase/migrations/` must have no QEO-159 changes. Any such change is an architecture stop/review condition.

- [ ] **Open Draft PR:** `QEO-159: deterministic concentration and diversification guardrails`.
- [ ] **Require same-final-SHA success** for Verify, DB Drift Reconciliation, QEO-159, QEO-138, QEO-139, QEO-141, QEO-142, QEO-158 and QEO-137. Source change => refresh all exact-head evidence.
- [ ] **Preview/browser acceptance:** on the deployed PR/production surface with an authenticated portfolio, verify current concentration panel renders; a concentrated ticker produces expected warning/breach when the user's configured plan supports it; a ticker lacking structured classification shows `UNKNOWN`; a projected new Trade conflict is shown without changing calculated Trade Size; conflict persistence requires an override reason. Do not mutate real user thresholds or fabricate Trade/fill history solely for the test—use existing safe data or reversible planned-Trade records.
- [ ] **After merge/deploy:** verify canonical production API/page health, no runtime errors, QEO-141 Active Risk reconciliation, structured sector provenance, and no migration to run.
- [ ] **Update Linear QEO-159 + QEO-144** with final SHA, workflow run IDs, deployment ID, no-migration statement, reconciliation facts and any remaining completeness limitation. Mark QEO-159 `Done` only after merge + required production acceptance.

## Plan Self-Review Result

- Spec coverage: all QEO-159 acceptance items map to Tasks 1–9, including current metrics, sector `UNKNOWN`, plan-driven thresholds, projected trade conflict, no universal defaults, override audit, UI/browser coverage and QEO-144 handoff.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, unspecified error-handling steps or deferred tests remain.
- Type consistency: current evaluator emits raw exposure VND plus percentages; projector consumes the same read-model exposure snapshot, so React does not reverse-calculate amounts or duplicate current aggregation.
- Scope check: no DB schema change, no AI classification, no covariance/VaR work, and no change to QEO-139 sizing formula.