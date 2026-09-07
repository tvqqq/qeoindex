# QEO-138 — Risk Profile, Discipline Profile + Personal Money Management Plan Design

Date: 2026-09-07
Status: Approved design, implementation planning pending user review
Owner issue: QEO-138
Parent: QEO-136
Stacked dependency: QEO-137 exact accepted head `7c0276ec26fcac2027ded8fabaca781a4f4d0c27`
Source terminology authority: QEO-131 McDowell source contract/glossary

## Goal

Add a per-portfolio, auditable risk-planning layer to `/portfolio` that implements McDowell's Chapter 13 Risk Profile, Discipline Profile, and Chapter 14 personal Money Management Plan concepts without changing the existing Portfolio theme, AVCO accounting, or QEO-137 Trade/Fill lifecycle model.

The feature must let a user assess risk/process discipline, save explicit portfolio-level operating rules, retake profiles over time, and create new immutable plan versions. Later QEO-139/QEO-141 work must be able to consume the latest plan deterministically, while existing Trades retain their entry-time risk snapshot and optional plan provenance.

## Source-fidelity boundary

QEO-131 remains the implementation authority. This design preserves its `[BOOK] / [PRODUCT] / [EXTENSION]` distinction.

Hard source rules:

- primary metric/rule labels use canonical English terminology where practical;
- Vietnamese is used for tooltip/help/explanatory copy;
- Risk Profile and Discipline Profile each contain six 5/10/15-point questions, total 30–90;
- printed 30–50 / 50–70 / 70–90 interpretation bands overlap at 50 and 70;
- product uses deterministic `30–45`, `50–65`, `70–90` operational ranges and must disclose this as software disambiguation rather than verbatim book wording;
- a low Risk Profile score must never automatically increase `Risk per Trade` above 2%;
- 2%, 6%, 10%, 10%/15% drawdown thresholds, seven stop-outs, losing sets of 25 Trades, 30/30/40 scaling, thirds, and similar values are source examples/presets, not universal mandates;
- the supplied source does not support a universal exact Risk-of-Ruin calculator, so QEO-138 does not add one;
- dated left-brain/right-brain claims are not shipped as product facts;
- profile guidance remains neutral and non-diagnostic.

## Non-goals

QEO-138 does not:

- replace or refactor `portfolio_transactions` AVCO accounting;
- redesign the Trade lifecycle introduced by QEO-137;
- rewrite the existing capital-allocation calculator formula/copy; QEO-139 owns the stop-first Proper Trade Size calculator and removal of the current fixed 7% stop assumption;
- calculate portfolio Active Risk; QEO-141 owns risk-to-stop aggregation and drawdown/streak enforcement;
- build the full Trading Scorecard/ledger analytics; QEO-142 owns those outputs;
- group legacy transactions into Trades; QEO-143 owns migration/backfill policy;
- add AI/LLM recommendation behavior; QEO-145 remains final;
- persist default plans silently for legacy portfolios.

## Existing system constraints

The QEO-138 branch is stacked on the verified QEO-137 head so it can rely on:

- `portfolio_trades` as canonical logical Trade identity;
- `portfolio_transactions` as accounting Fill source of truth;
- Trade initial-risk snapshots that freeze after open;
- stop/journal history;
- `modules/portfolio/trades/*` server/domain boundary;
- `TradeReadModel` completeness semantics.

Current `/portfolio` UI has five tabs: `Tài sản`, `Nhật ký`, `Phân bổ vốn`, `Hiệu suất`, `Theo dõi`. `Phân bổ vốn` currently renders `PortfolioCapitalAllocation` directly. QEO-138 adds risk-planning UI inside this existing tab and keeps the current calculator present and behaviorally unchanged until QEO-139.

## Chosen ownership model

Risk Profile, Discipline Profile, and Money Management Plan are all **per portfolio**.

Rationale:

- Risk Profile inputs depend on the history/performance of the selected portfolio;
- live/paper portfolios can require different operating rules;
- plan history must line up with the Trade/risk snapshots that belong to the same portfolio;
- per-portfolio ownership avoids ambiguous cross-portfolio inheritance and keeps RLS/foreign-key ownership consistent with QEO-137.

The application may later offer explicit copying of a plan between portfolios, but QEO-138 will not introduce implicit account-global inheritance.

## Data model overview

```text
portfolios
  |
  +-- portfolio_risk_profile_attempts[]
  +-- portfolio_discipline_profile_attempts[]
  +-- portfolio_money_management_plans[]   # immutable versions
  |
  +-- portfolio_trades[]
          +-- money_management_plan_id?    # optional entry-time provenance
```

No table is backfilled with fabricated profile answers or plan values.

## 1. `portfolio_risk_profile_attempts`

Purpose: immutable historical record of each completed Risk Profile assessment for one portfolio.

Recommended columns:

```text
id uuid primary key
portfolio_id uuid not null
user_id uuid not null
market_risk_points smallint not null
active_return_12m_points smallint not null
win_ratio_points smallint not null
personal_risk_tolerance_points smallint not null
experience_points smallint not null
payoff_ratio_points smallint not null
total_score smallint not null
score_band text not null                 # low | middle | high
metric_evidence jsonb not null default '{}'
created_at timestamptz not null default now()
```

Constraints:

- every question score is exactly one of `5, 10, 15`;
- total is exactly the sum of the six stored question points and must be 30–90;
- score band must match the product operational ranges `30–45`, `50–65`, `70–90`;
- `(portfolio_id, user_id)` must reference the owned portfolio using the QEO-137 ownership pattern;
- attempts are append-only through normal authenticated product APIs.

### Risk Profile source questions

The source contract defines:

1. perceived risk level of traded market;
2. 12-month active trading account return;
3. average Win Ratio;
4. personal risk tolerance;
5. trading experience / 12-month profitability;
6. average Payoff Ratio.

Source scoring anchors:

- market risk: low/no leverage = 5, medium/stocks = 10, high/futures/leverage = 15;
- 12-month return: +50% or more = 5, +10% to below +50% = 10, loss or below +10% = 15;
- Win Ratio: 50–100% = 5, 35% to below 50% = 10, below 35% = 15;
- risk tolerance: low = 5, medium = 10, high = 15;
- experience: consistently profitable over 12 months = 5, breaking even = 10, no experience/consistently losing = 15;
- Payoff Ratio: better than 3:1 = 5, 2:1 through 3:1 = 10, worse than 2:1 = 15.

For numeric auto-prefill, QEO-138 uses deterministic boundary mapping as a `[PRODUCT]` operationalization:

```text
12m return:  >= 50 -> 5; >= 10 -> 10; otherwise -> 15
Win Ratio:   >= 50 -> 5; >= 35 -> 10; otherwise -> 15
Payoff Ratio: > 3 -> 5; >= 2 -> 10; otherwise -> 15
```

The UI must not present those inequality operators as a direct quote from McDowell.

### `metric_evidence` contract

`metric_evidence` is typed JSONB and records why an answer was auto-prefilled, manually selected, or unavailable. It must preserve provenance rather than merely storing a score.

Application type:

```ts
type ProfileMetricEvidence = {
  source: "manual" | "canonical_closed_trades" | "account_equity_history" | "unavailable"
  value: number | null
  periodStart: string | null
  periodEnd: string | null
  sampleSize: number | null
  completeness: "complete" | "partial" | "insufficient"
  computedAt: string | null
  note?: string
}

type RiskProfileMetricEvidenceMap = {
  activeReturn12m: ProfileMetricEvidence
  winRatio: ProfileMetricEvidence
  payoffRatio: ProfileMetricEvidence
}
```

Unknown/unavailable is never coerced to zero.

## 2. `portfolio_discipline_profile_attempts`

Purpose: immutable historical record of each completed Discipline Profile assessment.

Recommended columns:

```text
id uuid primary key
portfolio_id uuid not null
user_id uuid not null
punctuality_points smallint not null
diet_self_control_points smallint not null
record_keeping_points smallint not null
office_clutter_points smallint not null
bills_expenses_points smallint not null
exercise_routine_points smallint not null
total_score smallint not null
score_band text not null                 # low | middle | high
created_at timestamptz not null default now()
```

The source contract supports the six topics and 5/10/15 scoring but does not provide implementation-ready modern option copy in the QEO-131 glossary. Therefore QEO-138 may respectfully paraphrase choices from the supplied source, but must not claim invented wording is verbatim book text.

Product interpretation copy:

- 30–45: process currently shows high consistency; continue checklist/record keeping;
- 50–65: moderate consistency; reminders/checklists can support repeatability;
- 70–90: add stronger process guardrails, required fields, reminders, review prompts, and daily record keeping.

No mental-health/personality diagnosis is implied.

## 3. `portfolio_money_management_plans`

Purpose: append-only, versioned operating rules for one portfolio.

Each successful Save creates a **new immutable version**. Existing versions are never overwritten. The current plan is deterministically the highest version for the portfolio. Reverting to old settings means creating a new version copied from an older one.

Recommended columns:

```text
id uuid primary key
portfolio_id uuid not null
user_id uuid not null
version integer not null
risk_profile_attempt_id uuid null
discipline_profile_attempt_id uuid null
schema_version integer not null default 1

default_trade_risk_percent numeric not null
advanced_risk_override_acknowledged boolean not null default false
max_active_risk_percent numeric not null

drawdown_reduce_enabled boolean not null default false
drawdown_reduce_threshold_percent numeric null
risk_reduction_factor numeric null

drawdown_pause_enabled boolean not null default false
drawdown_pause_threshold_percent numeric null

consecutive_stop_outs_enabled boolean not null default false
consecutive_stop_outs_threshold integer null
rolling_trade_loss_enabled boolean not null default false
rolling_trade_count integer null

holiday_rules jsonb not null default '{}'
execution_rules jsonb not null default '{}'
scale_rules jsonb not null default '{}'
diversification_rules jsonb not null default '{}'
risk_capital_policy jsonb not null default '{}'
notes text null
created_at timestamptz not null default now()
```

Uniqueness/integrity:

- unique `(portfolio_id, version)`;
- unique composite identity `(id, portfolio_id, user_id)` for ownership-safe downstream references;
- optional profile attempt FKs must reference attempts belonging to the same `(portfolio_id, user_id)`;
- version allocation must be concurrency-safe at the database/server boundary; two simultaneous Saves must not produce duplicate versions.

### Normalized numeric fields

These values are normalized because QEO-139/QEO-141 need deterministic query access:

- `default_trade_risk_percent`;
- `max_active_risk_percent`;
- drawdown reduce/pause thresholds;
- risk reduction factor;
- consecutive stop-out threshold;
- rolling losing-Trade window size.

### Typed JSONB rule groups

Flexible Chapter 14 operating rules are stored as typed JSONB because they vary in shape and should not require a migration for every optional preference.

#### `holiday_rules`

```ts
type HolidayRules = {
  daily?: {
    enabled: boolean
    consecutiveLosingTrades?: number
    lossAmount?: number
    lossPercent?: number
    profitAmount?: number
    profitPercent?: number
  }
  weekly?: {
    enabled: boolean
    consecutiveLosingDays?: number
    lossAmount?: number
    lossPercent?: number
    profitAmount?: number
    profitPercent?: number
  }
  monthly?: {
    enabled: boolean
    lossPercent?: number
    losingTradeWindow?: number
  }
}
```

#### `execution_rules`

```ts
type ExecutionRules = {
  defineInitialStopBeforeEntry: boolean
  honorStopWhenHit: boolean
  stopUsesMarketOrSystemRules: boolean
  trailingStopsWhenAppropriate: boolean
  doNotMoveStopEmotionally: boolean
  recalculateRiskWhenScalingIn: boolean
  dailyRecordKeeping: boolean
}
```

