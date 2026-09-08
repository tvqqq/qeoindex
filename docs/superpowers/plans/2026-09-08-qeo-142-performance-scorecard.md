# QEO-142 Canonical Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical performance engine for closed logical Trade Scorecard metrics, period ledgers, Account Equity/Drawdown analytics, VN-Index benchmark comparison and diagnostic segmentation, then make QEO-138/QEO-139 and the `Hiệu suất` UI consume those same facts.

**Architecture:** Create `modules/portfolio/performance/` as a derived, on-demand analytics subsystem. Pure modules normalize closed Trades, calculate Scorecards, drawdown episodes, ledgers, segmentation and benchmark normalization; `server.ts` is the only performance-layer database/provider boundary. QEO-141 keeps ownership of Account Equity construction and QEO-140/AVCO keep ownership of closed-Trade accounting.

**Tech Stack:** Next.js App Router, TypeScript, Node `node:test`, Supabase/Postgres read APIs, existing VN-Index provider, pnpm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-142-performance-scorecard-design.md`

## Global Constraints

- No database migration or persisted analytics snapshots.
- `portfolio_transactions` + `computePortfolioPositions()` remain canonical accounting/AVCO/P&L.
- `deriveTradeCloseReview()` remains the closed-Trade fee/net-P&L audit boundary.
- Closed logical Trades are the Scorecard unit; fills never count as Trades.
- Legacy `trade_id = null` transactions may affect Account Equity but never become Scorecard Trades.
- Winner/loser classification uses net P/L after fees. Gross Profit/Loss uses gross P/L before fees for Commission Ratio reconciliation.
- Empty/insufficient metrics are `null` plus reason/completeness, never fake zero.
- QEO-141 `buildEquityCurve()` and its fail-closed RAW Daily semantics are reused.
- Trade analytics support explicit `live | paper | combined`; `combined` is never implicit.
- Account Equity, Drawdown and benchmark stay portfolio-wide because there is no separate live/paper account-capital model.
- Period assignment uses `Asia/Ho_Chi_Minh`; week is Monday-Sunday.
- Benchmark portfolio return must use canonical Account Equity, not realized-P&L / remaining-cost-basis.
- UI is Vietnamese-primary; canonical English/source terms and formulas live in tooltips/help.
- No AI code, no automatic risk-setting changes, no exact universal Risk-of-Ruin probability.
- If implementation needs persisted schema, stop and return to architectural approval.

---

## File map

### Domain
- Create `modules/portfolio/performance/types.ts`
- Create `modules/portfolio/performance/closed-trades.ts`
- Create `modules/portfolio/performance/scorecard.ts`
- Create `modules/portfolio/performance/drawdown.ts`
- Create `modules/portfolio/performance/ledgers.ts`
- Create `modules/portfolio/performance/segments.ts`
- Create `modules/portfolio/performance/benchmark.ts`
- Create `modules/portfolio/performance/server.ts`

### API / integrations
- Create `app/api/portfolio/[id]/performance/route.ts`
- Modify `app/api/portfolio/[id]/benchmark/route.ts`
- Modify `modules/portfolio/risk-plan/evidence.ts`
- Modify `modules/portfolio/risk-plan/server.ts`

### UI
- Create `components/portfolio/performance/terminology.ts`
- Create `components/portfolio/performance/use-performance.ts`
- Create `components/portfolio/performance/performance-dashboard.tsx`
- Create `components/portfolio/performance/trading-scorecard.tsx`
- Create `components/portfolio/performance/equity-drawdown-panel.tsx`
- Create `components/portfolio/performance/performance-ledger.tsx`
- Create `components/portfolio/performance/benchmark-panel.tsx`
- Create `components/portfolio/performance/segments-panel.tsx`
- Modify `components/portfolio/portfolio-page.tsx`
- Modify/reduce `components/portfolio/portfolio-benchmark-chart.tsx`

### Tests / CI
- Create `tests/portfolio/qeo142-closed-trades.test.ts`
- Create `tests/portfolio/qeo142-scorecard.test.ts`
- Create `tests/portfolio/qeo142-drawdown-episodes.test.ts`
- Create `tests/portfolio/qeo142-ledgers.test.ts`
- Create `tests/portfolio/qeo142-segments.test.ts`
- Create `tests/portfolio/qeo142-benchmark.test.ts`
- Create `tests/portfolio/qeo142-server-api.test.ts`
- Create `tests/portfolio/qeo142-reconciliation.test.ts`
- Create `tests/portfolio/qeo142-performance-ui.test.ts`
- Create `.github/workflows/qeo142-preprod.yml`

---

### Task 1: Canonical closed logical Trade outcome

**Files:**
- Create `modules/portfolio/performance/types.ts`
- Create `modules/portfolio/performance/closed-trades.ts`
- Test `tests/portfolio/qeo142-closed-trades.test.ts`

**Interfaces:**

```ts
export type PerformancePopulation = "live" | "paper" | "combined"

