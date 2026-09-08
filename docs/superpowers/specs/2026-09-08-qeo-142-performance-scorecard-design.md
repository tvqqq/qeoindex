# QEO-142 — Canonical Performance Scorecard Design

Date: 2026-09-08
Status: Approved architecture; implementation not started
Issue: QEO-142
Base: `main@b8e12507f95c5ff9e65538f03f28f01d1f74fe25`

## 1. Goal

Turn the existing `Hiệu suất` tab into one canonical performance analytics surface for:

- McDowell-aligned Trading Scorecard metrics;
- Daily / Weekly / Monthly / Annual ledgers;
- Account Equity and Drawdown analytics;
- VN-Index benchmark comparison;
- diagnostic segmentation;
- typed deterministic facts that QEO-138, QEO-139 and later QEO-145 can reuse.

QEO-142 must not create a second accounting model, a second drawdown definition, or a parallel Win/Payoff implementation.

## 2. Architectural decision

Use a derived, on-demand `modules/portfolio/performance/` subsystem.

No database migration is required. Aggregates are derived from canonical Trade, Fill, stop/journal evidence and the QEO-141 Account Equity series. Derived scorecards or ledger totals are not persisted unless a later issue proves a material snapshot requirement.

### Rejected alternatives

1. **Persist period/scorecard snapshots.** Rejected because totals can become stale after Trade review, fill linkage or QEO-143 legacy migration.
2. **Compute analytics in the client.** Rejected because UI, QEO-138 and later AI consumers would diverge and duplicate formulas.
3. **Keep the existing benchmark formula as a separate source.** Rejected because it currently uses realized P/L divided by remaining invested basis rather than canonical Account Equity.

## 3. Source-of-truth boundaries

### Accounting

`portfolio_transactions` plus `computePortfolioPositions()` remain the accounting source of truth.

QEO-142 does not rewrite AVCO, realized P/L, cost basis, transaction CRUD or fee treatment.

### Logical Trade outcome

Only canonical closed logical Trades are eligible for Scorecard trade statistics.

- one scale-out / multi-fill campaign counts once;
- legacy `trade_id = null` rows do not become synthetic Trades;
- a closed Trade whose linked fill history cannot produce an available close review is excluded and counted in completeness metadata;
- live and paper populations remain explicit and separable.

### Account Equity / Drawdown

QEO-141 remains the canonical owner of Account Equity construction and point completeness. QEO-142 consumes/reuses those primitives rather than inventing another NAV curve.

Historical marks use canonical RAW Daily evidence in kVND units. Missing required marks remain incomplete; no AVCO/current-price fallback is allowed for a historical point.

## 4. Canonical closed-Trade outcome record

Introduce a normalized performance-layer record derived from Trade + linked fills + journal/stop evidence:

```ts
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
```

The implementation should reuse `deriveTradeCloseReview()` rather than duplicate close accounting.

### Gross / fee / net invariant

For one eligible closed Trade:

```text
Gross Trade P/L = Net P/L + Total Fees
```

For an aggregate population:

```text
Gross Profit = sum(max(Gross Trade P/L, 0))
Gross Loss   = sum(min(Gross Trade P/L, 0))
Commission   = sum(Total Fees)
Net P/L      = Gross Profit + Gross Loss - Commission
```

All money exposed by the performance read model is integer VND at the domain boundary.

### Winner/loser classification

Winner / loser / breakeven uses **net P/L after fees**, matching existing QEO-140 close-review semantics.

Gross P/L is used only where the Scorecard formula explicitly needs gross profit/loss or Commission Ratio.

## 5. Trading Scorecard

For an eligible population of closed logical Trades:

```text
Win Ratio = Winning Closed Trades / Eligible Closed Trades

Payoff Ratio = Average Net Winning Trade
               / abs(Average Net Losing Trade)

Commission Ratio = Total Commission / Gross Profit
```

### Edge rules

- Win Ratio is unavailable when eligible closed Trade count is zero.
- Payoff Ratio is unavailable unless at least one winner and one loser exist.
- Payoff Ratio is never represented as Infinity.
- Commission Ratio is unavailable when Gross Profit <= 0.
- Empty / insufficient statistics are represented as `null` plus completeness/reason, never fake zero.

### Additional metrics

The Scorecard also exposes:

