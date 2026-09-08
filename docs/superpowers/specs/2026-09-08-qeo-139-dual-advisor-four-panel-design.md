# QEO-139 Follow-up — Dual Advisor Four-Panel Portfolio Risk Design

Date: 2026-09-08
Issue: QEO-139
Base: `main` at `a55314ed10f7440196f3351bf5b07885bbeb5fcc`
Branch: `tvq9612/qeo-139-dual-advisor-four-panel-followup`

## 1. Purpose

QEO-139 shipped a source-faithful stop-first Trade Size engine, but its single-trade presentation weakened the portfolio-level mental model that existed in the earlier four-panel Capital Allocation UI.

This follow-up combines the strongest parts of both versions:

- preserve the earlier four-panel layout and portfolio-first flow;
- keep QEO-139 stop-first deterministic sizing as the only canonical sizing engine;
- make `Planned Entry` and `Initial Stop` explicitly per Trade / per ticker;
- let a portfolio hold multiple independent planned Trades at once;
- present two deterministic advisors with separate responsibilities;
- combine both advisors in a fourth-panel before/after simulation and verdict.

The two advisors are not LLM agents. They are explainable deterministic views over the same portfolio, Money Management Plan, Trade Size engine, and Active Risk evidence.

## 2. Non-goals

This follow-up does not:

- restore the old fixed `7% stoploss deal` sizing formula;
- replace the QEO-139 domain calculator or its source terminology;
- create generalized Risk-of-Ruin probabilities;
- auto-apply Optimal f;
- persist planned Trades to the database;
- create or mutate real Trade lifecycle records;
- redesign charting;
- implement QEO-140 Trade Posting Cards;
- implement the full QEO-141 Active Risk / drawdown guardrail engine;
- introduce a production database migration;
- assume margin availability or automatically finance a funding shortfall with margin.

Planned Trades remain client-side planning state. Recording or persisting an actual plan/fill belongs to later Trade lifecycle work.

## 3. Core mental model

The UI answers three different questions and must not mix their scopes.

### Portfolio Allocation Advisor

Answers:

> How much portfolio-level risk and capital capacity is available now?

Its inputs are portfolio-level values such as Account Equity, current holdings, Money Management Plan, known Active Risk, and cash/exposure estimates.

### Trade Size Advisor

Answers:

> For this ticker, with this Planned Entry and this Initial Stop, how many shares fit the allowed risk?

Its Entry, Stop, Commission, Slippage and resulting Trade Size belong to one planned Trade only. At the portfolio-summary layer it also aggregates all planned rows so it can explain the risk/capital footprint of the planned basket, not only the currently edited ticker.

### Combined Verdict

Answers:

> If the currently planned Trade or group of planned Trades is executed, what does the portfolio look like afterward?

It combines current portfolio state with cumulative planned position value and cumulative planned risk.

## 4. Four-panel layout

Preserve the visual structure of the earlier UI as closely as practical:

```text
┌──────────────────────────────────┬──────────────────────────────────┐
│ 1. Portfolio Allocation Advisor  │ 2. Current Portfolio State       │
│ risk budget / capital capacity   │ holdings / current risk evidence │
├──────────────────────────────────┼──────────────────────────────────┤
│ 3. Trade Size Advisor            │ 4. Combined Portfolio Simulation │
│ per-ticker planning              │ before → after / verdict         │
└──────────────────────────────────┴──────────────────────────────────┘
```

Desktop uses a two-column grid. Mobile stacks the same panels in numeric order. The existing dark/purple QeoIndex visual language stays unchanged.

## 5. Panel 1 — Portfolio Allocation Advisor

### Responsibilities

Panel 1 is portfolio-scoped. It must not contain a per-ticker Entry or Stop field.

Primary metrics:

- `Account Equity`
- `Initial Capital`
- `Realized P&L`
- `Unrealized P&L`
- `Stock Market Value`
- `Estimated Available Cash`
- `Risk per Trade`
- `Max Active Risk`
- `Active Risk`
- `Remaining Risk Budget`

`Account Equity` continues to use the QEO-139 provenance-aware calculation:

