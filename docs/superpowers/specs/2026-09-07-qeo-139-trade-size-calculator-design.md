# QEO-139 — Proper Trade Size Calculator Design

**Issue:** QEO-139  
**Status:** Design approved in chat; implementation not started  
**Base:** `main` at `54669eafe2f80c58aaa20de92657dbf4b2c9419d`  
**Source authority:** QEO-131 McDowell Source Contract & Canonical English/Vietnamese Glossary  
**Dependencies:** QEO-137 Trade lifecycle domain, QEO-138 Risk/Discipline Profile + Money Management Plan  
**Future consumer:** QEO-141 Portfolio Active Risk engine

## 1. Goal

Replace the current fixed-stop-percentage sizing path in `components/portfolio/portfolio-capital-allocation.tsx` with a stop-first, deterministic Trade Size calculator aligned to Bennett A. McDowell's terminology and formula contract.

The calculator must make `Trade Size` an output of account risk plus actual stop distance. It must not begin from a hard-coded 7% stop assumption, must include explicit transaction-cost assumptions, and must expose projected portfolio risk without pretending unknown stop risk is zero.

The visual theme, card vocabulary, spacing, typography, and existing `/portfolio` layout language remain intact.

## 2. Non-goals

QEO-139 does **not**:

- redesign the chart or stock-detail chart experience;
- implement the full QEO-141 drawdown/streak/holiday guardrail engine;
- create or mutate actual Trade, Fill, Stop Event, or Journal records;
- block recording a real transaction that already occurred;
- implement a generalized Risk of Ruin probability table from incomplete source material;
- auto-apply Optimal f;
- auto-predict an Initial Stop from a fixed percentage;
- replace the AVCO accounting engine.

## 3. Chosen architecture

Use **Approach B: deterministic Trade Size domain service + UI adapter**.

The formula, validation, units, rounding, copy/formula metadata, and projected-risk state live outside the React component. The UI only gathers inputs, loads existing portfolio/plan context, invokes deterministic functions, and renders results.

Recommended module boundary:

```text
modules/portfolio/risk-sizing/
  types.ts
  units.ts
  calculator.ts
  projection.ts
  optimal-f.ts
  terminology.ts
  validation.ts
  README.md
```

Existing `portfolio-capital-allocation.tsx` remains the visual integration point, but its current ad-hoc sizing math is removed.

This boundary is intentionally reusable by QEO-140/QEO-141 without pulling those tasks into this issue.

## 4. Source fidelity and product extensions

Every calculation or label must be classifiable as one of:

- **BOOK** — source-exact McDowell terminology/formula;
- **PRODUCT** — QeoIndex operational implementation required to make the source usable;
- **EXTENSION** — additional conservative product behavior not printed verbatim in the book.

### BOOK formulas

```text
Risk Amount = Account Size × Risk %

Trade Size =
  (Risk Amount − Commission)
  / Difference Between Entry and Stop
```

Canonical source-facing terminology:

- `Trade Size` / `Maximum Trade Size`
- `Initial Stop-Loss Exit`
- `Risk Amount`
- `Risk Amount per Share`
- `Account Size` / `Trading Account Capital`

### Product aliases

For compact UI:

- `Account Equity` — product implementation term for current account capital;
- `Initial Stop` — compact alias; tooltip must show `Initial Stop-Loss Exit`;
- `Risk per Share` — compact alias; tooltip must explain source term `Risk Amount per Share`;
- `Active Risk`, `Max Active Risk`, `Remaining Risk Budget` — product operationalizations.

### EXTENSION formula

The book states that risk allowance should account for commission and slippage, but its printed Trade Size formula subtracts Commission explicitly and does not print a separate `− Slippage Allowance` term.

QeoIndex production sizing therefore uses:

```text
Available Risk Budget =
  Risk Amount
  − Estimated Round-Trip Commission
  − Slippage Allowance

Raw Trade Size =
  Available Risk Budget
  / Risk per Share
```

`Slippage Allowance` must be labelled in tooltip/docs as a QeoIndex safety extension, not as a verbatim printed McDowell term.

## 5. Units contract

Unit conversions must be explicit and centralized. No component-local implicit `×1000` math.

### Inputs and outputs

