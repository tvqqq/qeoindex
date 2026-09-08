# QEO-142 Canonical Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical performance engine for closed logical Trade Scorecard metrics, period ledgers, Account Equity/Drawdown analytics, VN-Index benchmark comparison and diagnostics, then make QEO-138/QEO-139 and the `Hiệu suất` UI consume those same facts.

**Architecture:** Create `modules/portfolio/performance/` as a derived, on-demand analytics subsystem. Pure modules normalize closed Trade outcomes, compute Scorecards, drawdown episodes, period ledgers, segmentation and benchmark normalization; `server.ts` is the only performance-layer data-access boundary. QEO-141 remains the owner of Account Equity construction; QEO-140 close review/AVCO remains accounting truth; no analytics snapshot table is added.

**Tech Stack:** Next.js App Router, TypeScript, Node `node:test`, Supabase/Postgres read APIs, existing VN-Index provider, pnpm/GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-142-performance-scorecard-design.md`

## Global Constraints

- No database migration or persisted performance aggregate in QEO-142.
- `portfolio_transactions` + `computePortfolioPositions()` remain canonical accounting/AVCO/P&L.
- `deriveTradeCloseReview()` remains the closed-Trade fee/net-P&L audit boundary.
- Scorecard Trade count uses closed logical Trades, never raw fill count.
- Legacy `trade_id = null` transactions can affect Account Equity but never silently become Scorecard Trades.
- Winner/loser classification uses net P/L after fees; Gross Profit/Loss uses gross P/L before fees for Commission Ratio reconciliation.
- Empty/insufficient statistics are `null` + explicit completeness/reason, not fake zero.
- QEO-141 `buildEquityCurve()` / Account Equity completeness semantics are reused; incomplete historical marks fail closed.
- `live | paper | combined` are explicit Trade populations. `combined` is never implicit.
- Account Equity/Drawdown/benchmark remain portfolio-wide because there is no independent live/paper account-capital model.
- Period assignment uses `Asia/Ho_Chi_Minh`; week is Monday through Sunday.
- Existing VN-Index benchmark capability remains, but portfolio return must stop using realized-P&L / remaining-cost-basis semantics.
- UI is Vietnamese-primary; canonical English/source terms and exact formulas live in tooltip/help metadata.
- No AI advice, no automatic risk-setting change, no exact Risk-of-Ruin probability table.
- If implementation requires new persisted schema, stop and return to architectural approval.

---

## File map

### Performance domain

- `modules/portfolio/performance/types.ts` — typed read model and pure-domain contracts.
- `modules/portfolio/performance/closed-trades.ts` — canonical eligible closed logical Trade normalization.
- `modules/portfolio/performance/scorecard.ts` — Scorecard formulas, loss streaks, rolling 25, Optimal f.
- `modules/portfolio/performance/drawdown.ts` — drawdown episode extraction over QEO-141 equity points.
- `modules/portfolio/performance/ledgers.ts` — VN-local Daily/Weekly/Monthly/Annual Trade/account period derivation.
- `modules/portfolio/performance/segments.ts` — deterministic tag/timeframe/mode segmentation.
- `modules/portfolio/performance/benchmark.ts` — first-common-date portfolio/VN-Index normalization.
- `modules/portfolio/performance/server.ts` — authenticated Supabase/provider assembly and typed read model.

### API / integrations

- `app/api/portfolio/[id]/performance/route.ts` — thin authenticated no-store performance endpoint.
- `app/api/portfolio/[id]/benchmark/route.ts` — compatibility adapter over canonical performance benchmark output.
- `modules/portfolio/risk-plan/evidence.ts` — replace duplicate Win/Payoff arithmetic with performance Scorecard core.

### UI

- `components/portfolio/performance/terminology.ts` — Vietnamese labels + canonical English/formula help.
- `components/portfolio/performance/use-performance.ts` — one fetch to `/performance`.
- `components/portfolio/performance/performance-dashboard.tsx` — section composition and population/ledger controls.
- `components/portfolio/performance/trading-scorecard.tsx` — Scorecard cards and incomplete-state notices.
- `components/portfolio/performance/equity-drawdown-panel.tsx` — Account Equity/Drawdown chart and metrics.
- `components/portfolio/performance/performance-ledger.tsx` — period table.
- `components/portfolio/performance/benchmark-panel.tsx` — canonical benchmark chart presentation.
- `components/portfolio/performance/segments-panel.tsx` — segment metrics + small-sample badges.
- `components/portfolio/portfolio-page.tsx` — replace benchmark-only surface with performance dashboard.
- `components/portfolio/portfolio-benchmark-chart.tsx` — retire internal fetch/formula ownership or reduce to a presentational compatibility wrapper.

### Tests / CI

- `tests/portfolio/qeo142-closed-trades.test.ts`
- `tests/portfolio/qeo142-scorecard.test.ts`
- `tests/portfolio/qeo142-drawdown-episodes.test.ts`
- `tests/portfolio/qeo142-ledgers.test.ts`
- `tests/portfolio/qeo142-segments.test.ts`
- `tests/portfolio/qeo142-benchmark.test.ts`
- `tests/portfolio/qeo142-server-api.test.ts`
- `tests/portfolio/qeo142-reconciliation.test.ts`
- `tests/portfolio/qeo142-performance-ui.test.ts`
- `.github/workflows/qeo142-preprod.yml`

---

### Task 1: Canonical closed logical Trade outcome normalization

**Files:**
- Create: `modules/portfolio/performance/types.ts`
- Create: `modules/portfolio/performance/closed-trades.ts`
- Test: `tests/portfolio/qeo142-closed-trades.test.ts`

**Interfaces:**

`types.ts` defines:

```ts
export type PerformancePopulation = "live" | "paper" | "combined"

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
```

`closed-trades.ts` exports:

```ts
export function deriveClosedTradeOutcomes(input: {
  trades: readonly PerformanceTradeInput[]
  fills: readonly RawTransaction[]
  journalEntries?: readonly PerformanceJournalInput[]
  stopEvents?: readonly PerformanceStopInput[]
  stopExitFillLinks?: readonly PerformanceStopExitLinkInput[]
}): ClosedTradeNormalization
```

The function must call `deriveTradeCloseReview()` for each closed Trade. It may aggregate tags/evidence, but it must not duplicate fee/P&L arithmetic.

- [ ] **Step 1: Write the failing normalization tests**

Create `tests/portfolio/qeo142-closed-trades.test.ts` with fixtures covering multi-fill close, fees, excluded malformed closed Trade, legacy fill, tags and mode:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { deriveClosedTradeOutcomes } from "../../modules/portfolio/performance/closed-trades.ts"

test("multi-fill closed campaign becomes one canonical outcome and reconciles gross/fees/net", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [{
      id: "t1", ticker: "FPT", mode: "live", status: "closed",
      timeframe: "swing", system_tags: ["trend"], setup_tags: ["breakout"],
      initial_risk_amount: 1_000_000, closed_at: "2026-09-05T08:00:00Z",
    }],
    fills: [
      { id: "b1", trade_id: "t1", ticker: "FPT", action: "buy", quantity: 100, price: 100, fee: 10, transaction_date: "2026-09-01", tags: [] },
      { id: "s1", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 40, price: 110, fee: 4, transaction_date: "2026-09-04", tags: [] },
      { id: "s2", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 60, price: 112, fee: 6, transaction_date: "2026-09-05", tags: [] },
    ],
  })
  assert.equal(result.outcomes.length, 1)
  assert.equal(result.outcomes[0]!.totalFeesVnd, 20_000)
  assert.equal(result.outcomes[0]!.grossPnlVnd, result.outcomes[0]!.netPnlVnd + 20_000)
  assert.equal(result.outcomes[0]!.outcome, "winner")
})

test("legacy ungrouped fills affect completeness but do not become a Trade outcome", () => {
  const result = deriveClosedTradeOutcomes({ trades: [], fills: [
    { id: "legacy", trade_id: null, ticker: "HPG", action: "sell", quantity: 10, price: 30, fee: 1, transaction_date: "2026-09-05", tags: [] },
  ] })
  assert.equal(result.outcomes.length, 0)
  assert.equal(result.legacyUngroupedTransactionCount, 1)
  assert.equal(result.completeness, "insufficient")
})
```

