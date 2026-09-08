# QEO-141 — Canonical Portfolio Active-Risk Engine Design

Date: 2026-09-08
Status: Approved approach A; design specification pending user review
Issue: QEO-141
Base commit: `05fa929f9cd7ce7b1e2fe337e2bc83be0d2eaa44`

## 1. Objective

Build one canonical portfolio risk engine under `modules/portfolio/risk-engine/` that becomes the deterministic source for:

- current per-Trade Active Risk;
- portfolio Active Risk and Remaining Risk Budget;
- Account Equity and current Drawdown;
- explainable `NORMAL`, `REDUCE_RISK`, `PAUSE_AND_REVIEW`, and `UNKNOWN` states;
- QEO-139 projected next-Trade risk checks;
- later QEO-142 scorecard/equity analytics without creating a second equity or drawdown implementation.

The engine must preserve existing accounting behavior. `portfolio_transactions` plus `computePortfolioPositions()` remain the canonical AVCO/P&L source. QEO-141 does not rewrite accounting, fabricate missing stops, or invent historical equity snapshots.

## 2. Explicit non-goals

QEO-141 does not:

- build the QEO-142 Trading Scorecard or Daily/Weekly/Monthly/Annual ledger UI;
- persist a new daily Account Equity snapshot table;
- infer stop events from old transaction stop fields;
- backfill unlinked legacy transactions into normalized Trades;
- reinterpret every losing Trade as a stop-out;
- estimate future sell fees, slippage, gap risk, or liquidity loss as if known;
- block recording a transaction that already occurred;
- add AI diagnosis or AI portfolio advice;
- redesign the existing portfolio theme.

## 3. Existing canonical inputs

The engine reuses these sources rather than duplicating them.

### 3.1 Accounting and fills

`modules/portfolio/pnl.ts` is canonical for AVCO/open quantity/realized P&L. Buy fees and rights costs are included in cost basis. Cash dividends reduce remaining cost basis. Sell fees reduce realized P&L.

### 3.2 Trade lifecycle

`portfolio_trades`, linked `portfolio_transactions`, `portfolio_trade_stop_events`, journal entries, and QEO-140 stop-event ↔ actual exit-fill evidence define normalized logical Trades.

`buildTradeReadModel()` already defines deterministic latest-stop precedence:

1. latest stop event by `effective_at`;
2. tie-break by `created_at`;
3. tie-break by `id`;
4. if no stop event exists, use immutable `initial_stop_loss_exit`;
5. if neither exists, stop state is unknown.

QEO-141 must reuse this ordering; it must not implement a different latest-stop algorithm.

### 3.3 Money Management Plan

QEO-138 provides:

- `max_active_risk_percent`;
- drawdown reduce threshold + reduction factor;
- drawdown pause threshold;
- consecutive stop-out rule;
- rolling Trade loss rule;
- daily/weekly/monthly holiday rules;
- execution and scale rules.

### 3.4 Current and historical market marks

Current Account Equity uses server-side current market marks from the existing intraday market service. The client does not submit canonical current prices to the risk engine.

Historical equity points use canonical `market_ohlcv_raw_daily` RAW closes only. Adjusted/cached/legacy daily series are not silently mixed into the drawdown curve.

## 4. Package ownership

Create a new package:

```text
modules/portfolio/risk-engine/
  types.ts
  active-risk.ts
  equity-curve.ts
  trade-outcomes.ts
  risk-state.ts
  server.ts
```

Responsibilities:

- `types.ts`: canonical typed read models and evidence/completeness states.
- `active-risk.ts`: pure per-Trade and portfolio Active Risk math.
- `equity-curve.ts`: pure Account Equity/equity-series/drawdown math.
- `trade-outcomes.ts`: pure closed logical-Trade outcome, explicit stop-out, rolling-loss, and period-rule evidence used only for guardrails.
- `risk-state.ts`: pure deterministic rule evaluation and state precedence.
- `server.ts`: authenticated data adapter that loads Trade/fill/stop/plan/market evidence and assembles the canonical read model.