| Field | Domain unit | UI representation |
| --- | --- | --- |
| Account Equity | VND | full VND |
| Risk per Trade | percent | `%` |
| Risk Amount | VND | full VND |
| Planned Entry | kVND/share input | kVND/share |
| Initial Stop | kVND/share input | kVND/share |
| Risk per Share | VND/share internally | may display VND/share and/or kVND/share |
| Estimated Commission | VND | full VND |
| Slippage Allowance | VND | full VND |
| Trade Size | shares | integer shares |
| Position Value | VND | full VND |
| Active Risk | VND | full VND |
| Max Active Risk | VND and % | full VND + `%` |
| Remaining Risk Budget | VND | full VND |

Conversions:

```text
priceVnd = priceKvnd × 1,000
riskPerShareVnd = abs(entryKvnd − stopKvnd) × 1,000
positionValueVnd = tradeSizeShares × entryKvnd × 1,000
```

The calculator must never mix kVND price fields with full-VND account/cost fields without going through `units.ts`.

## 6. Deterministic sizing contract

### Input

```ts
type TradeSizeInput = {
  side: "long" // QEO-139 UI scope; domain can remain extensible
  accountEquityVnd: number
  riskPercent: number
  plannedEntryKvnd: number
  initialStopKvnd: number
  estimatedCommissionVnd: number
  slippageAllowanceVnd: number
  lotSizeShares: number
  advancedRiskOverrideAcknowledged: boolean
}
```

### Derived values

```text
Risk Amount = Account Equity × Risk per Trade / 100

Risk per Share =
  (Planned Entry − Initial Stop) × 1,000
  for the current long-only UI path

Available Risk Budget =
  Risk Amount − Commission − Slippage

Raw Trade Size =
  Available Risk Budget / Risk per Share

Trade Size =
  floor(Raw Trade Size / lotSizeShares) × lotSizeShares

Position Value =
  Trade Size × Planned Entry × 1,000

Planned downside at stop before costs =
  Trade Size × Risk per Share

Planned total risk consumption =
  planned downside + Commission + Slippage
```

The total risk consumption must not exceed `Risk Amount` after rounding.

### Regular-lot convention

QEO-139 uses a deterministic product sizing convention of **100 shares per regular lot**:

```text
floor(rawShares / 100) × 100
```

This is a QeoIndex execution convention, not part of McDowell's formula. Odd-lot capacity must not be used to consume the last portion of the risk budget. If the raw safe size is below 100 shares, the regular-lot Trade Size is `0` and the UI reports no valid regular-lot size.

If a later broker/exchange integration needs venue-specific order-lot rules, that belongs behind the `lotSizeShares` parameter rather than changing the core formula.

## 7. Validation and result states

The calculator returns structured states rather than negative or misleading numbers.

```ts
type TradeSizeStatus =
  | "ready"
  | "incomplete"
  | "invalid_account_equity"
  | "invalid_risk_percent"
  | "advanced_override_required"
  | "invalid_entry"
  | "invalid_stop_direction"
  | "zero_stop_distance"
  | "costs_consume_risk_budget"
  | "below_regular_lot"
```

Rules:

- Account Equity must be finite and `> 0`.
- Risk per Trade must be finite and `> 0`.
- Risk `> 2%` requires explicit advanced acknowledgement.
- QeoIndex never auto-suggests Risk per Trade above 2%.
- Planned Entry must be `> 0`.
- Current QEO-139 long-only UI requires `0 < Initial Stop < Planned Entry`.
- Missing stop means sizing is `incomplete`, not an assumed percent stop.
- Equal Entry and Stop means zero stop distance and is invalid.
- Commission/slippage must be finite and `>= 0`.
- If commission + slippage consumes all Risk Amount, no valid Trade Size exists.
- No result path may return a negative Trade Size.

## 8. Risk per Trade source

Risk default precedence:

1. Current Money Management Plan `default_trade_risk_percent` from QEO-138.
2. If no plan exists, conservative onboarding default `2%`, clearly described as a book-aligned example/starting ceiling rather than a universal safe value or guarantee.

User behavior:

- User may lower Risk per Trade for an individual planned Trade.
- User may enter `>2%` only after checking an explicit advanced-risk acknowledgement.
- A saved profile score never auto-increases risk.
- QEO-139 does not persist a calculator-specific risk preference back into the Money Management Plan.