```text
Account Equity = Initial Capital + Total Realized P&L + Total Unrealized P&L
```

If market-price coverage is partial, the panel must visibly mark Account Equity as partial and list the affected ticker(s). It must not silently substitute a complete-looking number.

### Estimated available-cash rule

For continuity with the old UI and until an authoritative cash ledger exists:

```text
Estimated Available Cash
  = max(0, Initial Capital + Total Realized P&L - Open Position Cost Basis)
```

Open Position Cost Basis is the AVCO cost basis of currently open positions. Values are converted once from kVND-domain accounting units to VND presentation units.

Because deposits, withdrawals, taxes, financing and broker cash movements are not modeled by this formula, the UI must always label this metric `Estimated Available Cash`, never authoritative `Available Cash`.

The planner must not infer margin availability. If planned position value exceeds estimated available cash, Panel 4 reports a funding gap and enters an advisory state rather than silently creating synthetic margin.

### Advisor output

Panel 1 emits a short deterministic explanation generated from thresholds and evidence, for example:

- remaining known risk budget and risk-cap utilization;
- whether the active-risk cap is unconfigured;
- whether current Active Risk is unknown because one or more open Trades lack stop evidence;
- whether Account Equity or cash is only partially/approximately known.

No generative AI is used.

## 6. Panel 2 — Current Portfolio State

Panel 2 restores the earlier portfolio-status view and makes it risk-aware.

### Holdings table

For each open holding, display at minimum:

- Ticker
- Open Quantity
- Average Cost
- Current Price when available
- Market Value
- Unrealized P&L
- Stop evidence status
- Active Risk when deterministically known

The client already has AVCO positions and current prices. QEO-139's authenticated risk-sizing boundary already computes aggregate open-Trade risk. This follow-up may extend that read model to expose the same deterministic calculation as per-Trade breakdown rows, rather than reimplementing risk math in the UI.

Recommended server row shape:

```ts
{
  tradeId: string
  ticker: string
  openQty: number
  avgCostKvnd: number
  latestStopKvnd: number | null
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
}
```

`activeRiskVnd: null` means unknown evidence. It must never be replaced by zero.

A legacy/open AVCO holding that is not linked to a normalized QEO-137 Trade must be shown as unlinked/unknown for Active Risk. Compatibility `stopLoss` fields on old transactions may still be displayed as historical UI context, but they are not promoted to canonical risk evidence for the Combined Verdict.

### Aggregates

Footer shows:

- total Market Value;
- total Unrealized P&L;
- total Realized P&L;
- Estimated Available Cash;
- known Active Risk;
- number of open Trades/holdings with unknown risk.

The table is a portfolio reality view, not a sizing calculator.

## 7. Panel 3 — Trade Size Advisor

Panel 3 hosts the canonical QEO-139 stop-first calculator.

### Per-Trade draft

One active draft contains:

```ts
type PlannedTradeDraft = {
  ticker: string
  plannedEntryKvnd: string
  initialStopKvnd: string
  riskPercent: string
  estimatedCommissionVnd: string
  slippageAllowanceVnd: string
  advancedRiskOverrideAcknowledged: boolean
}
```

The Ticker field is first and visually prominent. It is normalized to uppercase. The initial implementation supports one planned row per ticker; planning multiple scale-in legs for the same ticker is intentionally deferred to QEO-140/Trade lifecycle work.

The user may plan a ticker that is not already held. Existing portfolio tickers may be suggested, but the field must not be restricted to current holdings.

### Canonical calculation

Panel 3 must reuse `calculateTradeSize()`; it must not duplicate formula logic.

Flow:

```text
Ticker
→ Risk per Trade
→ Planned Entry
→ Initial Stop
→ Commission
→ Slippage
→ Risk Amount
→ Risk Amount per Share
→ Trade Size
→ Position Value
→ Risk Added by Planned Trade
```

The canonical validation remains:

```text
0 < Initial Stop < Planned Entry
```

for the current long-only sizing UX.

`Risk per Trade` defaults from the Money Management Plan or the existing disclosed 2% onboarding default. A manual value above 2% still requires the existing explicit advanced acknowledgement.