export type PerformanceTradeInput = {
  id: string
  ticker: string
  mode: "live" | "paper"
  status: string
  timeframe: string | null
  system_tags: string[]
  setup_tags: string[]
  initial_risk_amount: number | null
  closed_at: string | null
}

export type PerformanceJournalInput = {
  trade_id: string
  behavior_tags: string[]
}

export type PerformanceStopInput = {
  id: string
  trade_id: string
}

export type PerformanceStopExitLinkInput = {
  stop_event_id: string
  transaction_id: string
  trade_id: string
}

export type ClosedTradeOutcome = {
  tradeId: string
  ticker: string
  mode: "live" | "paper"
  timeframe: string | null
  systemTags: string[]
  setupTags: string[]
  behaviorTags: string[]
  mistakeTags: string[]
  closedAt: string
  grossPnlVnd: number
  totalFeesVnd: number
  netPnlVnd: number
  pnlPercent: number | null
  outcome: "winner" | "loser" | "breakeven"
  rMultiple: number | null
  explicitStopOut: boolean
}

export type ClosedTradeNormalization = {
  outcomes: ClosedTradeOutcome[]
  closedCandidateCount: number
  excludedClosedTradeCount: number
  legacyUngroupedTransactionCount: number
  completeness: "complete" | "partial" | "insufficient"
}

export function deriveClosedTradeOutcomes(input: {
  trades: readonly PerformanceTradeInput[]
  fills: readonly RawTransaction[]
  journalEntries?: readonly PerformanceJournalInput[]
  stopEvents?: readonly PerformanceStopInput[]
  stopExitFillLinks?: readonly PerformanceStopExitLinkInput[]
}): ClosedTradeNormalization
```

- [ ] **Step 1: Write RED tests**

Create tests for:
- one buy + two scale-out sells => one outcome;
- `totalFeesVnd` equals all buy/sell fees;
- `grossPnlVnd === netPnlVnd + totalFeesVnd`;
- gross-positive but net-negative Trade is still `outcome: "loser"`;
- legacy `trade_id=null` increments legacy count but produces no outcome;
- incomplete closed Trade is excluded;
- journal behavior tags and fill mistake tags are unique unions;
- explicit stop-out requires QEO-140 stop-event -> exit-fill evidence.

Representative test:

```ts
test("multi-fill campaign counts once and reconciles gross/fees/net", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [{ id: "t1", ticker: "FPT", mode: "live", status: "closed", timeframe: "swing", system_tags: [], setup_tags: [], initial_risk_amount: 1_000_000, closed_at: "2026-09-05T08:00:00Z" }],
    fills: [
      { id: "b1", trade_id: "t1", ticker: "FPT", action: "buy", quantity: 100, price: 100, fee: 10, transaction_date: "2026-09-01", tags: [] },
      { id: "s1", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 40, price: 110, fee: 4, transaction_date: "2026-09-04", tags: [] },
      { id: "s2", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 60, price: 112, fee: 6, transaction_date: "2026-09-05", tags: [] },
    ],
  })
  assert.equal(result.outcomes.length, 1)
  assert.equal(result.outcomes[0]!.totalFeesVnd, 20_000)
  assert.equal(result.outcomes[0]!.grossPnlVnd, result.outcomes[0]!.netPnlVnd + 20_000)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-closed-trades.test.ts