- eligible closed Trade count;
- winning / losing / breakeven count;
- gross profit;
- gross loss;
- commission;
- total net P/L;
- total P/L % when a valid Account Equity denominator exists;
- average winning Trade;
- average losing Trade;
- largest winning Trade;
- largest losing Trade;
- largest consecutive-loss streak;
- average consecutive-loss streak;
- rolling 25-Trade net P/L status;
- Max Drawdown %;
- Average Drawdown %;
- Advanced informational Optimal f.

### Consecutive-loss definition

Order by `closedAt ASC`, then `tradeId ASC`.

A loser extends a loss run. A winner or breakeven Trade ends the run.

- `largestConsecutiveLosses` = maximum completed/current run length;
- `averageConsecutiveLosses` = arithmetic mean of all loss-run lengths;
- if no loss run exists, both are unavailable rather than reported as an observed zero-loss statistic.

### Rolling 25-Trade status

Sort by the same deterministic order and take the latest 25 eligible Trades, or all eligible Trades when fewer than 25 exist.

Expose:

- sample size;
- net P/L VND;
- status: `positive | breakeven | negative | insufficient`.

`insufficient` is used when there are no eligible Trades. A sample below 25 is valid but explicitly labeled as a shorter available sample.

### Optimal f

```text
Optimal f = (((Payoff Ratio + 1) × Win Probability) - 1) / Payoff Ratio
```

Only calculate when Win Probability and Payoff Ratio are valid and Payoff Ratio > 0.

It is informational/aggressive only. It never mutates or recommends an automatic user risk setting.

## 6. Drawdown episodes

QEO-142 uses the same complete Account Equity points that QEO-141 uses.

### Episode definition

1. Establish an all-time peak from complete points.
2. A drawdown episode starts at the first subsequent complete point below that peak.
3. The reference peak remains fixed for that episode.
4. Episode depth is the deepest percentage decline from the reference peak.
5. The episode ends when Account Equity returns to or exceeds the reference peak.
6. An unrecovered current episode is included in Average Drawdown.

```text
Drawdown % = (Equity - Reference Peak Equity) / Reference Peak Equity × 100
Episode Depth % = abs(min Drawdown % in episode)
Max Drawdown % = max(Episode Depth %)
Average Drawdown % = arithmetic mean(Episode Depth %)
```

### Completeness rule

If any Account Equity point required to establish continuity within the analyzed range is incomplete, Max Drawdown and Average Drawdown for that range are unavailable.

QEO-142 must not silently skip missing historical points and calculate a shallower drawdown.

## 7. Period ledgers

Generate deterministic views on demand:

- Daily;
- Weekly;
- Monthly;
- Annual.

### Calendar convention

Use `Asia/Ho_Chi_Minh` for all period assignment.

- Daily key: local calendar date `YYYY-MM-DD`;
- Weekly: Monday 00:00 through Sunday 23:59:59.999 local time, keyed by Monday date;
- Monthly: local calendar month `YYYY-MM`;
- Annual: local calendar year `YYYY`.

A logical Trade belongs to a period by its canonical `closedAt`, converted to `Asia/Ho_Chi_Minh`.

Individual exit fill dates do not create multiple ledger Trade entries.

### Trading metrics per period

Each period includes:

- Trade count;
- winner / loser / breakeven count;
- gross profit;
- gross loss;
- commission;
- net P/L;
- running documented net P/L;
- largest / average win;
- largest / average loss.

These fields use only eligible documented logical Trades.

### Account metrics per period

Account metrics use the canonical Account Equity series and all canonical accounting transactions, including legacy accounting rows:

- start Account Equity;
- end Account Equity;
- period return %;
- period worst drawdown %;
- completeness.

```text
Period Return % = (End Equity - Start Equity) / Start Equity × 100
```

Period return is unavailable when either endpoint is incomplete or start equity <= 0.

Period drawdown is the worst canonical running-peak drawdown observed during the period. It is unavailable if required equity continuity for the period is incomplete.

### Important separation

Trade metrics and Account Equity metrics are intentionally separate.

Legacy ungrouped transactions can affect Account Equity/accounting but must not inflate Trade count, Win Ratio, Payoff Ratio or other documented-Trade statistics.

## 8. Live / paper isolation

Closed-Trade scorecards support three explicit populations:

- `live`;
- `paper`;
- `combined`.

No implicit mixing is allowed.

UI selection defaults to `live` when at least one eligible live Trade exists. If no eligible live Trade exists and paper Trades exist, default to `paper`. `combined` requires explicit user selection.

Account Equity remains portfolio-wide because current transaction/account-capital storage does not define independent live and paper NAV accounts. The UI/read model must state this limitation rather than fabricate separate Account Equity curves.

