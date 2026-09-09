# QEO-159 — Deterministic Concentration & Diversification Guardrails Design

Date: 2026-09-09
Issue: QEO-159
Base: `main` at `2d596ffb5fccb622c488d28f4b550674feb90574`

## 1. Objective

QEO-159 closes the deterministic concentration/diversification gap in Portfolio & Risk Management. The Money Management Plan already persists user-authored diversification rules, QEO-141 already computes canonical Account Equity and per-open-trade Active Risk, and QEO-139 already projects trade risk before confirmation. QEO-159 composes those existing deterministic sources into explainable concentration checks without introducing AI classification, AI recommendations, or universal diversification defaults.

The feature must answer four questions consistently:

1. How concentrated is the current portfolio by ticker market value?
2. How concentrated is current downside exposure by ticker and sector Active Risk?
3. Is the portfolio currently within the user's configured diversification plan?
4. Would a planned trade create or worsen a configured concentration/diversification conflict?

Warnings are advisory and auditable. They may inform planning but must never prevent recording an already-executed or historical fill.

## 2. Existing canonical inputs

QEO-159 must reuse, not reimplement, these sources:

- canonical holdings/positions from the existing portfolio read path;
- Account Equity and completeness from QEO-141/QEO-158;
- QEO-141 per-open-trade `activeRiskVnd` and `riskStatus`;
- the latest versioned Money Management Plan from QEO-138;
- structured sector metadata from the canonical market universe/KFSP-derived universe payload where `sector` is `string | null`;
- existing trade journal/audit `override_reason` from QEO-137;
- QEO-139 planned quantity, planned risk and projected-risk context.

### Sector-source constraint

`modules/market/sectors.ts::sectorForTicker()` is not valid evidence for QEO-159 because it defaults an unknown ticker to `Công nghiệp & Vật liệu`. QEO-159 must consume an explicit structured-sector lookup that distinguishes:

- sector present from canonical structured data; versus
- sector unavailable.

Unavailable classification is `UNKNOWN`; it must never be guessed into a sector.

## 3. Non-goals

QEO-159 does not:

- create AI sector/industry classification;
- invent default ticker, sector, or open-position limits;
- change the QEO-139 sizing formula;
- change the QEO-141 Active Risk formula;
- replace portfolio risk budget rules;
- block transaction/fill recording;
- calculate covariance, beta, correlation, VaR, factor exposure or statistical portfolio diversification;
- claim a sector taxonomy more granular than the structured source actually supplies.

## 4. Architecture

Create a focused deterministic domain under:

`modules/portfolio/concentration/`

Recommended units:

- `types.ts` — public typed inputs/results and provenance;
- `evaluate-current.ts` — pure current-portfolio evaluator;
- `project-trade.ts` — pure planned-trade projection;
- `sector-metadata.ts` — server-side structured sector lookup adapter with explicit missing values;
- `server.ts` — composes portfolio holdings, QEO-141 risk read model, current Money Management Plan and sector metadata;
- optional small helpers for aggregation only when they materially simplify testing.

The concentration domain owns concentration semantics. QEO-141 remains the source of Active Risk. QEO-139 remains the source of sizing. UI layers consume the new read model rather than duplicating calculations.

## 5. Money Management Plan contract

Existing plan JSON:

```ts
type DiversificationRules = {
  enabled: boolean
  maxSectorRiskPercent?: number
  concentrationWarningPercent?: number
}
```

Extend it backward-compatibly to:

```ts
type DiversificationRules = {
  enabled: boolean
  concentrationWarningPercent?: number
  maxTickerConcentrationPercent?: number
  maxSectorRiskPercent?: number
  maxConcurrentOpenPositions?: number
}
```

Semantics:

- `concentrationWarningPercent`: advisory ticker market-value warning threshold. It is not silently promoted to a hard breach threshold.
- `maxTickerConcentrationPercent`: optional hard user-configured maximum ticker market-value concentration.
- `maxSectorRiskPercent`: optional hard user-configured maximum sector Active Risk as percent of current Account Equity.
- `maxConcurrentOpenPositions`: optional hard maximum number of concurrently open tickers/positions.

When `diversificationRules.enabled === false`, rules are considered not configured for enforcement. Metrics may still be shown, but check status must not imply a user plan violation.

No schema migration is expected because `diversification_rules` is already versioned JSONB. Validation and UI serialization must remain backward compatible with old versions that omit the new fields.