```

Expected: module-not-found for `performance/closed-trades.ts`.

- [ ] **Step 3: Implement minimal normalization**

For each closed Trade, filter fills by `trade_id` + ticker and call:

```ts
const review = deriveTradeCloseReview({
  status: "closed",
  ticker: trade.ticker,
  fills: linkedFills,
  initialRiskAmountVnd: trade.initial_risk_amount,
})
```

Exclude unavailable reviews. For available reviews:

```ts
const grossPnlVnd = review.netPnlVnd! + review.totalFeesVnd!
```

Sort `closedAt ASC`, then `tradeId ASC`. Never infer legacy grouping.

- [ ] **Step 4: Run GREEN + accounting regression**

```bash
node --test tests/portfolio/qeo142-closed-trades.test.ts tests/portfolio/qeo140-trade-close-review.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/types.ts modules/portfolio/performance/closed-trades.ts tests/portfolio/qeo142-closed-trades.test.ts
git commit -m "feat(qeo-142): normalize closed trade outcomes"
```

---

### Task 2: Scorecard, loss streaks, rolling 25 and Optimal f

**Files:**
- Create `modules/portfolio/performance/scorecard.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-scorecard.test.ts`

**Interfaces:**

```ts
export type MetricValue = {
  value: number | null
  status: "available" | "insufficient"
  reason: string | null
}

export type TradingScorecard = {
  population: PerformancePopulation
  eligibleTradeCount: number
  winnerCount: number
  loserCount: number
  breakevenCount: number
  grossProfitVnd: number
  grossLossVnd: number
  commissionVnd: number
  netPnlVnd: number
  documentedPnlPercent: MetricValue
  winRatioPercent: MetricValue
  payoffRatio: MetricValue
  commissionRatio: MetricValue
  averageWinVnd: MetricValue
  averageLossVnd: MetricValue
  largestWinVnd: MetricValue
  largestLossVnd: MetricValue
  largestConsecutiveLosses: MetricValue
  averageConsecutiveLosses: MetricValue
  rolling25: {
    sampleSize: number
    netPnlVnd: number | null
    status: "positive" | "breakeven" | "negative" | "insufficient"
    isFullWindow: boolean
  }
  optimalF: MetricValue
}

export function buildTradingScorecard(input: {
  outcomes: readonly ClosedTradeOutcome[]
  population: PerformancePopulation
  initialCapitalVnd: number | null
}): TradingScorecard
```

- [ ] **Step 1: Write RED formula tests**

Test exact Win/Payoff/Commission formulas, N/A rules, negative average loss, largest loss, breakeven breaking a loss streak, `[L,L,W,L,L,L] => largest 3 / average 2.5`, rolling latest 25, and `combined` only when requested.

```ts
assert.equal(card.winRatioPercent.value, 50)
assert.equal(card.payoffRatio.value, 2)
assert.equal(card.commissionRatio.value, 200_000 / 2_100_000)
```

Optimal f:

```ts
const expected = (((payoff + 1) * winProbability) - 1) / payoff
```

No valid Payoff => `optimalF.value === null`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-scorecard.test.ts
```

- [ ] **Step 3: Implement formula owner**

Population filter:

```ts
const selected = population === "combined"
  ? [...outcomes]
  : outcomes.filter((row) => row.mode === population)
```

Use gross-P/L sign only for `grossProfitVnd` / `grossLossVnd`; use net-P/L sign for winner/loser metrics. `grossLossVnd` remains negative. `documentedPnlPercent = netPnlVnd / initialCapitalVnd * 100` only when initial capital is positive/finite.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo142-closed-trades.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/scorecard.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-scorecard.test.ts
git commit -m "feat(qeo-142): add deterministic trading scorecard"
```

---

### Task 3: Drawdown episodes over QEO-141 equity points

**Files:**
- Create `modules/portfolio/performance/drawdown.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-drawdown-episodes.test.ts`

**Interfaces:**

```ts
export type DrawdownEpisode = {
  peakKey: string
  startKey: string
  troughKey: string
  recoveryKey: string | null
  peakEquityVnd: number
  troughEquityVnd: number
  depthPercent: number
  recovered: boolean
}