Add a test where `grossPnlVnd > 0` but fees make `netPnlVnd < 0`; assert `outcome === "loser"` while gross P/L remains positive.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-closed-trades.test.ts
```

Expected: FAIL with module-not-found for `performance/closed-trades.ts`.

- [ ] **Step 3: Implement minimal normalization**

For every `status === "closed"` Trade:

```ts
const review = deriveTradeCloseReview({
  status: "closed",
  ticker: trade.ticker,
  fills: linkedFills,
  initialRiskAmountVnd: finiteOrNull(trade.initial_risk_amount),
})
if (review.status !== "available" || review.netPnlVnd == null || review.totalFeesVnd == null) {
  excludedClosedTradeCount += 1
  continue
}
const grossPnlVnd = review.netPnlVnd + review.totalFeesVnd
```

Sort outcomes by `closedAt ASC`, then `tradeId ASC`. `explicitStopOut` is true only when at least one QEO-140 stop-exit link points to a linked sell fill for the same Trade. Behavior tags are the unique union of journal `behavior_tags`; mistake tags are unique union of linked fill `mistake_tags` when present.

- [ ] **Step 4: Run GREEN + close-review regression**

```bash
node --test tests/portfolio/qeo142-closed-trades.test.ts tests/portfolio/qeo140-trade-close-review.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/types.ts modules/portfolio/performance/closed-trades.ts tests/portfolio/qeo142-closed-trades.test.ts
git commit -m "feat(qeo-142): normalize closed trade performance outcomes"
```

---

### Task 2: Trading Scorecard formulas, streaks, rolling 25 and Optimal f

**Files:**
- Create: `modules/portfolio/performance/scorecard.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-scorecard.test.ts`

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

- [ ] **Step 1: Write failing Scorecard tests**

Cover exact formulas and edge states:

```ts
test("Win, Payoff and Commission Ratio use canonical closed Trade population", () => {
  const card = buildTradingScorecard({
    population: "live",
    initialCapitalVnd: 100_000_000,
    outcomes: [
      outcome({ tradeId: "1", mode: "live", netPnlVnd: 2_000_000, totalFeesVnd: 100_000, grossPnlVnd: 2_100_000, outcome: "winner" }),
      outcome({ tradeId: "2", mode: "live", netPnlVnd: -1_000_000, totalFeesVnd: 100_000, grossPnlVnd: -900_000, outcome: "loser" }),
    ],
  })
  assert.equal(card.winRatioPercent.value, 50)
  assert.equal(card.payoffRatio.value, 2)
  assert.equal(card.commissionRatio.value, 200_000 / 2_100_000)
  assert.equal(card.netPnlVnd, 1_000_000)
})
```

Also test:
- zero eligible Trades ⇒ ratios `null`, not 0;
- no loser ⇒ Payoff Ratio insufficient, not Infinity;
- gross profit <= 0 ⇒ Commission Ratio insufficient;
- breakeven breaks a loss streak;
- runs `[L,L,W,L,L,L]` ⇒ largest 3, average 2.5;
- fewer than 25 Trades gives valid rolling sample with `isFullWindow: false`;
- exactly 30 Trades uses only latest 25;
- `combined` includes both modes only when explicitly requested;
- Optimal f formula exact and unavailable without valid Win/Payoff.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-scorecard.test.ts
```