### Add planned Trade

A ready calculation can be added with `Add Planned Trade`.

A planned row stores the deterministic result snapshot needed for the portfolio simulation:

```ts
type PlannedTrade = {
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
```

A second Add for the same ticker edits/replaces that ticker's existing planned row instead of creating ambiguous duplicate legs.

The planned list appears below the active draft with actions to Edit and Remove.

### Advisor output

The Trade Size Advisor explains the active draft in deterministic terms, for example:

> MSN: Entry 68.0 / Stop 64.5 gives 3,500 VNĐ risk per share. With the current risk allowance, the regular-lot Trade Size is 2,300 shares.

If the stop widens or costs consume the risk budget, the explanation changes accordingly. It must not make price-direction predictions.

## 8. Panel 4 — Combined Portfolio Simulation

Panel 4 is the primary integration point between the two advisors.

### Before state

Display:

- Account Equity
- Estimated Available Cash
- Stock Market Value
- Known Active Risk
- Remaining Risk Budget

### Planned state

Display totals across every valid `PlannedTrade` row:

```text
Planned Position Value = Σ plannedTrade.positionValueVnd
Planned Risk Added = Σ plannedTrade.riskAddedVnd
```

### After state

Derived values:

```text
Projected Known Active Risk
  = Current Known Active Risk + Planned Risk Added

Projected Risk %
  = Projected Known Active Risk / Account Equity × 100

Projected Estimated Cash
  = Estimated Available Cash - Planned Position Value

Funding Gap
  = max(0, Planned Position Value - Estimated Available Cash)
```

When current open-Trade risk contains unknown evidence, projected known risk may still be shown as a lower bound, but the UI must not claim the portfolio is within plan.

### Combined verdict precedence

Use deterministic precedence so the same inputs always produce the same verdict:

1. `UNAVAILABLE` — authenticated risk context failed to load.
2. `RISK UNKNOWN` — one or more existing open Trades/holdings have unknown canonical risk evidence.
3. `REVIEW REQUIRED` — risk evidence/configuration is incomplete in a way that makes a cap comparison unreliable, including partial Account Equity or missing Max Active Risk.
4. `EXCEEDS PLAN` — with complete enough evidence and a configured cap, current + planned known Active Risk exceeds Max Active Risk.
5. `REVIEW REQUIRED` — risk comparison is otherwise valid but capital/funding needs review, including a positive funding gap.
6. `WITHIN PLAN` — evidence is sufficiently complete, Max Active Risk is configured, funding is sufficient, and projected risk stays within plan.

This order deliberately prevents incomplete evidence from producing a false `EXCEEDS PLAN` or `WITHIN PLAN`, while still allowing a real risk-cap breach to take precedence over a separate funding warning when evidence is complete.

`EXCEEDS PLAN` is advisory for a plan. It must not block recording a real fill elsewhere in the product.

### Two advisor messages

Panel 4 renders two separate deterministic conclusions:

**Portfolio Allocation Advisor**

Focuses on portfolio capacity, remaining risk budget, funding gap, and evidence completeness.

**Trade Size Advisor**

Summarizes the cumulative planned basket — number of planned tickers, total planned position value and total planned risk — and may additionally highlight the currently selected planned ticker's Entry/Stop-derived size. This lets both advisors comment on the overall portfolio outcome while keeping per-ticker sizing mechanics explicit.

The Combined Verdict is rendered separately and must not be presented as an AI confidence score.

## 9. State and lifecycle

### Portfolio isolation

All planner state is scoped to `activePortfolioId`.

Switching portfolio must remount/reset:

- active Trade draft;
- planned Trades list;
- advanced override acknowledgement;
- manual risk override provenance.

No draft from Portfolio A may appear in Portfolio B.

### Refresh behavior

Planned Trades are intentionally ephemeral in this follow-up. Refreshing the page clears them.

The UI must label the section as a planning workspace and avoid copy that implies persistence.

### Editing

Edit loads a planned row back into Panel 3. Saving replaces the row for that ticker with a freshly calculated deterministic snapshot.