export type DrawdownAnalytics = {
  maxDrawdownPercent: number | null
  averageDrawdownPercent: number | null
  episodes: DrawdownEpisode[]
  completeness: "complete" | "insufficient"
}

export function deriveDrawdownAnalytics(points: readonly EquityPoint[]): DrawdownAnalytics
```

- [ ] **Step 1: Write RED tests**

Curve `100 -> 90 -> 95 -> 105 -> 84 -> 110` must produce episode depths 10% and 20%, max 20%, average 15%. Also test unrecovered final episode, incomplete point => analytics unavailable, and monotonic rising complete curve => max 0 / average N/A.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-drawdown-episodes.test.ts
```

- [ ] **Step 3: Implement one-pass reducer**

Use QEO-141 `EquityPoint`. If any analyzed point is incomplete/null, return `completeness: "insufficient"` and do not silently skip it.

- [ ] **Step 4: Run GREEN + QEO-141 regression**

```bash
node --test tests/portfolio/qeo142-drawdown-episodes.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/drawdown.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-drawdown-episodes.test.ts
git commit -m "feat(qeo-142): derive drawdown episodes"
```

---

### Task 4: Daily/Weekly/Monthly/Annual ledgers

**Files:**
- Create `modules/portfolio/performance/ledgers.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-ledgers.test.ts`

**Interfaces:**

```ts
export type TradingLedgerPeriod = {
  key: string
  tradeCount: number
  winnerCount: number
  loserCount: number
  breakevenCount: number
  grossProfitVnd: number
  grossLossVnd: number
  commissionVnd: number
  netPnlVnd: number
  runningNetPnlVnd: number
  averageWinVnd: number | null
  averageLossVnd: number | null
  largestWinVnd: number | null
  largestLossVnd: number | null
}

export type AccountLedgerPeriod = {
  key: string
  startEquityVnd: number | null
  endEquityVnd: number | null
  returnPercent: number | null
  worstDrawdownPercent: number | null
  completeness: "complete" | "insufficient"
}

export type PeriodLedgerSet = {
  daily: TradingLedgerPeriod[]
  weekly: TradingLedgerPeriod[]
  monthly: TradingLedgerPeriod[]
  annual: TradingLedgerPeriod[]
}

export function buildTradingLedgers(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): PeriodLedgerSet

export function buildAccountLedgers(points: readonly EquityPoint[]): {
  daily: AccountLedgerPeriod[]
  weekly: AccountLedgerPeriod[]
  monthly: AccountLedgerPeriod[]
  annual: AccountLedgerPeriod[]
}
```

- [ ] **Step 1: Write RED timezone/reconciliation tests**

Use:
- `2026-09-06T16:30:00Z` => Sunday 23:30 VN;
- `2026-09-06T17:30:00Z` => Monday 00:30 VN;

They must land in different weekly buckets. Also test one logical Trade counted once, running net P/L, population isolation, baseline as first start anchor, previous complete equity as later start, no point in period => no fabricated account metrics, and incomplete continuity => return/drawdown N/A.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-ledgers.test.ts
```

- [ ] **Step 3: Implement VN-local key helpers**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" })`; do not rely on process timezone.

Account period start = last complete Account Equity point strictly before local period start, baseline for the first analyzable period. End = last point in the period. Current point keys such as `YYYY-MM-DD:current` use their date prefix for period assignment but remain ordered after that day's daily close.

Period drawdown uses the all-time running peak carried from prior history.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-ledgers.test.ts tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/ledgers.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-ledgers.test.ts
git commit -m "feat(qeo-142): add performance ledgers"
```

---

### Task 5: Diagnostic segmentation

**Files:**
- Create `modules/portfolio/performance/segments.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-segments.test.ts`

**Interface:**

```ts
export type PerformanceSegment = {
  dimension: "system" | "setup" | "timeframe" | "mode" | "behavior" | "mistake"
  key: string
  sampleSize: number
  winRatioPercent: number | null
  payoffRatio: number | null
  netPnlVnd: number
  smallSample: boolean
}