## 6. Typed result model

All checks use:

```ts
type ConcentrationStatus =
  | "WITHIN_PLAN"
  | "WARNING"
  | "BREACH"
  | "UNKNOWN"
```

A normalized check should carry at minimum:

```ts
type ConcentrationCheck = {
  id: string
  kind:
    | "ticker_market_value"
    | "ticker_active_risk"
    | "sector_active_risk"
    | "open_position_count"
  status: ConcentrationStatus
  metricValue: number | null
  metricUnit: "percent" | "count" | "vnd"
  warningThreshold: number | null
  breachThreshold: number | null
  ticker: string | null
  sector: string | null
  basis: string
  completeness: "complete" | "partial" | "insufficient"
  provenance: string[]
  reason: string
}
```

Exact field names may be refined during implementation, but output must preserve the information above and remain serializable through API/read models.

## 7. Current-portfolio calculations

### 7.1 Ticker market-value concentration

For a ticker with known current market value and known current Account Equity:

```text
tickerMarketValueConcentrationPercent
  = tickerMarketValueVnd / accountEquityVnd * 100
```

Account Equity is the canonical QEO-141/QEO-158 post-external-flow denominator. Do not substitute initial capital, invested capital, gross market value or cash balance.

If Account Equity is unavailable/non-positive for a calculation requiring a percentage, the percentage status is `UNKNOWN`.

### 7.2 Ticker Active Risk contribution

QEO-159 must aggregate QEO-141 `activeRiskVnd` by ticker. It must not recompute stop risk independently.

Two useful values may be exposed:

```text
tickerActiveRiskVnd = sum(known activeRiskVnd for ticker)

tickerActiveRiskPercentOfEquity
  = tickerActiveRiskVnd / accountEquityVnd * 100
```

Any ticker containing an open-trade risk row with `riskStatus = unknown` has incomplete ticker risk coverage. A known lower bound may still prove a breach where a configured threshold exists; otherwise incomplete risk cannot be reported as safely within plan.

### 7.3 Sector Active Risk concentration

Sector concentration uses structured sector metadata and QEO-141 Active Risk:

```text
sectorActiveRiskVnd
  = sum(known activeRiskVnd for classified open trades in sector)

sectorActiveRiskPercent
  = sectorActiveRiskVnd / accountEquityVnd * 100
```

`maxSectorRiskPercent` compares against this value, not sector market-value weight. This preserves the field's existing meaning as “Max Sector Risk”.

If any relevant open-risk row has no structured sector classification, sector completeness is partial. The system must explicitly expose unknown classification rather than assigning a fallback sector.

### 7.4 Concurrent open positions

Count distinct tickers with positive canonical open position quantity. The check compares to `maxConcurrentOpenPositions` when configured.

Multiple open trade cards for the same ticker count as one open ticker/position for this rule. The read model may separately expose trade-card count if useful, but the configured rule is ticker-position count unless a future plan field explicitly defines otherwise.

## 8. Status semantics

Status evaluation must distinguish warning from breach and must fail closed on missing evidence.

### No configured rule

If a metric has no relevant configured threshold:

- it may still be calculated and displayed;
- it must not be labeled `BREACH` or `WITHIN_PLAN` against an invented rule;
- the normalized check should use `UNKNOWN` with a reason such as `rule_not_configured`, or an equivalent typed state that serializes to the required four-state output.

### Ticker market-value check

If a hard max is configured:

- metric > `maxTickerConcentrationPercent` → `BREACH`;
- otherwise if advisory warning is configured and metric >= `concentrationWarningPercent` → `WARNING`;
- otherwise → `WITHIN_PLAN`, subject to completeness.

If only warning is configured:

- metric >= warning → `WARNING`;
- metric below warning → `WITHIN_PLAN` for the warning rule;
- there is no hard breach threshold.

### Sector/open-position checks

Configured hard threshold exceeded → `BREACH`; otherwise `WITHIN_PLAN`, subject to completeness.

### Incomplete evidence

Fail-closed rule:

- if known evidence alone already exceeds a hard threshold, status may be `BREACH` even when completeness is partial because missing evidence can only preserve or worsen that conclusion;
- if incomplete evidence does not already prove a breach, do not return `WITHIN_PLAN` for a hard rule whose true metric could be higher; return `UNKNOWN`;
- missing structured sector metadata must therefore never produce false sector safety.