Expected: FAIL because `scorecard.ts` does not exist.

- [ ] **Step 3: Implement formulas only from `ClosedTradeOutcome[]`**

Population filter:

```ts
const selected = population === "combined"
  ? [...outcomes]
  : outcomes.filter((row) => row.mode === population)
```

Gross aggregates classify by `grossPnlVnd` sign; winner/loser arrays classify by `netPnlVnd` sign. `averageLossVnd` remains negative. All money fields remain integer VND.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo142-closed-trades.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/scorecard.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-scorecard.test.ts
git commit -m "feat(qeo-142): add deterministic trading scorecard"
```

---

### Task 3: Drawdown episode analytics over QEO-141 Account Equity

**Files:**
- Create: `modules/portfolio/performance/drawdown.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-drawdown-episodes.test.ts`

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

- [ ] **Step 1: Write failing episode tests**

Test a complete curve `100 → 90 → 95 → 105 → 84 → 110` and assert:
- episode 1 peak 100, depth 10%, recovery at 105;
- episode 2 peak 105, depth 20%, recovery at 110;
- Max Drawdown 20%; Average Drawdown 15%.

Also test:
- unrecovered final episode is included;
- one incomplete point makes Max/Average unavailable and episodes empty;
- monotonically rising complete series ⇒ Max Drawdown 0 and Average Drawdown unavailable.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-drawdown-episodes.test.ts
```