export function buildPerformanceSegments(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): PerformanceSegment[]
```

- [ ] **Step 1: Write RED tests**

Test multi-tag membership, mode isolation, `n < 5 => smallSample`, Payoff N/A when a group lacks winner or loser, and deterministic ordering.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-segments.test.ts
```

- [ ] **Step 3: Implement grouping without ratio duplication**

Group outcomes then reuse a Scorecard helper for Win/Payoff math. Do not copy formulas into `segments.ts`.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-segments.test.ts tests/portfolio/qeo142-scorecard.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/segments.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-segments.test.ts
git commit -m "feat(qeo-142): add performance segmentation"
```

---

### Task 6: Canonical portfolio-vs-VNINDEX benchmark normalization

**Files:**
- Create `modules/portfolio/performance/benchmark.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-benchmark.test.ts`

**Interfaces:**

```ts
export type BenchmarkIndexPoint = { date: string; close: number }
export type BenchmarkPoint = {
  date: string
  portfolioReturnPercent: number
  vnindexReturnPercent: number
  alphaPercent: number
}

export type BenchmarkComparison = {
  points: BenchmarkPoint[]
  portfolioReturnPercent: number | null
  vnindexReturnPercent: number | null
  alphaPercent: number | null
  completeness: "complete" | "insufficient"
  reason: string | null
}

export function buildBenchmarkComparison(input: {
  equityPoints: readonly EquityPoint[]
  vnindexPoints: readonly BenchmarkIndexPoint[]
}): BenchmarkComparison
```

- [ ] **Step 1: Write RED tests**

Test first common complete date, separate positive baseline values on that same date, first point returns exactly 0/0/0, incomplete portfolio point ignored as baseline candidate, and no common date => null/N/A rather than 0.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-benchmark.test.ts
```

- [ ] **Step 3: Implement pure date intersection**

Use daily equity points only. No realized-P&L fallback, no AVCO fallback, no zero fill.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-benchmark.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/benchmark.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-benchmark.test.ts
git commit -m "feat(qeo-142): canonicalize benchmark returns"
```

---

### Task 7: Authenticated performance read model and API

**Files:**
- Create `modules/portfolio/performance/server.ts`
- Create `app/api/portfolio/[id]/performance/route.ts`
- Modify `modules/portfolio/performance/types.ts`
- Test `tests/portfolio/qeo142-server-api.test.ts`

**Interface:**

```ts
export type PerformanceReadModel = {
  scorecards: { live: TradingScorecard; paper: TradingScorecard; combined: TradingScorecard }
  tradingLedgers: { live: PeriodLedgerSet; paper: PeriodLedgerSet; combined: PeriodLedgerSet }
  accountLedgers: { daily: AccountLedgerPeriod[]; weekly: AccountLedgerPeriod[]; monthly: AccountLedgerPeriod[]; annual: AccountLedgerPeriod[] }
  equity: {
    points: EquityPoint[]
    accountTotalReturnPercent: number | null
    maxDrawdownPercent: number | null
    averageDrawdownPercent: number | null
    episodes: DrawdownEpisode[]
    completeness: "complete" | "insufficient"
  }
  benchmark: BenchmarkComparison
  segments: { live: PerformanceSegment[]; paper: PerformanceSegment[]; combined: PerformanceSegment[] }
  evidence: {
    eligibleTradeCount: number
    excludedClosedTradeCount: number
    legacyUngroupedTransactionCount: number
    tradeGroupingCompleteness: "complete" | "partial" | "insufficient"
    equityCompleteness: "complete" | "insufficient"
  }
}