The UI should show whether the current risk value came from:

```text
money_management_plan | onboarding_default | manual_override
```

This provenance is display/audit context, not AI inference.

## 9. Stop-first workflow

The canonical input sequence is:

```text
1. Account Equity
2. Risk per Trade
3. Risk Amount
4. Ticker/context (when available)
5. Planned Entry
6. Initial Stop-Loss Exit
7. Estimated Commission
8. Slippage Allowance
9. Risk per Share
10. Trade Size
11. Position Value
12. Projected Active Risk
```

There is no canonical `% stoploss deal` input.

Stop-distance percentage is derived only:

```text
Stop Distance = Planned Entry − Initial Stop
Stop Distance % = Stop Distance / Planned Entry × 100
```

Field guidance should mention:

- structural support/resistance;
- volatility / price activity;
- trading-system rule;
- define initial stop before entry;
- trailing stops are post-entry risk management, not a substitute for choosing the initial stop.

The app must not present a stop calculated from an arbitrary default percentage as market-derived evidence.

## 10. Commission and slippage behavior

`Estimated Commission` is the estimated round-trip monetary cost included in the risk budget.

`Slippage Allowance` is a separate deterministic VND reserve for worse execution than the planned stop/entry assumptions.

Both default to explicit product values from existing app conventions only if those conventions are deterministic and visible to the user. Otherwise the calculator starts them at zero and clearly shows that they are assumptions the user can change.

No hidden fee/slippage number may be embedded in the formula.

The tooltip must state that actual loss can still exceed the planned amount because of gaps, liquidity, volatility, overnight moves, and execution slippage.

## 11. Projected portfolio risk boundary

QEO-139 needs projected risk but must not absorb the whole QEO-141 engine.

Create a small deterministic projection interface:

```ts
type CurrentActiveRiskContext = {
  knownActiveRiskVnd: number
  accountEquityVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  riskState?: "normal" | "reduce_risk" | "pause_and_review" | "unknown"
}

type ProjectedRiskResult = {
  knownActiveRiskVnd: number
  knownActiveRiskPercent: number | null
  maxActiveRiskVnd: number | null
  maxActiveRiskPercent: number | null
  remainingRiskBudgetVnd: number | null
  plannedTradeRiskVnd: number
  projectedKnownActiveRiskVnd: number
  projectedKnownActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  state:
    | "within_plan"
    | "exceeds_plan"
    | "review_required"
    | "risk_unknown"
}
```

### Semantics

- `knownActiveRiskVnd` is never silently interpreted as total risk when `unknownRiskTradeCount > 0`.
- Missing active stop = `Risk Unknown`, never zero.
- If any open Trade has unknown risk, projection state is `risk_unknown` unless a stronger existing `pause_and_review` state must be surfaced.
- If Max Active Risk is absent, projected numeric values may still be shown but no `within_plan` claim is made.
- If projected known risk exceeds a configured cap, state is `exceeds_plan`.
- If current plan/risk state is `reduce_risk` or `pause_and_review`, state is `review_required` with reason surfaced.

### Data source in QEO-139

QEO-139 may use only already-recorded Trade/Stop data from QEO-137 to produce the minimum current-risk context needed by the calculator. It must not fabricate stops for legacy holdings.

If the existing data is insufficient to compute complete portfolio Active Risk, the UI explicitly shows `Risk Unknown` and keeps Trade Size calculation independent from that unknown state.

QEO-141 remains responsible for full Active Risk reconciliation, drawdown, streak/holiday triggers, trailing-stop semantics, and Tài sản risk cards.

## 12. Override behavior

Projected cap warnings do not prevent the calculator from displaying a result.

For a future planned Trade creation flow:

- `exceeds_plan` or `review_required` must require an explicit override reason before confirming a new plan;
- the reason belongs in the Trade/journal workflow, not inside QEO-139 calculator persistence;
- QEO-139 may expose an override-reason field only if the existing plan-creation action is already available without expanding scope;
- recording an already-executed fill is never blocked by the calculator.

## 13. Optional target / R:R

Target price and Reward:Risk are secondary information only.

- Target is optional.
- Target does not participate in Trade Size calculation.
- Missing target does not make sizing incomplete.
- Any R:R value must be derived from Entry, Stop, and optional Target only after the canonical sizing calculation is complete.