Expected: FAIL module-not-found.

- [ ] **Step 3: Implement one-pass peak/episode reducer**

Use QEO-141 `EquityPoint` directly. Do not interpolate or skip incomplete points. A new all-time high ends/recoveries the current episode and becomes the next peak.

- [ ] **Step 4: Run GREEN + QEO-141 drawdown regression**

```bash
node --test tests/portfolio/qeo142-drawdown-episodes.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/drawdown.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-drawdown-episodes.test.ts
git commit -m "feat(qeo-142): derive account drawdown episodes"
```

---

### Task 4: VN-local Daily/Weekly/Monthly/Annual trading and account ledgers

**Files:**
- Create: `modules/portfolio/performance/ledgers.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-ledgers.test.ts`

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

export function buildTradingLedgers(outcomes: readonly ClosedTradeOutcome[], population: PerformancePopulation): PeriodLedgerSet
export function buildAccountLedgers(points: readonly EquityPoint[]): {
  daily: AccountLedgerPeriod[]
  weekly: AccountLedgerPeriod[]
  monthly: AccountLedgerPeriod[]
  annual: AccountLedgerPeriod[]
}
```

- [ ] **Step 1: Write failing calendar/ledger tests**

Use timestamps around VN midnight and a Sunday/Monday boundary:

```ts
test("weekly Trade assignment is Monday-Sunday in Asia/Ho_Chi_Minh", () => {
  const ledgers = buildTradingLedgers([
    outcome({ tradeId: "sun", closedAt: "2026-09-06T16:30:00Z" }), // 23:30 Sunday VN
    outcome({ tradeId: "mon", closedAt: "2026-09-06T17:30:00Z" }), // 00:30 Monday VN
  ], "live")
  assert.equal(ledgers.weekly.length, 2)
})
```

Also assert:
- one multi-fill outcome counts once;
- running net P/L is deterministic across periods;
- `live`, `paper`, `combined` never mix unexpectedly;
- first analyzable account period uses baseline as start;
- later period start uses last complete point strictly before period start;
- no point inside period ⇒ no fabricated account metrics;
- incomplete point between start anchor and end makes return/drawdown unavailable;
- running-peak drawdown carries the prior all-time peak into the period.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-ledgers.test.ts
```

Expected: FAIL module-not-found.

- [ ] **Step 3: Implement period-key helpers without locale-dependent parsing**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" })` to obtain local calendar parts. Compute Monday keys deterministically from those parts. Do not rely on server local timezone.

Account ledgers operate only on the ordered QEO-141 equity points. Baseline is an anchor, not a dated period entry.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-ledgers.test.ts tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/ledgers.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-ledgers.test.ts
git commit -m "feat(qeo-142): add deterministic performance ledgers"
```

---

### Task 5: Diagnostic segmentation with sample-size evidence

**Files:**
- Create: `modules/portfolio/performance/segments.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-segments.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Write failing segmentation tests**