The existing `modules/portfolio/risk-sizing/active-risk.ts` is migrated into this package rather than duplicated. QEO-139 imports the new canonical engine. A temporary re-export is allowed only if required to keep the refactor atomic; no two independent active-risk implementations may remain after QEO-141 acceptance.

## 5. Canonical Active Risk semantics

### 5.1 Per-Trade current Active Risk

For a long open Trade with known current stop and canonical AVCO:

```text
Current Active Risk = max(0, AVCO − Current Stop) × Open Quantity
```

All values are normalized to VND at the domain boundary.

Interpretation:

- AVCO already includes entry-side fees as represented by canonical accounting.
- A trailing stop at or above AVCO protects breakeven/profit and reduces downside Trade Risk to zero.
- A partial exit reduces `Open Quantity`; Active Risk therefore falls automatically without changing historical initial risk.
- Future exit commission/slippage is not added because it is not yet known.
- Actual loss can exceed Active Risk due to gaps, liquidity, volatility, overnight movement, or execution slippage.
- This is risk relative to canonical remaining cost basis, not a prediction of the incremental price move from the current market mark to the stop.

### 5.2 Unknown-risk behavior

A Trade is `RISK_UNKNOWN` when any required current-risk input is unavailable, including:

- no active or initial stop;
- no valid open position reconstructed from linked fills;
- inconsistent/dangling Trade evidence that prevents deterministic reconciliation.

Unknown is never coerced to `0`.

Portfolio totals expose both:

- `knownActiveRiskVnd`: sum of known rows only;
- `unknownRiskItemCount` and explicit incomplete coverage.

A known-risk subtotal must never be presented as if it were complete when unknown items exist.

### 5.3 Initial Risk

The immutable Trade snapshot is canonical:

- `initial_risk_amount`;
- `initial_risk_percent`;
- `initial_account_equity`;
- `planned_trade_size`.

QEO-141 does not reconstruct missing initial risk from later fills/stops.

For a still-open Trade, `initialRiskAmountVnd` remains the original planned Trade-campaign snapshot even after partial exits. It is not prorated, because prorating would rewrite the meaning of the historical plan. Current risk is represented separately by Active Risk.

`totalInitialOpenRiskVnd` is therefore the sum of available original initial-risk snapshots for currently open/partially closed Trade campaigns, accompanied by completeness metadata.

## 6. Account Equity semantics

### 6.1 Current Account Equity

For the selected portfolio:

```text
Estimated Cash
  = Initial Capital
  + Total Realized P&L
  − Remaining Open Cost Basis

Account Equity
  = Estimated Cash
  + Current Market Value of Open Positions
```

This intentionally reuses `computePortfolioPositions()` outputs, so buy/sell fees, rights, and cash dividends follow the existing accounting engine instead of parallel cash-flow math.

Current Account Equity is complete only when every open position has a valid current market mark. Missing current marks are not replaced with AVCO for canonical risk-state calculations.

The UI may continue to render existing portfolio values for usability, but QEO-141 risk outputs must label the risk/equity state incomplete if canonical marks are missing.

### 6.2 Historical daily equity points

For each completed market session in the required lookback:

1. include transactions effective up to that session date;
2. reconstruct canonical positions and realized P&L using `computePortfolioPositions()`;
3. compute Estimated Cash from the formula above;
4. mark each open ticker with that session's canonical RAW Daily close;
5. compute Market Value and Account Equity.

If any required RAW Daily close is missing for an open position, that session's equity point is `incomplete`; the engine does not substitute AVCO, adjusted close, zero, or a nearby session silently.

### 6.3 Current intraday terminal point

Current Drawdown should reflect today's portfolio, not only the previous close.

The equity series therefore may append one ephemeral `current` point after the last completed RAW Daily point when current marks are complete. This point is not persisted and is explicitly identified as current/intraday evidence.

If current marks are incomplete, current Account Equity and current Drawdown are incomplete even if historical completed-session points are valid.

## 7. Drawdown definition

QEO-141 operationalizes Account Drawdown as peak-to-current decline on the same canonical Account Equity series:

```text
Peak Equity(t) = max(Account Equity from first eligible point through t)
Drawdown Amount(t) = max(0, Peak Equity(t) − Account Equity(t))
Drawdown %(t) = Peak Equity(t) > 0
  ? Drawdown Amount(t) / Peak Equity(t) × 100
  : unavailable
```