## 9. Read model

Expose a concentration/diversification read model suitable for `/portfolio`:

```ts
type PortfolioConcentrationReadModel = {
  summary: {
    overallStatus: ConcentrationStatus
    openPositionCount: number
    accountEquityVnd: number | null
  }
  tickerMarketValue: ConcentrationCheck[]
  tickerActiveRisk: ConcentrationCheck[]
  sectorActiveRisk: ConcentrationCheck[]
  openPositions: ConcentrationCheck
  unknownClassificationTickers: string[]
  evidence: {
    holdingsCompleteness: "complete" | "partial" | "insufficient"
    activeRiskCoverage: "complete" | "partial"
    sectorMetadataCoverage: "complete" | "partial" | "insufficient"
    sectorSourceAsOfDate: string | null
    moneyManagementPlanVersion: number | null
  }
}
```

Overall status ordering:

```text
BREACH > WARNING > UNKNOWN > WITHIN_PLAN
```

with one caveat: `UNKNOWN` should not hide a known `BREACH` or known `WARNING`. The UI must still surface unknown evidence separately.

## 10. Planned-trade projection

QEO-159 extends the pre-trade decision context after QEO-139 has calculated planned quantity/risk. It does not alter QEO-139's sizing result.

Projection inputs include:

- current concentration read model/evidence;
- planned ticker;
- planned quantity;
- planned entry price;
- planned risk VND from QEO-139;
- structured sector metadata for planned ticker;
- current Account Equity;
- current open-position presence for the ticker;
- current plan thresholds.

### Projected market value

```text
plannedMarketValueVnd = plannedQty * plannedEntryKvnd * 1,000
```

For a new ticker:

```text
projectedTickerMarketValueVnd
  = currentTickerMarketValueVnd + plannedMarketValueVnd
```

For an existing ticker, the same additive formula applies.

Projected concentration uses current Account Equity as the deterministic pre-trade decision denominator. The projection must clearly label this basis; it does not speculate about future mark-to-market or cash-flow changes.

### Projected Active Risk

Reuse QEO-139 planned risk amount and QEO-141 current known Active Risk:

```text
projectedTickerKnownActiveRiskVnd
  = currentTickerKnownActiveRiskVnd + plannedTradeRiskVnd
```

For sector risk, add the planned trade risk to the structured sector if classification is known. If classification is missing, projected sector check is `UNKNOWN` unless known current sector evidence already proves an unrelated breach that remains relevant.

### Projected open-position count

- planned ticker already has positive open position → count unchanged;
- planned ticker is new and planned quantity > 0 → count + 1.

### Projection behavior

Return the same typed statuses and evidence as current checks, marked as projected. The UI should highlight conflicts before confirmation, but the calculator quantity/risk remains unchanged.

## 11. Override audit behavior

Concentration/diversification warnings and breaches are advisory.

When a user proceeds with a planned trade despite a configured `WARNING` or `BREACH`, the flow should require or strongly capture an override reason through the existing QEO-137 journal/audit path using `override_reason` rather than creating a parallel audit table.

The persisted reason should be associated with the trade/journal action that records the decision. Exact UI placement may reuse the existing trade posting/journal mechanism.

Historical/executed fill recording is never rejected because of a concentration status. If the system detects a breach after the fact, it records/displays the breach as evidence rather than blocking accounting history.

## 12. API/server integration

Prefer adding concentration data to an existing portfolio/risk read path only if it keeps boundaries clear. Otherwise add a narrow owner-scoped endpoint such as:

`GET /api/portfolio/[id]/concentration`

Pre-trade projection should be pure/client-available where all inputs are already present, or exposed through the existing risk-sizing server path if server-only structured metadata is required. Avoid a second independent holdings/risk fetch in the browser when current state is already loaded.

All server reads remain owner-scoped and preserve live/paper portfolio separation inherited from the selected portfolio.

## 13. UI integration

### Tài sản

Add a compact concentration/diversification section in the existing `/portfolio` visual language showing:

- overall plan status;
- top ticker by market-value concentration;
- top ticker by Active Risk contribution;
- top sector by Active Risk when known;
- open-position count versus configured max when configured;
- explicit unknown-classification count/tickers;
- concise calculation/provenance details in tooltips or expandable evidence.