Removing a row immediately recalculates Panel 4 cumulative totals and verdict.

## 10. Architecture and component boundaries

Refactor the current thin `PortfolioCapitalAllocation` presentation into explicit components with narrow responsibilities:

```text
PortfolioCapitalAllocation
├── PortfolioAllocationAdvisor
├── PortfolioCurrentState
├── TradeSizeAdvisor
│   ├── TradeSizeDraftForm
│   └── PlannedTradesList
└── CombinedPortfolioSimulation
```

`PortfolioCapitalAllocation` owns cross-panel planning state, constructs shared portfolio metrics, and owns one authenticated risk-sizing-context load for the active portfolio. Panels receive the same resolved context snapshot; they must not issue independent duplicate requests that can drift in time.

A focused hook/controller such as `usePortfolioRiskSizingContext(portfolioId)` may encapsulate loading/error/abort behavior, but the network boundary remains one request per active portfolio snapshot.

The risk-sizing domain remains under `modules/portfolio/risk-sizing/`.

Recommended additional pure functions:

```text
buildPortfolioAllocationSnapshot(...)
simulatePlannedTrades(...)
deriveCombinedVerdict(...)
```

These functions must be framework-independent and deterministic. React components render their outputs; they do not own finance/risk formulas.

The existing `calculateTradeSize()`, `buildAccountEquityContext()`, `projectActiveRisk()`, `calculateOptimalF()`, and terminology metadata remain canonical and should be reused rather than forked.

## 11. Data flow

The intended data flow is one-way:

```text
Portfolio AVCO positions + current prices + total realized P&L
                     │
                     ├──> Account Equity / allocation snapshot
                     │
Authenticated risk-sizing API
(Money Management Plan + Active Risk evidence)
                     │
                     └──> shared risk context snapshot

Active Trade draft
  └── calculateTradeSize()
      └── Add/Replace PlannedTrade
          └── PlannedTrade[]
              └── simulatePlannedTrades()
                  └── deriveCombinedVerdict()
                      └── Panel 4 + both advisor messages
```

Changing or removing a planned row recomputes the simulation from `PlannedTrade[]`; it does not incrementally mutate cached portfolio totals.

## 12. Authenticated risk context

The existing `/api/portfolio/[portfolioId]/risk-sizing` boundary remains the only client-accessible source for Money Management Plan and open-Trade risk evidence.

The API may be extended with a per-Trade risk breakdown derived from the same `computeOpenTradeRiskContext` calculation. If extended, the aggregate and breakdown must be produced in one domain pass so they cannot drift.

Client components must not query Supabase directly.

API failure is fail-closed:

- risk-dependent metrics show `Unavailable`;
- Combined Verdict is `UNAVAILABLE`;
- no zero Active Risk or fake `Insufficient History` is fabricated.

## 13. Error and incomplete-evidence handling

The UI must distinguish these states:

- missing Entry/Stop: incomplete planned Trade;
- invalid Stop direction or zero Stop: invalid planned Trade;
- costs consume risk budget: no valid Trade Size;
- quantity below one supported regular lot: no executable regular-lot size;
- Account Equity partial: visible warning + `REVIEW REQUIRED` for combined portfolio verdict;
- current open Trade/holding missing canonical Stop/fill linkage: `RISK UNKNOWN`;
- Max Active Risk absent: `REVIEW REQUIRED`, not `WITHIN PLAN`;
- funding gap: `REVIEW REQUIRED`, no implicit margin;
- risk API failure: `UNAVAILABLE`.

A problem in one draft must not corrupt current portfolio metrics or previously valid planned rows.

## 14. Terminology and copy

Continue the QEO-131/QEO-139 terminology contract.

Primary English labels include:

- Account Equity
- Risk per Trade
- Risk Amount
- Planned Entry
- Initial Stop
- Risk Amount per Share / Risk per Share alias
- Estimated Commission
- Slippage Allowance
- Trade Size
- Position Value
- Active Risk
- Max Active Risk
- Remaining Risk Budget
- Projected Active Risk