The read model returns:

- current Account Equity;
- current Peak Equity;
- current Drawdown amount/%;
- peak timestamp/session;
- equity-series completeness;
- missing-price evidence.

QEO-142 must later consume the same equity-series primitive for max/average drawdown analytics instead of implementing a separate formula.

## 8. Closed Trade and behavioral evidence for guardrails

Guardrails operate on normalized logical Trades, not transaction count.

### 8.1 Closed Trade outcome

A closed logical Trade uses canonical linked fills and existing deterministic close-review/P&L behavior. Multi-fill and scale-out campaigns count once.

### 8.2 Explicit stop-out

A Trade counts as a stop-out only when a sell fill is explicitly linked through QEO-140 stop-event ↔ exit-fill evidence.

A losing Trade without such evidence is a losing Trade, not an inferred stop-out.

This distinction is required for `consecutiveStopOuts`.

### 8.3 Rolling Trade loss

`rollingTradeLoss` evaluates the configured latest N eligible closed logical Trades in deterministic close-time order. It uses net closed-Trade P&L and reports both the observed rolling total and sample completeness.

If fewer than the configured N eligible closed Trades exist, the rule is not silently treated as passing; it is `insufficient` unless the Money Management Plan explicitly defines otherwise in a future schema version.

### 8.4 Daily/weekly/monthly holiday rule evidence

Period rules derive lightweight guardrail evidence from closed logical Trades/equity primitives only. QEO-141 does not build a full ledger UI.

For the current period, the engine may evaluate configured fields such as:

- net loss/profit amount;
- net loss/profit percent relative to period-start Account Equity when available;
- consecutive losing Trades;
- consecutive losing days using deterministic daily net closed-Trade P&L.

Calendar grouping uses `Asia/Ho_Chi_Minh` trading dates. Missing period-start equity or incomplete closed-Trade evidence makes the affected threshold unevaluable rather than fabricated.

These primitives are intentionally reusable by QEO-142.

## 9. Risk State engine

Canonical states:

```text
NORMAL
REDUCE_RISK
PAUSE_AND_REVIEW
UNKNOWN
```

Each evaluated rule produces typed evidence:

```text
ruleId
configuredThreshold
observedValue
status = triggered | clear | insufficient
reason
source
```

### 9.1 Trigger mapping

`PAUSE_AND_REVIEW` triggers include configured rules such as:

- drawdown pause threshold reached/exceeded;
- consecutive explicit stop-outs threshold reached;
- rolling N-Trade loss rule triggered;
- enabled daily/weekly/monthly holiday rule triggered.

`REDUCE_RISK` triggers include:

- drawdown reduce threshold reached/exceeded;
- known current Active Risk exceeds configured max Active Risk cap.

`NORMAL` means all enabled required rules are evaluable and clear.

`UNKNOWN` means no known stronger state is triggered, but at least one required enabled rule or canonical risk/equity input cannot be evaluated.

### 9.2 State precedence

Evaluation is deterministic:

```text
if any known PAUSE trigger:
  PAUSE_AND_REVIEW
else if any known REDUCE trigger:
  REDUCE_RISK
else if required evidence is incomplete/insufficient:
  UNKNOWN
else:
  NORMAL
```

This prevents missing data from hiding a known severe trigger. The read model still exposes incomplete evidence alongside `PAUSE_AND_REVIEW` or `REDUCE_RISK` when applicable.

Recovery is equally deterministic: when previously triggering evidence becomes clear and all required evidence is complete, the state returns according to the same precedence without sticky hidden state.

No separate mutable `risk_state` database column is required.

## 10. Active Risk cap and Remaining Risk Budget

When current Account Equity is complete and `max_active_risk_percent` is configured:

```text
Max Active Risk VND
  = Account Equity × max_active_risk_percent / 100

Remaining Risk Budget
  = Max Active Risk VND − knownActiveRiskVnd
```

The raw arithmetic value may be negative to expose a cap breach.

If any current open risk is unknown, Remaining Risk Budget is accompanied by incomplete coverage and must not be presented as safely available capacity.