Do not present a green “safe” state when required evidence is incomplete.

### Phân bổ vốn / sizing

Alongside the existing projected Active Risk context, show projected concentration checks for the planned trade. The section must make clear that the sizing formula itself has not been reduced or changed by the diversification warning.

Suggested Vietnamese labels should preserve existing product language, e.g. `Tập trung danh mục`, `Rủi ro ngành`, `Giới hạn theo kế hoạch`, `Chưa đủ dữ liệu phân ngành`.

## 14. Validation

New optional plan fields require deterministic validation:

- percentages: finite, > 0, <= 100;
- concurrent positions: finite integer >= 1;
- when diversification is disabled, omitted fields remain acceptable for backward compatibility;
- no implicit defaults are persisted.

The form should not populate hidden default values for old plans.

## 15. Testing strategy

### Pure domain tests

Cover at minimum:

1. concentrated ticker market-value warning/breach;
2. ticker within plan;
3. sector Active Risk breach;
4. sector metadata missing → `UNKNOWN`;
5. no configured rule → no invented breach/default;
6. incomplete Active Risk where known lower bound proves breach;
7. incomplete Active Risk where safety cannot be proven → `UNKNOWN`;
8. multiple trade cards same ticker aggregate Active Risk but count one open position;
9. planned new trade causes ticker breach;
10. planned scale-in does not increment open-position count;
11. planned unknown-sector trade returns projected sector `UNKNOWN`;
12. Account Equity missing/non-positive → percentage checks `UNKNOWN`.

### Integration tests

- server composition uses QEO-141 Active Risk values unchanged;
- latest Money Management Plan version is authoritative;
- structured sector metadata is used without `sectorForTicker()` fallback;
- live/paper portfolio selection remains isolated;
- endpoint/read model is owner-scoped;
- QEO-139 projected risk and QEO-159 projected ticker/sector risk reconcile.

### UI/browser contracts

Cover:

- current concentration summary rendering;
- warning/breach/unknown labels;
- no-plan/no-threshold state;
- projected new-trade breach;
- override reason path available for advisory conflict;
- historical/executed fill path remains recordable.

### Regression gates

At minimum rerun canonical QEO-138, QEO-139, QEO-141, QEO-142, QEO-158 and Verify/DB Drift workflows applicable to the exact PR head.

## 16. Migration and production acceptance

Expected database migration: none.

Reason: QEO-159 extends already-versioned JSONB plan semantics and consumes existing portfolio/risk/market metadata. If implementation discovers a need for durable state beyond the existing journal `override_reason`, that is an architecture change and must be reviewed before adding DDL.

Production acceptance for QEO-144 must include evidence that:

- configured diversification thresholds round-trip in the latest plan;
- current concentration output reconciles with production holdings, Account Equity and QEO-141 risk;
- at least one structured-sector example is correctly classified;
- an unavailable sector remains `UNKNOWN` rather than guessed;
- projected trade calculation is deterministic on known inputs;
- no universal threshold appears when the plan omits one.

## 17. Acceptance mapping

QEO-159 acceptance criteria map as follows:

1. Deterministic ticker concentration → Sections 7.1, 8, 15.
2. Active Risk reconciliation with QEO-141 → Sections 7.2, 7.3, 15.
3. Correct/unknown sector metadata behavior → Sections 2, 7.3, 8, 15.
4. Explainable configured statuses → Sections 5, 6, 8.
5. Planned trade projection without sizing-formula change → Section 10.
6. No silent default threshold → Sections 3, 5, 8, 14.
7. Auditable override; executed fills not blocked → Section 11.
8. Required browser/unit scenarios → Section 15.
9. QEO-144 production evidence → Section 16.

## 18. Design invariants

The implementation is not complete unless all of these remain true:

- QEO-141 is the sole canonical source of Active Risk amounts.
- QEO-158/QEO-141 Account Equity is the concentration percentage denominator.
- Missing sector data remains unknown; no heuristic/default sector is used as evidence.
- User-authored plan thresholds are authoritative; no product default masquerades as a rule.
- Partial evidence can prove a breach but cannot falsely prove safety.
- QEO-139 sizing math is unchanged by concentration checks.
- Advisory overrides are auditable.
- Historical/executed accounting events remain recordable.
- Live and paper portfolios remain isolated.
- All outputs are deterministic and explainable; no AI/LLM path participates.