#### `scale_rules`

```ts
type ScaleRules = {
  scaleInOnlyToWinningPosition: boolean
  prohibitDoublingDown: boolean
  scaleOutMode: "none" | "thirds" | "30_30_40" | "signal_driven" | "custom"
  customScaleOutPercentages?: number[]
}
```

Source templates such as thirds or 30/30/40 are displayed as examples. A custom percentage list must sum to 100 when enabled.

#### `diversification_rules`

```ts
type DiversificationRules = {
  enabled: boolean
  maxSectorRiskPercent?: number
  concentrationWarningPercent?: number
}
```

The book's 2% per-sector example under a 6% account-risk cap is an optional preset, not a hardcoded default.

#### `risk_capital_policy`

```ts
type RiskCapitalPolicy =
  | { mode: "disabled" }
  | { mode: "risk_capital_amount"; amount: number }
  | { mode: "net_worth_percent"; percent: number }
```

Total net worth is not required. The book's 10% rule of thumb may be shown as an optional source example with a caveat; it is not automatically selected.

## Plan validation contract

Domain validation, not UI state, is authoritative.

Rules:

- all percentages must be finite, greater than 0 when enabled, and no greater than 100;
- `default_trade_risk_percent > 2` requires `advanced_risk_override_acknowledged = true`;
- no profile score can auto-set a risk value above 2%;
- `max_active_risk_percent` must be at least the configured default Trade risk so the plan is not internally impossible by default;
- enabled drawdown rules require their corresponding threshold;
- when both drawdown actions are enabled, pause threshold must be greater than or equal to reduce-risk threshold;
- `risk_reduction_factor` must be greater than 0 and less than 1; the book example 25% reduction is represented as factor `0.75`;
- enabled stop-out/rolling windows require positive integers;
- custom scale-out percentages must each be positive and total 100 within deterministic decimal tolerance;
- unknown/disabled optional rules remain explicit rather than acquiring hidden defaults.

These validation rules are `[PRODUCT]` operational safeguards unless explicitly sourced above.

## Trade provenance link

QEO-138 adds a nullable entry-time reference on `portfolio_trades`:

```text
money_management_plan_id uuid null
```

Ownership-safe composite FK:

```text
(money_management_plan_id, portfolio_id, user_id)
  -> portfolio_money_management_plans(id, portfolio_id, user_id)
```

Rules:

- legacy/current Trades are not backfilled;
- `null` means no plan provenance is known, not "default plan";
- while a Trade is still `planned`, the domain may attach/change the plan reference;
- once the Trade transitions to `open`, the plan reference is immutable through normal APIs, matching QEO-137's initial-risk snapshot freeze rule;
- later plan versions never rewrite old Trade snapshots or their plan reference.

This gives QEO-139/QEO-141/QEO-145 exact provenance without coupling historical Trades to whatever plan happens to be current today.

## Risk Profile auto-prefill evidence

Auto-prefill must be conservative and deterministic.

### Win Ratio / Payoff Ratio

Only canonical **closed logical Trades** may contribute. Raw transaction count is never used as Trade count.

QEO-138 may reuse existing AVCO accounting logic by evaluating the linked fills of each closed Trade as one accounting campaign. A Trade contributes only when its closed outcome is deterministically calculable and complete. Legacy rows with `trade_id = null` are excluded rather than heuristically grouped.

For an eligible sample:

```text
Win Ratio = winning closed Trades / total eligible closed Trades
Payoff Ratio = average winning Trade / abs(average losing Trade)
```

If there are no losing Trades, Payoff Ratio is not forced to infinity for profile scoring; evidence remains insufficient/manual review is required.

Every prefill displays/stores:

- selected period;
- number of eligible closed Trades;
- excluded/incomplete count when material;
- calculation timestamp;
- completeness state.

### 12-month active trading account return

The source asks for account return, not merely sum of Trade P/L. QEO-138 must not approximate this from incomplete transaction history or current NAV.