## 9. Diagnostic segmentation

When eligible tagged data exists, derive optional segments by:

- system tag;
- setup tag;
- timeframe;
- mode (`live | paper`);
- behavior tag from journal evidence;
- mistake tag from canonical Trade/fill evidence.

Each segment exposes at minimum:

- sample count;
- Win Ratio;
- Payoff Ratio when valid;
- net P/L;
- completeness.

One Trade may belong to multiple tag segments. Segment totals therefore are not additive and must not be presented as a partition of portfolio totals.

Segments with `n < 5` carry `smallSample: true` and Vietnamese UI warning that the sample is too small for strong inference.

No causation claim is produced by this deterministic layer.

## 10. Performance read model

Expose one authenticated canonical read boundary:

```text
GET /api/portfolio/[id]/performance
```

Conceptual read model:

```ts
PerformanceReadModel {
  scorecards: {
    live: TradingScorecard
    paper: TradingScorecard
    combined: TradingScorecard
  }

  ledgers: {
    daily: PerformanceLedgerPeriod[]
    weekly: PerformanceLedgerPeriod[]
    monthly: PerformanceLedgerPeriod[]
    annual: PerformanceLedgerPeriod[]
  }

  equity: {
    points: EquityPoint[]
    totalReturnPercent: number | null
    maxDrawdownPercent: number | null
    averageDrawdownPercent: number | null
    episodes: DrawdownEpisode[]
    completeness: "complete" | "insufficient"
  }

  benchmark: {
    points: BenchmarkPoint[]
    portfolioReturnPercent: number | null
    vnindexReturnPercent: number | null
    alphaPercent: number | null
    completeness: "complete" | "insufficient"
  }

  segments: PerformanceSegment[]

  evidence: {
    eligibleTradeCount: number
    excludedClosedTradeCount: number
    legacyUngroupedTransactionCount: number
    tradeGroupingCompleteness: "complete" | "partial" | "insufficient"
    equityCompleteness: "complete" | "insufficient"
  }
}
```

The route is a thin authenticated, `force-dynamic`, `no-store` adapter. Database/provider queries belong to a server/domain boundary, not the route.

## 11. Benchmark compatibility and correction

The existing `/api/portfolio/[id]/benchmark` route must stop owning a separate portfolio-return formula.

It becomes a compatibility adapter over the canonical performance/benchmark builder.

### Portfolio side

Portfolio benchmark points use canonical mark-to-market Account Equity returns, not realized P/L divided by remaining invested cost basis.

### VN-Index side

Preserve the existing VN-Index benchmark capability/provider boundary unless a verified source failure requires a separate issue.

Align benchmark dates to available canonical Account Equity dates.

If either portfolio Account Equity or VN-Index evidence is insufficient for comparison, benchmark values are unavailable rather than `0`.

### Baseline

For a comparison series, normalize both curves to 0% at their first common complete date.

```text
Return % at t = (Value_t - Value_baseline) / Value_baseline × 100
Alpha % at t = Portfolio Return % - VN-Index Return %
```

The first common baseline value must be positive and finite.

## 12. QEO-138 / QEO-139 reconciliation

QEO-138 must consume the canonical Scorecard core for Win Ratio and Payoff Ratio evidence instead of maintaining a second closed-Trade outcome implementation.

Its existing provenance/completeness wrapper can remain, but metric values and eligible population must come from the QEO-142 performance core.

QEO-139 therefore continues to receive Win/Payoff/Optimal-f inputs through the same canonical population after QEO-142 lands.

No risk-sizing formula is changed in QEO-142.

## 13. UI — `Hiệu suất`

Preserve the existing Portfolio visual theme and tab structure. Do not redesign unrelated tabs.

Within `Hiệu suất`, render in this order:

1. Trading Scorecard;
2. Account Equity & Drawdown;
3. Daily / Weekly / Monthly / Annual Ledger;
4. Benchmark vs VN-Index;
5. Diagnostic Segmentation;
6. Advanced — Optimal f.

### Language policy

Project-localization policy overrides the older English-primary wording in the issue description:

- Vietnamese is the primary visible label;
- canonical English/source term is preserved in tooltip/help content;
- formulas remain exact in tooltip where relevant.

Examples:

- `Tỷ lệ thắng` → source term `Win Ratio`;
- `Tỷ lệ lợi nhuận/thua lỗ` → `Payoff Ratio`;
- `Tỷ lệ phí giao dịch` → `Commission Ratio`;
- `Sụt giảm tài khoản` → `Account Drawdown`;
- `Thẻ điểm giao dịch` → `Trading Scorecard`;
- `Optimal f` remains canonical in the Advanced section with Vietnamese explanation.

### Empty/incomplete states

UI must distinguish:

- no eligible closed Trades;
- partially documented Trade history;
- legacy ungrouped transactions;
- incomplete historical price coverage;
- unavailable benchmark comparison.

None of these states may be displayed as fake `0%` performance.

## 14. Error handling and fail-closed rules

- A malformed/incomplete closed Trade is excluded from Trade statistics and counted in evidence metadata.
- Missing historical RAW Daily evidence makes affected equity-dependent metrics unavailable.
- Legacy ungrouped fills remain visible through completeness evidence but do not become Scorecard Trades.
- Provider failure for VN-Index affects benchmark completeness only; it does not invalidate closed-Trade Scorecard metrics.
- A benchmark failure must not make the entire performance endpoint fail when other deterministic analytics are available.
- Authentication/portfolio ownership failures use existing authenticated API error conventions.

## 15. Scope boundaries

### In scope

- canonical closed-Trade performance normalization;
- deterministic Scorecard formulas;
- consecutive-loss and rolling-25 metrics;
- drawdown episode analytics over QEO-141 equity;
- four period ledger views;
- live/paper/combined Trade populations;
- diagnostic segmentation;
- performance typed read model and authenticated API;
- benchmark migration to canonical Account Equity;
- QEO-138 Win/Payoff reconciliation;
- `Hiệu suất` UI.

### Out of scope

- database migration or persisted analytics snapshots;
- QEO-143 legacy Trade grouping/backfill;
- changing AVCO/accounting semantics;
- changing QEO-141 Active Risk/Risk State formulas;
- automatic risk-setting changes from Optimal f;
- exact Risk-of-Ruin probability tables;
- AI advice or QEO-145 implementation;
- unrelated Portfolio visual redesign.

If implementation discovers a genuine need for new persisted schema, QEO-142 must stop and return to architectural approval rather than silently adding a migration.

## 16. Testing contract

Use RED → GREEN per slice.

Minimum deterministic tests:

1. multi-fill closed Trade counts once;
2. close-review net P/L + fees reconciles to gross P/L;
3. Win Ratio formula and zero-sample unavailable state;
4. Payoff Ratio requires winner + loser and never emits Infinity;
5. Commission Ratio unavailable when Gross Profit <= 0;
6. average/largest win/loss;
7. deterministic loss-run ordering, largest and average consecutive losses;
8. latest rolling-25 result and shorter-sample metadata;
9. drawdown episode start/depth/recovery/current unrecovered episode;
10. incomplete equity continuity makes drawdown analytics unavailable;
11. Daily/Weekly/Monthly/Annual `Asia/Ho_Chi_Minh` boundaries;
12. period gross/loss/fees/net reconciliation;
13. period return endpoint completeness rules;
14. live/paper filters cannot mix unless `combined` is explicitly requested;
15. legacy `trade_id = null` rows do not enter Trade stats;
16. segmentation is non-additive and marks `n < 5` as small sample;
17. Optimal f validity and informational-only contract;
18. server/API auth, ownership, no-store and thin-route boundary;
19. benchmark uses canonical Account Equity and never fake-zeroes unavailable comparison;
20. QEO-138 Win/Payoff values reconcile exactly with QEO-142;
21. `Hiệu suất` UI terminology/tooltips and explicit incomplete states;
22. existing AVCO, QEO-137, QEO-138, QEO-139, QEO-140, QEO-141 and benchmark regressions remain green;
23. lint, TypeScript and production build pass on the final exact head.

## 17. Acceptance summary

QEO-142 is complete only when:

- one closed logical Trade counts once regardless of fills;
- Scorecard formulas are deterministic and use explicit unavailable states;
- gross P/L, fees and net P/L reconcile to canonical accounting;
- period ledgers reconcile to the same eligible Trade population;
- Account Equity/Drawdown uses QEO-141 semantics;
- live and paper Trade statistics cannot mix accidentally;
- benchmark portfolio return is based on canonical Account Equity;
- legacy ungrouped rows do not pollute Scorecard statistics;
- QEO-138/QEO-139 consume the same canonical Win/Payoff facts;
- UI preserves existing theme and Vietnamese-primary terminology;
- no production schema migration is introduced;
- all exact-head regression and production-build gates are green.