Assert:
- one Trade with two setup tags appears in two setup segments;
- segment totals are not assumed additive;
- population filtering is applied before segmentation;
- `n < 5` sets `smallSample: true`;
- Payoff Ratio is null when a segment lacks a winner or loser;
- ordering is deterministic by dimension then key.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-segments.test.ts
```

Expected: FAIL module-not-found.

- [ ] **Step 3: Implement segmentation by feeding each group through the same Scorecard primitive**

Do not copy Win/Payoff formulas into `segments.ts`. Group Trade IDs, then call a scorecard helper exported from `scorecard.ts` for ratio math.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-segments.test.ts tests/portfolio/qeo142-scorecard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/segments.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-segments.test.ts
git commit -m "feat(qeo-142): add performance segmentation"
```

---

### Task 6: Canonical Account Equity vs VN-Index benchmark normalization

**Files:**
- Create: `modules/portfolio/performance/benchmark.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-benchmark.test.ts`

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

- [ ] **Step 1: Write failing benchmark tests**

Assert:
- baseline is the first common date where portfolio equity and VN-Index are both positive finite and portfolio point is complete;
- each curve uses its own baseline value on that shared date;
- first point is exactly `0/0/0` return/alpha;
- no common complete date ⇒ values null + insufficient;
- incomplete portfolio point is not silently used;
- result ordering is chronological.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-benchmark.test.ts
```

Expected: FAIL module-not-found.

- [ ] **Step 3: Implement pure date intersection and normalization**

Use daily equity points only (`kind === "daily"`); current intraday point is not benchmark-aligned unless the provider supplies that same date and the server explicitly includes it later. No zero fill and no realized-P&L fallback.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo142-benchmark.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/performance/benchmark.ts modules/portfolio/performance/types.ts tests/portfolio/qeo142-benchmark.test.ts
git commit -m "feat(qeo-142): canonicalize portfolio benchmark returns"
```

---

### Task 7: Authenticated performance server/read model and thin API

**Files:**
- Create: `modules/portfolio/performance/server.ts`
- Create: `app/api/portfolio/[id]/performance/route.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Test: `tests/portfolio/qeo142-server-api.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Write failing static/server contract tests**

`tests/portfolio/qeo142-server-api.test.ts` must assert source boundaries:

```ts
assert.match(serverSource, /from\("portfolio_trades"\)/)
assert.match(serverSource, /from\("portfolio_transactions"\)/)
assert.match(serverSource, /from\("portfolio_trade_journal_entries"\)/)
assert.match(serverSource, /from\("portfolio_trade_stop_events"\)/)
assert.match(serverSource, /from\("portfolio_trade_stop_exit_fills"\)/)
assert.match(serverSource, /from\("market_ohlcv_raw_daily"\)/)
assert.match(serverSource, /buildEquityCurve/)
assert.match(serverSource, /deriveClosedTradeOutcomes/)
assert.match(serverSource, /buildTradingScorecard/)
assert.match(serverSource, /buildBenchmarkComparison/)
assert.doesNotMatch(routeSource, /\.from\(/)
assert.match(routeSource, /requireApiUser/)
assert.match(routeSource, /getPortfolioPerformanceContext/)
assert.match(routeSource, /force-dynamic/)
assert.match(routeSource, /no-store/)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-server-api.test.ts
```

Expected: FAIL because server/route do not exist.

- [ ] **Step 3: Implement server assembly**

Load in owned portfolio scope:
- `portfolios(id,user_id,initial_capital)`;
- all `portfolio_transactions` fields required by AVCO + tags/mistake tags;
- closed/open `portfolio_trades` fields required by normalization (`mode`, `status`, `timeframe`, system/setup tags, initial risk, closed_at);
- journal `behavior_tags`;
- stop events and stop-exit links for explicit stop-out evidence;
- RAW Daily `ticker,session_date,close,source_price_unit,price_basis` from earliest transaction through VN current date.

Build the same QEO-141 equity curve using `buildEquityCurve()` and RAW-only `VND_THOUSANDS` marks. Fetch VN-Index daily candles with the existing provider boundary; provider failure must produce benchmark `insufficient`, not fail Scorecard/ledgers.

Do not call `/risk` over HTTP from server code; reuse pure QEO-141 equity primitives directly.

- [ ] **Step 4: Implement thin API route**

`GET` only:

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