If Account Equity or the configured cap is unavailable, cap/budget values are unavailable rather than derived from a default universal percentage.

## 11. QEO-139 integration

QEO-139 must consume QEO-141's canonical current-risk context.

The previous risk-sizing-owned active-risk implementation is removed/migrated so projected risk is computed from exactly the same `knownActiveRiskVnd`, unknown coverage, Account Equity, and max-risk cap exposed in `Tài sản`.

For a planned Trade:

```text
Projected Known Active Risk
  = Canonical Known Active Risk
  + Planned Trade Risk Added
```

This preserves QEO-139's stop-first sizing math.

### 11.1 Reduced-risk default

When Risk State is `REDUCE_RISK` and the current Money Management Plan has a valid drawdown reduction factor:

```text
Effective Default Trade Risk %
  = Configured Default Trade Risk % × Risk Reduction Factor
```

The UI/API must expose:

- configured default risk %;
- effective reduced default risk %;
- reduction factor;
- exact triggering rule(s).

This affects the default suggestion only. It never silently edits the persisted Money Management Plan.

### 11.2 Pause state

`PAUSE_AND_REVIEW` does not fabricate a 0% risk size and does not mutate the plan. The sizing/planning surface remains inspectable but must expose the pause state and its reasons before new planning decisions.

Recording a fill that already occurred remains permitted. Any existing override/journal behavior remains auditable.

## 12. Authenticated server read model

Add one canonical authenticated server boundary, exposed through a portfolio risk endpoint/read model rather than having several UI components independently reconstruct risk.

The server adapter loads, at minimum:

- portfolio metadata / initial capital;
- portfolio transactions;
- open and relevant closed logical Trades;
- stop events;
- QEO-140 stop-exit-fill links when stop-out rules are enabled;
- current Money Management Plan;
- current market marks for open tickers;
- required canonical RAW Daily history for drawdown lookback.

The response is typed and contains sections similar to:

```text
account
  equityVnd
  estimatedCashVnd
  marketValueVnd
  realizedPnlVnd
  unrealizedPnlVnd
  completeness

activeRisk
  knownActiveRiskVnd
  activeRiskPercent
  unknownRiskItemCount
  maxActiveRiskVnd
  remainingRiskBudgetVnd
  initialOpenRiskVnd
  completeness
  trades[]

drawdown
  currentDrawdownVnd
  currentDrawdownPercent
  peakEquityVnd
  peakAt
  completeness

riskState
  state
  triggers[]
  insufficientRules[]
  effectiveDefaultTradeRiskPercent
```

The endpoint is `no-store` and user/portfolio scoped through existing auth patterns.

## 13. UI integration in `Tài sản`

The existing holdings/P&L layout remains intact. Add risk information within current summary/card/table vocabulary instead of a theme redesign.

Required portfolio-level outputs:

- Account Equity;
- cash / market value;
- realized / unrealized P&L;
- current Drawdown;
- total initial open risk;
- current Active Risk;
- Active Risk %;
- Max Active Risk;
- Remaining Risk Budget;
- Risk State + exact reasons.

Position/Trade detail should expose where space permits:

- initial stop;
- current stop;
- latest stop effective time;
- initial risk snapshot;
- current Active Risk;
- missing-stop / unknown-risk status.

### 13.1 Localization policy

The latest project-wide user instruction overrides the older English-primary wording in the Linear issue.

Primary visible labels are Vietnamese. Canonical English/source terminology is retained in tooltips/help, for example:

```text
Rủi ro đang hoạt động
Tooltip: Thuật ngữ gốc: Active Risk
```

Tooltips explain formula, evidence source, limitations, and missing-data behavior. They must remain neutral and non-judgmental.

The canonical English terms still exist in typed terminology metadata for later QEO-145 grounding.

## 14. Failure and completeness policy

The engine is fail-closed for risk conclusions but not for portfolio usability.

Examples:

- missing stop → Trade risk unknown, never zero;
- missing RAW Daily mark → affected equity point incomplete;
- missing current mark → current equity/drawdown incomplete;
- incomplete current risk → known subtotal retained but coverage flagged;
- missing plan cap → no Max Active Risk/Remaining Risk Budget conclusion;
- fewer closed Trades than rolling window → insufficient rule evidence;
- losing Trade with no explicit stop link → not a stop-out;
- database/provider error at the canonical server boundary → explicit unavailable/error response; do not silently use stale client calculations as authoritative risk state.

## 15. Test strategy

Implementation follows TDD. Required deterministic coverage includes at least:

### Active Risk

- normal stop below AVCO;
- trailing stop exactly at AVCO → zero Active Risk;
- trailing stop above AVCO → zero Active Risk;
- partial exit reduces Open Quantity and Active Risk;
- buy fee changes AVCO and therefore risk correctly;
- missing stop → `RISK_UNKNOWN`;
- multiple stop events use existing latest-stop precedence;
- initial-stop fallback only when no later stop event exists.

### Account Equity / Drawdown

- current equity reconciles Estimated Cash + current Market Value;
- full close moves P&L into realized equity without double counting cost;
- rights/cash dividend paths remain consistent with canonical AVCO engine;
- historical daily equity uses RAW Daily marks;
- missing required RAW Daily price → incomplete point, no fallback;
- peak/drawdown math;
- new high resets current drawdown to zero;
- intraday current point can create or recover drawdown;
- missing current mark makes current drawdown incomplete.

### Risk State

- Active Risk cap breach → `REDUCE_RISK`;
- drawdown reduce threshold → `REDUCE_RISK`;
- drawdown pause threshold → `PAUSE_AND_REVIEW`;
- explicit consecutive stop-outs trigger only from linked stop-exit evidence;
- ordinary losing Trades do not count as stop-outs;
- rolling-N loss trigger and insufficient-sample behavior;
- holiday-period trigger;
- precedence: pause > reduce > unknown > normal as defined by evaluation algorithm;
- recovery after triggering conditions clear;
- rule evidence includes threshold, observed value, source, and explanation.

### QEO-139 reconciliation

- projected known Active Risk starts from the exact QEO-141 known subtotal;
- unknown current risk keeps projected portfolio state incomplete;
- reduced-risk factor changes only effective default sizing input;
- persisted default risk remains unchanged;
- existing AVCO, QEO-137, QEO-138, QEO-139, and QEO-140 regression suites remain green.

## 16. Data and migration plan

Initial QEO-141 implementation requires no new database table or backfill.

Reasoning:

- current Active Risk derives from existing normalized Trades/fills/stops;
- risk rules already live in QEO-138 Money Management Plan;
- Account Equity history can be deterministically derived from canonical transactions + RAW Daily marks;
- stop-out evidence already exists from QEO-140;
- persisting equity snapshots would create lifecycle/scheduler/state-reconciliation scope that belongs only if later profiling proves on-demand derivation inadequate.

If implementation uncovers a requirement that truly cannot be met without persisted equity snapshots or new schema, the architecture must be re-approved before adding a migration.

## 17. Rollout sequence

After this spec is approved, implementation planning should preserve this order:

1. canonical pure Active Risk types/math and QEO-139 ownership migration;
2. pure current Account Equity and daily equity/drawdown engine;
3. closed-Trade/stop-out/rolling-period evidence primitives;
4. deterministic Risk State engine;
5. authenticated server adapter/API;
6. QEO-139 reconciliation and reduced-risk default integration;
7. `Tài sản` UI/read-model integration with Vietnamese-primary terminology;
8. exact-head regression/build gates;
9. production acceptance and Linear evidence.

Backend canonical behavior is established before frontend wiring.

## 18. Acceptance interpretation

QEO-141 is complete only when:

- Active Risk reconciles from normalized open Trades + latest stop evidence;
- no-stop positions/Trades remain explicitly unknown;
- Account Equity and Drawdown have one deterministic tested definition;
- current risk state returns exact triggering rule evidence;
- QEO-139 projected next-Trade risk consumes the same canonical current risk context;
- existing holdings/P&L calculations remain unchanged;
- required edge cases are covered by deterministic tests;
- production deployment is verified without runtime regression;
- authenticated UI interaction evidence is reported separately from unauthenticated route smoke evidence when tooling cannot access a signed-in user session.