Auto-prefill is allowed only when the application has deterministic starting/ending Account Equity evidence for the 12-month period. Otherwise the UI presents `Insufficient History` and lets the user select/confirm the source score category manually.

### Experience/profitability

The source question is broader than a single derived metric. QEO-138 may show available 12-month performance evidence as help, but the user confirms the final answer unless a future canonical performance service can prove the category exactly.

## Read model

Create a deterministic per-portfolio risk-plan read model that later features consume instead of scraping UI state.

Recommended shape:

```ts
type PortfolioRiskPlanReadModel = {
  portfolioId: string
  latestRiskProfile: RiskProfileAttempt | null
  latestDisciplineProfile: DisciplineProfileAttempt | null
  currentPlan: MoneyManagementPlan | null
  planVersion: number | null
  profileHistoryCount: {
    risk: number
    discipline: number
  }
  prefillEvidence: RiskProfilePrefillEvidence
  completeness: {
    riskProfile: "available" | "missing"
    disciplineProfile: "available" | "missing"
    moneyManagementPlan: "available" | "missing"
    performanceEvidence: "complete" | "partial" | "insufficient"
  }
}
```

QEO-137's Trade read boundary may be extended to expose `moneyManagementPlanId` / `moneyManagementPlanVersion` when a Trade has provenance. No LLM code is added.

## Domain/module boundary

Create a focused module:

```text
modules/portfolio/risk-plan/
  types.ts
  scoring.ts
  validation.ts
  profile-evidence.ts
  read-model.ts
  server.ts
```

Responsibilities:

### `types.ts`

- profile attempt DTOs;
- plan/rule JSON types;
- evidence/completeness types;
- no Supabase client code.

### `scoring.ts`

Pure deterministic functions:

```text
scoreRiskProfile
scoreDisciplineProfile
riskProfilePointsFromMetrics
profileScoreBand
```

No UI text, database calls, or LLM behavior.

### `validation.ts`

- strict payload parsing/normalization;
- plan cross-field validation;
- typed JSONB validation;
- score/point validation;
- no database access.

### `profile-evidence.ts`

- loads only deterministic canonical evidence required for optional Risk Profile prefill;
- uses logical Trade identity and existing AVCO accounting semantics;
- never groups legacy transactions heuristically;
- returns explicit insufficient/partial states.

### `read-model.ts`

- builds latest-attempt/current-plan view;
- derives completeness/provenance states;
- no React dependency.

### `server.ts`

Authenticated server-only persistence functions, for example:

```text
getPortfolioRiskPlan
createRiskProfileAttempt
listRiskProfileAttempts
createDisciplineProfileAttempt
listDisciplineProfileAttempts
createMoneyManagementPlanVersion
listMoneyManagementPlanVersions
getCurrentMoneyManagementPlan
```

All operations must verify portfolio ownership and keep version allocation concurrency-safe.

## API boundary

Use thin authenticated route adapters over `modules/portfolio/risk-plan/server.ts`.

Recommended routes:

```text
GET  /api/portfolio/[id]/risk-plan
GET  /api/portfolio/[id]/risk-plan/risk-profile
POST /api/portfolio/[id]/risk-plan/risk-profile
GET  /api/portfolio/[id]/risk-plan/discipline-profile
POST /api/portfolio/[id]/risk-plan/discipline-profile
GET  /api/portfolio/[id]/risk-plan/plans
POST /api/portfolio/[id]/risk-plan/plans
```

`GET /risk-plan` returns the dashboard read model, including prefill evidence. POST endpoints create immutable history/version rows; no PATCH endpoint mutates an existing saved plan version or profile attempt.

The UI must not call Supabase directly.

## UI integration

Keep the existing `/portfolio` theme, card shapes, typography, dark surfaces, purple/indigo accent language, and five-tab navigation.

Change `Phân bổ vốn` from:

```text
PortfolioCapitalAllocation
```

to:

```text
PortfolioRiskManagement
PortfolioCapitalAllocation
```

within the same tab/vertical flow. The existing calculator remains visually and behaviorally intact in QEO-138.