## 14. Advanced informational section

Collapsed by default.

May show existing deterministic evidence from QEO-138:

- Win Ratio;
- Payoff Ratio;
- Optimal f when inputs are mathematically valid.

Optimal f source formula:

```text
f = ([(A + 1) × p] − 1) / A
```

where:

- `A` = average Payoff Ratio;
- `p` = Win Ratio as a decimal.

Rules:

- informational only;
- never auto-applied to Risk per Trade;
- never auto-applied to Trade Size;
- clearly warn that Optimal f is more aggressive than zero-ROR table sizing;
- not a zero-ROR guarantee;
- no fabricated generalized ROR probability table.

Invalid/insufficient Win Ratio or Payoff Ratio produces `Insufficient History`, not a guessed value.

## 15. UI design

Preserve the current four-panel/card language where practical, but make the first panel canonical **Trade Size Calculator** rather than “fixed account risk” allocation from a stop percentage.

### Primary metric labels

Use English canonical labels as primary text:

- `Account Equity`
- `Risk per Trade`
- `Risk Amount`
- `Planned Entry`
- `Initial Stop`
- `Risk per Share`
- `Estimated Commission`
- `Slippage Allowance`
- `Trade Size`
- `Position Value`
- `Active Risk`
- `Max Active Risk`
- `Remaining Risk Budget`

Do not use Vietnamese replacements as the primary metric name when QEO-131 defines an English canonical term.

### Tooltips

Every metric gets desktop hover/focus and mobile tap help using the existing tooltip/help affordance.

Each tooltip contains:

1. Vietnamese definition;
2. deterministic formula where applicable;
3. why the metric matters;
4. source/product/extension distinction where relevant;
5. caveat that stop-based planned loss is not guaranteed actual exit loss.

Formula tooltip strings should be exported from the same `terminology.ts`/formula metadata consumed by calculator tests so copy and code cannot drift silently.

### Copy correction

Delete certainty language such as:

> “triệt tiêu hoàn toàn nguy cơ cháy tài khoản”

Replace with source-faithful copy equivalent to:

> Trade sizing giới hạn khoản lỗ dự kiến theo stop và giúp giảm Risk of Ruin. Actual loss vẫn có thể vượt kế hoạch do gap, liquidity, volatility và slippage.

## 16. Current portfolio panels

The existing cash, cost-basis, holdings, and AVCO-derived P&L views remain intact.

QEO-139 must not change the accounting meaning of:

- current holdings;
- total invested/cost basis;
- realized P&L;
- current market value;
- available cash.

Any simulated “after next deal” panel must use the **rounded Trade Size × Entry** value, not the old `Risk Amount / stop %` allocated-capital formula.

Margin simulation, if retained, remains funding information only and must not alter the risk-sizing formula.

## 17. Server/data boundary

The calculator arithmetic is client-safe pure code and does not require a database write.

Server reads may provide:

- current Money Management Plan risk settings;
- existing Risk Profile evidence for Advanced info;
- minimal current Active Risk context from recorded Trade/Stop evidence.

Components must not query Supabase directly. Existing authenticated API/module boundaries are reused or extended with a narrow read endpoint/read-model.

Suggested read model:

```ts
type TradeSizeCalculatorContext = {
  portfolioId: string
  accountEquityVnd: number
  moneyManagementPlan: {
    id: string
    version: number
    defaultTradeRiskPercent: number
    maxActiveRiskPercent: number
  } | null
  activeRisk: CurrentActiveRiskContext
  evidence: {
    winRatio: number | null
    payoffRatio: number | null
    sampleSize: number | null
    completeness: "complete" | "partial" | "insufficient"
  }
}
```

No LLM or AI interpretation is present.

## 18. Error handling and incomplete data

The calculator must distinguish:

- invalid user input;
- incomplete required input;
- unavailable portfolio evidence;
- unknown Active Risk due to missing stops;
- configured cap breach;
- advanced override requirement.

Network/read-model failure must not fall back to fabricated plan values. The UI may still allow local calculator inputs using the conservative onboarding default, but must show that portfolio plan/risk context is unavailable.

Missing current price/ticker context is not fatal if the user manually enters Planned Entry.