export async function getPortfolioPerformanceContext(
  context: ServerAuthContext,
  portfolioId: string,
  now?: Date,
): Promise<PerformanceReadModel>
```

- [ ] **Step 1: Write RED static boundary test**

Assert `server.ts` owns queries for:
- `portfolios`;
- `portfolio_transactions`;
- `portfolio_trades`;
- `portfolio_trade_journal_entries`;
- `portfolio_trade_stop_events`;
- `portfolio_trade_stop_exit_fills`;
- `market_ohlcv_raw_daily`.

Assert it imports `buildEquityCurve`, `deriveClosedTradeOutcomes`, `buildTradingScorecard`, `deriveDrawdownAnalytics`, `buildTradingLedgers`, `buildAccountLedgers`, `buildPerformanceSegments`, `buildBenchmarkComparison`.

Assert route has `requireApiUser`, `force-dynamic`, `private, no-store` and no `.from(`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-server-api.test.ts
```

- [ ] **Step 3: Implement owned data assembly**

Load exact portfolio scope. Transaction select includes `mistake_tags`; Trade select includes `mode,status,timeframe,system_tags,setup_tags,initial_risk_amount,closed_at`. Journal select includes `behavior_tags`. RAW Daily rows must satisfy `price_basis = RAW` and `source_price_unit = VND_THOUSANDS`.

Build Account Equity with QEO-141 `buildEquityCurve()` from initial capital + all accounting transactions + RAW Daily/current marks. Do not duplicate its math.

Fetch VNINDEX using the current provider boundary. Provider failure sets `benchmark.completeness = "insufficient"` but does not fail Scorecard/ledgers.

- [ ] **Step 4: Implement thin route**

```ts
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params
  const performance = await getPortfolioPerformanceContext(auth.context, id)
  return NextResponse.json({ ok: true, performance }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}
```

Use existing NOT_FOUND/API error conventions; do not expose DB error details.

- [ ] **Step 5: Run GREEN + shared regressions**

```bash
node --test tests/portfolio/qeo142-server-api.test.ts tests/portfolio/qeo142-closed-trades.test.ts tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo142-drawdown-episodes.test.ts tests/portfolio/qeo142-ledgers.test.ts tests/portfolio/qeo142-segments.test.ts tests/portfolio/qeo142-benchmark.test.ts tests/portfolio/qeo141-server-api.test.ts tests/portfolio-pnl.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/performance app/api/portfolio/[id]/performance/route.ts tests/portfolio/qeo142-server-api.test.ts
git commit -m "feat(qeo-142): expose canonical performance read model"
```

---

### Task 8: Reconcile QEO-138/QEO-139 and legacy benchmark API

**Files:**
- Modify `modules/portfolio/risk-plan/evidence.ts`
- Modify `modules/portfolio/risk-plan/server.ts`
- Modify `app/api/portfolio/[id]/benchmark/route.ts`
- Test `tests/portfolio/qeo142-reconciliation.test.ts`
- Regression `tests/portfolio/qeo138-risk-profile-evidence.test.ts`
- Regression `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`

**QEO-138 contract:** `buildRiskProfileEvidence()` keeps its current output shape, but Win Ratio and Payoff Ratio come from QEO-142 canonical outcome/Scorecard functions. `activeReturn12m` remains unchanged in this issue.

- [ ] **Step 1: Write RED reconciliation tests**

Assert:
- QEO-138 Win/Payoff equal `buildTradingScorecard(... population: "combined")` for the same eligible Trade set;
- incomplete closed Trades are excluded identically;
- `risk-plan/evidence.ts` no longer contains independent winner/loser arithmetic after GREEN;
- benchmark route delegates to `getPortfolioPerformanceContext` and contains no `computePortfolioPositions`, direct transaction query or direct VNINDEX provider call;
- unavailable benchmark returns null metrics, not fake zero.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-reconciliation.test.ts
```

- [ ] **Step 3: Expand QEO-138 server evidence select**

Change closed Trade select from the current minimal fields to:

```ts
.select("id,ticker,mode,status,timeframe,system_tags,setup_tags,initial_risk_amount,closed_at")
```

Keep fills linked by non-null `trade_id`; include `mistake_tags` if the canonical normalizer needs the same field set. Do not fabricate a missing mode.

- [ ] **Step 4: Replace QEO-138 duplicate Win/Payoff implementation**

`buildRiskProfileEvidence()` constructs canonical closed outcomes from its Trade/fill inputs and calls `buildTradingScorecard({ population: "combined", initialCapitalVnd: null })`. Map value/sample/completeness into existing `ProfileMetricEvidence`. Keep `activeReturn12m.source = "unavailable"` until its existing contract is separately changed.

Update QEO-138 test fixtures to provide the now-required canonical Trade metadata (`mode`, nullable timeframe, tags, initial risk) rather than inventing defaults in production code.

- [ ] **Step 5: Make `/benchmark` a compatibility adapter**

Call `getPortfolioPerformanceContext()` once. Preserve compatibility keys:

```ts
{
  ok: true,
  dataPoints: performance.benchmark.points.map((p) => ({
    date: p.date,
    portfolioReturnPct: p.portfolioReturnPercent,
    vnindexReturnPct: p.vnindexReturnPercent,
  })),
  portfolioReturnPct: performance.benchmark.portfolioReturnPercent,
  vnindexReturnPct: performance.benchmark.vnindexReturnPercent,
  alphaPct: performance.benchmark.alphaPercent,
  completeness: performance.benchmark.completeness,
}
```

- [ ] **Step 6: Run GREEN + QEO-138/QEO-139 regressions**

```bash
node --test tests/portfolio/qeo142-reconciliation.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo141-reconciliation.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio/risk-plan/evidence.ts modules/portfolio/risk-plan/server.ts app/api/portfolio/[id]/benchmark/route.ts tests/portfolio/qeo142-reconciliation.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts
git commit -m "refactor(qeo-142): reconcile performance evidence consumers"
```

---

### Task 9: `Hiệu suất` dashboard

**Files:**
- Create `components/portfolio/performance/terminology.ts`
- Create `components/portfolio/performance/use-performance.ts`
- Create `components/portfolio/performance/performance-dashboard.tsx`
- Create `components/portfolio/performance/trading-scorecard.tsx`
- Create `components/portfolio/performance/equity-drawdown-panel.tsx`
- Create `components/portfolio/performance/performance-ledger.tsx`
- Create `components/portfolio/performance/benchmark-panel.tsx`
- Create `components/portfolio/performance/segments-panel.tsx`
- Modify `components/portfolio/portfolio-page.tsx`
- Modify/reduce `components/portfolio/portfolio-benchmark-chart.tsx`
- Test `tests/portfolio/qeo142-performance-ui.test.ts`

**Hook interface:**

```ts
export function usePortfolioPerformance(portfolioId: string | null): {
  data: PerformanceReadModel | null
  loading: boolean
  error: string | null
  refresh: () => void
}
```

- [ ] **Step 1: Write RED UI contract**

Assert:
- `activeTab === "benchmark"` renders `PortfolioPerformanceDashboard`;
- only `use-performance.ts` fetches `/api/portfolio/${portfolioId}/performance`;
- client code contains no Scorecard arithmetic;
- visible population controls are `Thực tế | Mô phỏng | Kết hợp`;
- period controls are `Ngày | Tuần | Tháng | Năm`;
- dashboard sections appear in spec order;
- null metrics display `N/A` / `Không đủ dữ liệu`, not 0;
- small-sample warning exists;
- UI states that Account Equity/Drawdown/benchmark are portfolio-wide even when Trade statistics are filtered;
- tooltips cover canonical English/source terms and formulas.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-performance-ui.test.ts
```

- [ ] **Step 3: Implement terminology**

Example:

```ts
winRatio: {
  labelVi: "Tỷ lệ thắng",
  labelEn: "Win Ratio",
  formula: "Winning Closed Trades / Eligible Closed Trades",
  helpVi: "Đếm Trade logic đã đóng, không đếm từng fill. Mẫu nhỏ không chứng minh hệ thống có lợi thế.",
},
commissionRatio: {
  labelVi: "Tỷ lệ phí giao dịch",
  labelEn: "Commission Ratio",
  formula: "Total Commission / Gross Profit",
  helpVi: "Không áp dụng khi Gross Profit không dương.",
}
```

Optimal f help must say aggressive/informational and never auto-change the risk setting.

- [ ] **Step 4: Implement one-fetch dashboard**

Section order:
1. Trading Scorecard
2. Account Equity & Drawdown
3. Period Ledger
4. Benchmark vs VN-Index
5. Segmentation
6. Advanced Optimal f

Trade population selector controls Scorecard/trading ledger/segments only. Account metrics/benchmark remain unchanged.

- [ ] **Step 5: Remove benchmark component's internal fetch ownership**

Either make `portfolio-benchmark-chart.tsx` presentational from props or replace it with `benchmark-panel.tsx`. The tab must have one canonical performance fetch.

- [ ] **Step 6: Run GREEN + UI regressions**

```bash
node --test tests/portfolio/qeo142-performance-ui.test.ts tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add components/portfolio/performance components/portfolio/portfolio-page.tsx components/portfolio/portfolio-benchmark-chart.tsx tests/portfolio/qeo142-performance-ui.test.ts
git commit -m "feat(qeo-142): rebuild performance tab around canonical scorecard"
```

---

### Task 10: QEO-142 dedicated pre-production gate

**Files:**
- Create `.github/workflows/qeo142-preprod.yml`

- [ ] **Step 1: Add workflow paths**

Trigger for changes to performance modules, risk-plan/risk-engine/trades/pnl dependencies, portfolio performance UI, performance/benchmark API routes, QEO-142 tests and the workflow itself.

- [ ] **Step 2: Run these gates in order**

```yaml
- run: node --test tests/portfolio/qeo142-closed-trades.test.ts
- run: node --test tests/portfolio/qeo142-scorecard.test.ts
- run: node --test tests/portfolio/qeo142-drawdown-episodes.test.ts
- run: node --test tests/portfolio/qeo142-ledgers.test.ts
- run: node --test tests/portfolio/qeo142-segments.test.ts
- run: node --test tests/portfolio/qeo142-benchmark.test.ts
- run: node --test tests/portfolio/qeo142-server-api.test.ts
- run: node --test tests/portfolio/qeo142-reconciliation.test.ts
- run: node --test tests/portfolio/qeo142-performance-ui.test.ts
- run: node --test tests/portfolio/qeo138-risk-profile-evidence.test.ts
- run: node --test tests/portfolio-pnl.test.ts
- run: pnpm test:current:manifest
- run: pnpm lint
- run: pnpm typecheck
- run: pnpm build
```

Add explicit existing QEO-139/QEO-141 tests to the workflow rather than relying on shell globs if necessary.

- [ ] **Step 3: Open draft PR**

PR body links QEO-142, spec and plan, says `No DB migration`, explains benchmark semantic correction and identifies legacy completeness behavior.

- [ ] **Step 4: Final diff audit**

Reject unexpected changes to Supabase migrations, `pnl.ts` accounting semantics, QEO-141 Active Risk/Risk State formulas or unrelated portfolio/watchlist theme code.

- [ ] **Step 5: Require exact-head release gates**

Fresh GREEN before merge:
- QEO-142 dedicated workflow;
- Verify;
- QEO-137 if triggered;
- QEO-138;
- QEO-139;
- QEO-141;
- production build on exact PR head.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/qeo142-preprod.yml
git commit -m "ci(qeo-142): add performance preprod gate"
```

---

## Post-merge production acceptance

1. Confirm merged `main` SHA.
2. Confirm Vercel Git deployment uses exactly that SHA; do not manually deploy if Git integration works.
3. Require `READY`, alias `qeoindex.qeoqeo.com`, `aliasError = null`.
4. Smoke `/portfolio` for HTTP 200/title/auth shell.
5. Check runtime error clusters for `/portfolio`, performance API and benchmark API when traffic exists.
6. Do not claim authenticated visual interaction without an authenticated session.
7. Append exact-head CI, merge SHA and deployment evidence to Linear QEO-142.
8. Mark QEO-142 Done only after acceptance; QEO-143 is next in dependency chain.