### `PortfolioRiskManagement` surface

Recommended top-level card shows:

- `Risk Profile` score/band or `Not completed`;
- `Discipline Profile` score/band or `Not completed`;
- `Money Management Plan` current version / `Not configured`;
- `Risk per Trade`;
- `Max Active Risk`;
- last saved timestamp;
- actions: `Take / Retake Risk Profile`, `Take / Retake Discipline Profile`, `Edit Money Management Plan`, `View History`.

Dialogs/forms use existing Button/Input/Dialog/Tooltip primitives and must remain mobile-friendly.

### Tooltip rule

Every metric/parameter label has a tooltip/help surface. Canonical English is primary; Vietnamese explains:

1. what the field means;
2. formula/scoring rule where applicable;
3. why it affects risk decisions;
4. whether the number is a book example, product operationalization, or user-configurable rule;
5. caveat where applicable.

Auto-prefilled `Win Ratio`, `Payoff Ratio`, and return evidence additionally show period/sample/completeness.

### Profile UX

- show six questions one page or compact stepper without changing global visual language;
- display selected 5/10/15 score transparently;
- auto-prefilled answers remain reviewable/confirmable;
- `Insufficient History` is a first-class state, not an error;
- results use neutral guidance and never recommend automatic risk escalation.

### Money Management Plan UX

Sections:

1. `Risk per Trade`;
2. `Max Active Risk`;
3. `Drawdown / Stop-Out Rules`;
4. `Holiday / Pause Rules`;
5. `Execution Rules`;
6. `Scaling Rules`;
7. `Diversification`;
8. optional `Risk Capital`.

Source examples appear as selectable presets with an explicit `McDowell example` indication. User can choose another valid value or disable optional rules.

Saving displays the new version number and keeps prior versions read-only in history.

## Migration strategy

Migration is additive and safe:

1. create `portfolio_risk_profile_attempts`;
2. create `portfolio_discipline_profile_attempts`;
3. create `portfolio_money_management_plans`;
4. add ownership-safe indexes/FKs/RLS;
5. add nullable `money_management_plan_id` to `portfolio_trades` with composite ownership FK;
6. generate Supabase TypeScript types;
7. do **not** insert profile/plan rows for existing portfolios;
8. do **not** attach a plan to existing Trades;
9. do **not** mutate QEO-137 initial-risk snapshots or existing accounting rows.

Rollback remains structurally safe because existing Portfolio/Trade/Transaction behavior does not depend on fabricated defaults.

## RLS / privilege contract

All three new tables:

- RLS enabled;
- anonymous access revoked;
- authenticated SELECT/INSERT only for profile attempts and immutable plan versions unless a demonstrated product need requires stronger mutation rights;
- ownership predicates use `user_id = (select auth.uid())`;
- relational ownership to `portfolios(id, user_id)` prevents cross-user portfolio rows;
- no authenticated UPDATE/DELETE API exists for saved attempts/versions in QEO-138.

If database grants allow broader mutation than product behavior, migration hardening should narrow them so the immutable history claim is true at the database boundary, not only in UI code.

## Concurrency and versioning

`createMoneyManagementPlanVersion` must allocate versions atomically.

Acceptable implementation strategies:

- a single SECURITY DEFINER/service function that locks the portfolio or plan-version key, calculates `max(version)+1`, validates ownership, inserts, and returns the row; or
- equivalent serializable transaction semantics with uniqueness retry.

The selected implementation must be covered by a test proving two concurrent Saves cannot create duplicate version numbers.

## Error handling

Domain/API errors are explicit:

- 400: invalid profile points, malformed rules, invalid thresholds, missing advanced override acknowledgement;
- 401: unauthenticated;
- 403/404: portfolio or referenced attempt/plan not owned/visible;
- 409: version allocation/conflict that cannot be safely retried;
- 422: cross-field plan inconsistency such as pause threshold below reduce threshold or invalid custom scale-out total;
- 500: unexpected persistence failures with bounded server logging.