Map portfolio-not-found to the existing 404 convention; unexpected DB read failures remain 500-safe and must not leak DB details.

- [ ] **Step 5: Run GREEN + portfolio regressions**

```bash
node --test tests/portfolio/qeo142-server-api.test.ts tests/portfolio/qeo142-closed-trades.test.ts tests/portfolio/qeo142-scorecard.test.ts tests/portfolio/qeo142-drawdown-episodes.test.ts tests/portfolio/qeo142-ledgers.test.ts tests/portfolio/qeo142-segments.test.ts tests/portfolio/qeo142-benchmark.test.ts tests/portfolio/qeo141-server-api.test.ts tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/performance app/api/portfolio/[id]/performance/route.ts tests/portfolio/qeo142-server-api.test.ts
git commit -m "feat(qeo-142): expose canonical performance read model"
```

---

### Task 8: Reconcile benchmark compatibility and QEO-138/QEO-139 evidence

**Files:**
- Modify: `app/api/portfolio/[id]/benchmark/route.ts`
- Modify: `modules/portfolio/risk-plan/evidence.ts`
- Test: `tests/portfolio/qeo142-reconciliation.test.ts`
- Regression: `tests/portfolio/qeo138-risk-profile-evidence.test.ts`
- Regression: `tests/portfolio/qeo139-risk-sizing-server-api.test.ts`

**Interfaces:**

`risk-plan/evidence.ts` keeps its public `buildRiskProfileEvidence(...)` shape but must obtain Win Ratio and Payoff Ratio from the same QEO-142 closed-outcome/Scorecard functions. `activeReturn12m` remains governed by its existing evidence contract unless the complete Account Equity history is explicitly passed through a future interface; do not silently change that field in this task.

The legacy benchmark route keeps its current JSON compatibility keys:

```ts
{
  ok: true,
  dataPoints: Array<{ date: string; portfolioReturnPct: number; vnindexReturnPct: number }>,
  portfolioReturnPct: number | null,
  vnindexReturnPct: number | null,
  alphaPct: number | null,
  completeness: "complete" | "insufficient"
}
```

It must delegate to canonical performance data rather than own transaction/provider formula code.

- [ ] **Step 1: Write failing reconciliation tests**

Assert:
- QEO-138 Win Ratio/Payoff exactly equal `buildTradingScorecard(..., "combined")` over the same eligible population;
- malformed closed Trade exclusion count does not silently change between QEO-138 and QEO-142;
- `/benchmark` route source contains `getPortfolioPerformanceContext` and does not contain `computePortfolioPositions`, direct `.from("portfolio_transactions")`, or `fetchDnseIndexCandleHistory`;
- benchmark unavailable state returns null metrics, not 0;
- QEO-139 source still consumes QEO-138 evidence/risk context without a new formula fork.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-reconciliation.test.ts
```

Expected: FAIL because QEO-138 and benchmark still own their older calculations.

- [ ] **Step 3: Refactor QEO-138 evidence to canonical Scorecard core**

Extract/construct canonical closed outcomes with the same Trade/fill eligibility rules and call `buildTradingScorecard({ population: "combined", ... })`. Map the canonical values into QEO-138 `ProfileMetricEvidence` with its existing period/sample/provenance fields.

No Win/Payoff arithmetic remains in `risk-plan/evidence.ts` after this task.

- [ ] **Step 4: Replace benchmark route body with compatibility mapping**

Call `getPortfolioPerformanceContext()` once and map `performance.benchmark.points`. Do not fetch transactions or VN-Index separately in the route.

- [ ] **Step 5: Run GREEN + QEO-138/QEO-139 regressions**

```bash
node --test tests/portfolio/qeo142-reconciliation.test.ts tests/portfolio/qeo138-risk-profile-evidence.test.ts tests/portfolio/qeo139-risk-sizing-server-api.test.ts tests/portfolio/qeo139-risk-projection.test.ts tests/portfolio/qeo141-reconciliation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/portfolio/[id]/benchmark/route.ts modules/portfolio/risk-plan/evidence.ts tests/portfolio/qeo142-reconciliation.test.ts
git commit -m "refactor(qeo-142): reconcile performance evidence consumers"
```

---

### Task 9: `Hiệu suất` performance dashboard with Vietnamese-primary terminology

**Files:**
- Create: `components/portfolio/performance/terminology.ts`
- Create: `components/portfolio/performance/use-performance.ts`
- Create: `components/portfolio/performance/performance-dashboard.tsx`
- Create: `components/portfolio/performance/trading-scorecard.tsx`
- Create: `components/portfolio/performance/equity-drawdown-panel.tsx`
- Create: `components/portfolio/performance/performance-ledger.tsx`
- Create: `components/portfolio/performance/benchmark-panel.tsx`
- Create: `components/portfolio/performance/segments-panel.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify or reduce: `components/portfolio/portfolio-benchmark-chart.tsx`
- Test: `tests/portfolio/qeo142-performance-ui.test.ts`