## 19. Testing strategy

Implementation follows TDD with explicit RED → GREEN evidence.

### Domain formula tests

- source-exact McDowell formula representation;
- extended formula with commission + slippage;
- unit conversion kVND → VND/share;
- wider stop produces smaller Trade Size at equal risk;
- narrower stop produces larger Trade Size at equal risk;
- rounded Trade Size never exceeds risk budget;
- 100-share regular-lot floor;
- raw safe size below 100 returns no valid regular-lot Trade Size;
- zero equity;
- invalid/zero risk percent;
- missing stop;
- stop equal to entry;
- long stop above entry;
- costs consuming the entire risk budget;
- negative commission/slippage rejected;
- `>2%` risk requires acknowledgement;
- `<=2%` does not require acknowledgement.

### Plan/default tests

- current Money Management Plan supplies default risk and Max Active Risk;
- no plan uses explicit onboarding default 2%;
- manual lower-risk override works;
- profile score never auto-increases risk;
- no fixed 7% stop default remains in canonical path.

### Projected risk tests

- within-cap projection;
- cap breach;
- no configured cap;
- unknown stop count causes `risk_unknown`, never zero-risk claim;
- reduce/pause state becomes `review_required`;
- Remaining Risk Budget uses known risk and carries incomplete warning.

### Advanced tests

- valid Optimal f calculation;
- invalid Payoff Ratio / insufficient history returns unavailable;
- Optimal f never mutates risk input/output;
- no ROR table implementation.

### UI contract tests

- canonical English labels present;
- Vietnamese tooltip/help content present;
- `Initial Stop` exists and fixed stop-percentage input is absent;
- certainty language removed;
- Commission + Slippage visible;
- Trade Size and Position Value use deterministic service output;
- Active Risk unknown state is visible;
- Advanced section collapsed by default.

### Regression gates

- portfolio AVCO tests;
- QEO-137 Trade-domain tests;
- QEO-138 Risk-plan tests;
- lint;
- TypeScript;
- production build.

## 20. Implementation sequence

After written-spec approval, implementation plan should preserve this order:

1. RED domain formula/unit/validation tests.
2. Implement pure risk-sizing primitives.
3. RED Money Management Plan/default-context tests.
4. Implement narrow calculator context read model.
5. RED projected Active Risk tests.
6. Implement minimal projection boundary without QEO-141 scope creep.
7. RED UI contract tests.
8. Replace old Panel 1 sizing path and derived simulated values.
9. Add canonical tooltips/copy metadata.
10. Add optional Advanced info and Optimal f.
11. Run AVCO + QEO-137 + QEO-138 regressions.
12. Run full exact-head verification and production build.
13. Deploy and smoke test `/portfolio` using an authenticated portfolio.

## 21. Acceptance checklist

QEO-139 is acceptable only when all are true:

- [ ] `Trade Size` is determined from Account Equity, Risk per Trade, Entry, Initial Stop, and costs.
- [ ] Fixed 7% stoploss is no longer the canonical input path.
- [ ] Initial Stop is required before sizing is complete.
- [ ] Source-exact formula and product extension are distinguishable.
- [ ] Commission and Slippage both reduce available risk budget.
- [ ] Costs cannot produce a negative/unsafe quantity.
- [ ] Quantity is rounded down to the configured regular-lot rule.
- [ ] Wider stop yields smaller size; narrower stop yields larger size.
- [ ] Default risk comes from current Money Management Plan when present.
- [ ] No-plan fallback is visibly a conservative 2% onboarding default, not a guarantee.
- [ ] Risk above 2% requires advanced acknowledgement and is never auto-suggested.
- [ ] Projected Active Risk is explainable.
- [ ] Missing stops produce `Risk Unknown`, never zero.
- [ ] Projected cap breach is a warning/review state, not a blocker for recording historical fills.
- [ ] Canonical English labels and Vietnamese tooltips are present.
- [ ] Tooltip formula text matches deterministic calculation metadata.
- [ ] Certainty language about eliminating account ruin is removed.
- [ ] Optimal f is informational only.
- [ ] No generalized fake ROR table exists.
- [ ] Existing holdings/P&L/AVCO behavior remains correct.
- [ ] Exact-head tests, TypeScript, and production build pass before merge.