No endpoint silently coerces invalid values into source presets.

## Testing strategy

Implementation follows TDD.

### Source/scoring unit tests

Verify:

- each Risk Profile source bucket maps to 5/10/15 deterministically;
- score totals are exact sums;
- total bands: 30/45 -> low, 50/65 -> middle, 70/90 -> high;
- invalid/non-multiple values are rejected;
- no scoring path writes or recommends >2% risk;
- Win Ratio boundary 50 maps to source first band; 35 maps to middle;
- 12-month return boundary 50 maps to first band; 10 maps to middle;
- Payoff Ratio >3 / 2–3 / <2 mapping is deterministic.

### Plan validation unit tests

Verify:

- >2% requires explicit advanced acknowledgement;
- Max Active Risk cannot be below default Trade risk;
- drawdown threshold dependencies;
- 0.75 reduction factor accepted as the source 25%-reduction example;
- disabled rules can omit values;
- custom scale-out must total 100;
- typed JSONB serialization round-trips without hidden defaults.

### Evidence tests

Verify:

- only closed logical Trades count;
- scale-out fills remain one Trade outcome;
- ungrouped legacy transactions are excluded;
- incomplete Trade evidence produces partial/insufficient state;
- no losing sample does not produce infinite Payoff Ratio;
- 12-month return remains unavailable without deterministic account-equity history;
- period/sample provenance is returned.

### Migration / RLS tests

Verify:

- all three new history/version tables exist;
- RLS enabled;
- authenticated history is ownership-scoped;
- attempts/plans cannot reference another portfolio/user;
- saved rows are immutable through authenticated API/privilege surface;
- `portfolio_trades.money_management_plan_id` remains nullable;
- existing Trade/Transaction rows are unchanged after migration;
- generated database types match zero-to-latest replay.

### Server/API tests

Verify:

- create and retake both profiles;
- latest attempt selection is deterministic;
- create plan v1 then v2 without rewriting v1;
- profile-attempt links belong to the same portfolio;
- current plan is highest version;
- concurrent Save cannot duplicate version;
- no plan exists for untouched legacy portfolio;
- Trade plan provenance can be attached while planned and freezes after open.

### UI acceptance tests

Verify:

- existing five tabs/theme remain unchanged;
- QEO-138 surface appears only inside `Phân bổ vốn`;
- English canonical labels have Vietnamese tooltip/help;
- source presets are visibly examples, not forced defaults;
- `Insufficient History` is rendered clearly;
- plan history is read-only;
- changing portfolio never displays stale plan/profile state from the previous portfolio;
- existing `PortfolioCapitalAllocation` still renders and calculates exactly as before QEO-138.

## Acceptance criteria

QEO-138 is complete when:

- Risk Profile and Discipline Profile persist per portfolio and can be retaken without overwriting prior attempts;
- score bands are deterministic and source ambiguity is disclosed;
- performance auto-prefill never fabricates unavailable history and always exposes period/sample/provenance;
- Money Management Plan saves immutable versions with configurable source-inspired rules;
- >2% risk is never auto-selected and requires explicit advanced acknowledgement if chosen manually;
- plan changes never rewrite historical Trade initial-risk snapshots;
- new Trades can retain nullable entry-time plan provenance;
- RLS/ownership and DB immutability are verified;
- QEO-137 AVCO/Trade regressions remain green;
- existing capital-allocation calculator is not behaviorally changed in this issue;
- canonical English terminology + Vietnamese tooltips are implemented across the QEO-138 surface;
- no AI behavior is introduced.

## Implementation dependency handoff

QEO-138 may be implemented on the stacked branch while QEO-137 PR #360 remains in review, because the branch is based on the exact QEO-137 accepted head. Before merging QEO-138 to `main`, QEO-137 must be integrated first or QEO-138 must be rebased onto the equivalent merged QEO-137 source.

After this written spec is reviewed/approved, create the implementation plan under `docs/superpowers/plans/` and execute it with TDD. No implementation code should begin before that review gate.