**Interfaces:**

`use-performance.ts` exports:

```ts
export function usePortfolioPerformance(portfolioId: string | null): {
  data: PerformanceReadModel | null
  loading: boolean
  error: string | null
  refresh: () => void
}
```

It fetches exactly `/api/portfolio/${portfolioId}/performance` with `cache: "no-store"` and same-origin credentials.

- [ ] **Step 1: Write failing UI source contract**

Assert that:
- `portfolio-page.tsx` renders `PortfolioPerformanceDashboard` for `activeTab === "benchmark"`;
- dashboard renders Scorecard, Equity/Drawdown, Ledger, Benchmark, Segments and Advanced sections;
- only the hook fetches `/performance`;
- client components contain no Scorecard/Payoff/Commission arithmetic;
- population selector exposes Vietnamese `Thực tế`, `Mô phỏng`, `Kết hợp` and defaults from eligible populations;
- period selector exposes `Ngày`, `Tuần`, `Tháng`, `Năm`;
- terminology defines canonical English terms/formulas for Win Ratio, Payoff Ratio, Commission Ratio, Average/Largest Win/Loss, Consecutive Losses, Drawdown, Trading Scorecard, Total P/L %, Optimal f;
- `N/A` / `Không đủ dữ liệu` is used for null metrics instead of formatting null as 0;
- small sample warning text is present;
- explicit note says Account Equity/Drawdown/benchmark are portfolio-wide even when filtering Trade statistics by live/paper.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo142-performance-ui.test.ts
```

Expected: FAIL because performance UI modules do not exist.

- [ ] **Step 3: Implement terminology metadata**

Use entries such as:

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
},
```

Optimal f help must call it aggressive/informational and explicitly say it never changes the user risk setting automatically.

- [ ] **Step 4: Implement one-fetch dashboard**

Layout order is fixed by spec:
1. Trading Scorecard;
2. Account Equity & Drawdown;
3. Period Ledger;
4. Benchmark vs VN-Index;
5. Segmentation;
6. Advanced Optimal f.

Use existing portfolio theme/cards; no unrelated redesign. The selected Trade population controls Scorecard/trading ledger/segments only. Account metrics and benchmark do not change with that selector.

- [ ] **Step 5: Convert benchmark chart to presentational data**

Remove its internal `/benchmark` fetch if the dashboard reuses it. Either make it accept canonical points as props or render the new `benchmark-panel.tsx`; there must be only one performance fetch in the tab.

- [ ] **Step 6: Run GREEN + QEO-141/QEO-139 UI regressions**

```bash
node --test tests/portfolio/qeo142-performance-ui.test.ts tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/portfolio/performance components/portfolio/portfolio-page.tsx components/portfolio/portfolio-benchmark-chart.tsx tests/portfolio/qeo142-performance-ui.test.ts
git commit -m "feat(qeo-142): rebuild performance tab around canonical scorecard"
```

---

### Task 10: Dedicated QEO-142 pre-production workflow and final exact-head acceptance

**Files:**
- Create: `.github/workflows/qeo142-preprod.yml`
- No production domain changes in this task.

**Interfaces:**