Vietnamese explanation stays in tooltip/help copy.

The old certainty sentence about eliminating account ruin must not return.

Stop Distance is derived from Entry and Initial Stop; it is never a fixed input percentage.

## 15. Advanced information

Keep the existing collapsed Advanced section:

- Win Ratio
- Payoff Ratio
- Optimal f

Optimal f remains informational only and never changes Risk per Trade, Trade Size, planned rows, or Combined Verdict automatically.

The Advanced section is not one of the two advisors.

## 16. Testing strategy

Implementation follows RED → GREEN TDD.

### Domain tests

Add pure tests for:

- cumulative planned position value;
- cumulative planned risk added;
- projected known Active Risk;
- projected risk percentage;
- estimated cash after planned Trades;
- funding gap;
- verdict precedence for UNAVAILABLE / RISK UNKNOWN / REVIEW REQUIRED / EXCEEDS PLAN / WITHIN PLAN;
- partial Account Equity cannot yield WITHIN PLAN;
- unknown current risk cannot yield WITHIN PLAN;
- missing Max Active Risk cannot yield WITHIN PLAN;
- complete evidence + cap breach yields EXCEEDS PLAN even if a separate funding gap also exists;
- adequate cash + complete risk evidence + under-cap risk yields WITHIN PLAN.

### Server/read-model tests

If per-Trade risk rows are exposed, lock:

- aggregate Active Risk equals the sum of known breakdown rows;
- unknown rows carry `activeRiskVnd: null`;
- legacy/unlinked holdings do not become known risk from compatibility stop fields;
- one authenticated API response contains plan, aggregate risk and breakdown from one calculation snapshot.

### UI contract tests

Lock:

- four numbered panels exist in the old 2×2 mental order;
- Panel 1 has portfolio-level metrics and no Entry/Stop fields;
- Panel 2 renders holdings/current-risk state;
- Panel 3 has Ticker, Planned Entry, Initial Stop, costs, Add Planned Trade, and planned list;
- same ticker replaces/edits its existing planned row rather than duplicating it;
- multiple different tickers coexist in Planned Trades;
- Panel 4 renders before/planned/after values and both advisor messages;
- both advisor messages use the same shared risk-context snapshot;
- switching portfolio clears planner state;
- fixed `7% stoploss` canonical path does not return;
- no certainty/risk-elimination copy returns;
- Optimal f remains informational only.

### Regression gates

Keep:

- QEO-139 sizing contracts;
- QEO-138 Money Management Plan contracts;
- QEO-137 Trade/AVCO contracts;
- AVCO regression suite;
- application lint;
- TypeScript;
- production build;
- DB drift check, with no migration expected.

## 17. Acceptance criteria

The follow-up is accepted when:

1. `/portfolio` → `Phân bổ vốn` again presents the four-panel portfolio flow familiar from the earlier UI.
2. Portfolio-level metrics and Trade-level Entry/Stop are visually and logically separated.
3. A user can create planned rows for multiple tickers, each with its own Entry, Stop and deterministic Trade Size.
4. Planned rows cumulatively update Projected Active Risk and estimated cash/funding state.
5. Current unknown risk remains unknown and prevents a false `WITHIN PLAN` verdict.
6. The UI never assumes synthetic margin when planned capital exceeds estimated cash.
7. QEO-139 stop-first formulas, cost/slippage treatment, regular-lot rounding, >2% acknowledgement and canonical terminology remain unchanged.
8. Both deterministic advisor messages are explainable from visible portfolio/trade inputs and both can comment on the resulting overall portfolio state.
9. Combined Verdict follows the documented deterministic precedence.
10. Portfolio switching never leaks drafts or planned rows between portfolios.
11. No production database migration is required.
12. Existing QEO-137/QEO-138/QEO-139 and AVCO regression gates remain green.

## 18. Implementation boundary

This is a QEO-139 presentation/read-model follow-up, not a rollback of QEO-139.

The old version contributes its four-panel information architecture and portfolio simulation mental model. The new version remains authoritative for sizing formulas, source terminology, risk evidence handling and safety behavior.