The workflow must trigger on PR changes touching:
- `modules/portfolio/performance/**`;
- `modules/portfolio/risk-plan/**`;
- `modules/portfolio/risk-engine/**`;
- `modules/portfolio/trades/**`;
- `modules/portfolio/pnl.ts`;
- `components/portfolio/**`;
- performance/benchmark API routes;
- `tests/portfolio/qeo142-*.test.ts`;
- the workflow itself.

- [ ] **Step 1: Add the dedicated workflow**

Run in this order:

```yaml
- name: QEO-142 Closed Trade normalization
  run: node --test tests/portfolio/qeo142-closed-trades.test.ts
- name: QEO-142 Trading Scorecard
  run: node --test tests/portfolio/qeo142-scorecard.test.ts
- name: QEO-142 Drawdown episodes
  run: node --test tests/portfolio/qeo142-drawdown-episodes.test.ts
- name: QEO-142 Period ledgers
  run: node --test tests/portfolio/qeo142-ledgers.test.ts
- name: QEO-142 Segmentation
  run: node --test tests/portfolio/qeo142-segments.test.ts
- name: QEO-142 Benchmark
  run: node --test tests/portfolio/qeo142-benchmark.test.ts
- name: QEO-142 Server/API
  run: node --test tests/portfolio/qeo142-server-api.test.ts
- name: QEO-142 Reconciliation
  run: node --test tests/portfolio/qeo142-reconciliation.test.ts
- name: QEO-142 UI
  run: node --test tests/portfolio/qeo142-performance-ui.test.ts
- name: QEO-141 regression
  run: node --test tests/portfolio/qeo141-*.test.ts
- name: QEO-139 regression
  run: node --test tests/portfolio/qeo139-*.test.ts
- name: QEO-138 evidence regression
  run: node --test tests/portfolio/qeo138-risk-profile-evidence.test.ts
- name: Portfolio AVCO regression
  run: node --test tests/portfolio-pnl.test.ts
- name: Current test manifest
  run: pnpm test:current:manifest
- name: Lint
  run: pnpm lint
- name: TypeScript
  run: pnpm typecheck
- name: Production build
  run: pnpm build
```

If shell glob behavior for `node --test tests/portfolio/qeo141-*.test.ts` is not reliable in GitHub Actions, list each existing QEO-141/QEO-139 test explicitly rather than weakening coverage.

- [ ] **Step 2: Open/update draft PR and observe exact-head CI**

The PR description must link QEO-142, spec and plan, state `No DB migration`, and describe the benchmark semantic correction.

- [ ] **Step 3: Audit final diff**

Reject unexpected changes to:
- Supabase migrations;
- `modules/portfolio/pnl.ts` accounting semantics;
- QEO-141 Active Risk/Risk State formulas;
- unrelated watchlist/portfolio theme code.

- [ ] **Step 4: Require exact-head release gates**

Before merge, require fresh success for:
- QEO-142 dedicated workflow;
- Verify;
- QEO-137 Trade Domain if triggered;
- QEO-138 Risk Plan;
- QEO-139 Risk Sizing;
- QEO-141 Risk Engine;
- production build on the exact PR head.

- [ ] **Step 5: Commit workflow**

```bash
git add .github/workflows/qeo142-preprod.yml
git commit -m "ci(qeo-142): add performance preprod gate"
```

---

## Post-merge production acceptance

After exact-head verification and merge:

1. Confirm merged `main` SHA.
2. Confirm Vercel Git integration deploys exactly that SHA; do not manually deploy if Git integration works.
3. Require deployment `READY`, canonical alias `qeoindex.qeoqeo.com`, `aliasError = null`.
4. Smoke `/portfolio` for HTTP 200 and correct title/auth shell.
5. Check runtime error clusters for `/portfolio`, `/api/portfolio/*/performance`, and `/api/portfolio/*/benchmark` when traffic exists.
6. Do not claim authenticated Scorecard visual interaction without an authenticated session.
7. Append CI/merge/deploy evidence to Linear QEO-142.
8. Mark QEO-142 Done only after production acceptance satisfies issue acceptance; then QEO-143 becomes the next dependency-chain task.
