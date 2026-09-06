# QEO-121 Corporate Actions + Adjusted Chart Design

Date: 2026-09-06
Status: Approved in chat for architecture; awaiting written-spec review before implementation
Parent: QEO-121
Related: QEO-106, QEO-122, QEO-123, QEO-124, QEO-125, QEO-126, QEO-127, QEO-128, QEO-90, QEO-93, QEO-98

## 1. Problem

QeoIndex currently has a canonical Daily history contract, but production evidence shows that structurally valid OHLCV rows can still use different corporate-action price bases across providers. The pinned regression is VHM week 13-17/10/2025: QeoIndex currently derives approximately H 65.5-65.75 / L 60.2 while independent adjusted-price benchmarks show approximately H 63.31 / L 55.18.

This must not be patched at the weekly layer. `1W/1M/1Q/1Y` must continue to derive deterministically from one canonical `1D` series. Therefore price-basis normalization belongs upstream of chart aggregation, indicators, Wyckoff and AI Council consumers.

A second production defect also proved that an in-memory repair candidate is not evidence of persistence: database precedence can silently preserve an older row. Any future adjustment/rebuild flow therefore needs exact persisted readback, not only successful upsert responses.

## 2. Goals

1. Establish a canonical corporate-action event model with auditable source provenance.
2. Prefer a free authoritative source before introducing paid FiinGroup dependency.
3. Compute QeoIndex-owned, deterministic and versioned adjustment factors.
4. Keep one chart-facing adjusted Daily basis across providers.
5. Integrate corporate-action discovery and activation into EOD v4.
6. Discover future events early and display them immediately without changing historical price basis before ex-date.
7. Rebuild only affected ticker history when an action becomes effective or an event is amended.
8. Render corporate-action markers on the Stock Detail chart.
9. Add a Stock Detail `Sự kiện doanh nghiệp` tab with upcoming and historical rights.
10. Preserve session-date correctness, exact persisted readback and higher-timeframe determinism.

## 3. Non-goals

- Do not buy or implement a FiinGroup dependency before QEO-122 returns NO-GO for acceptable free sources.
- Do not scrape or parse source pages in browser/UI code.
- Do not let the chart calculate corporate-action factors.
- Do not change the existing seven operator-level EOD v4 business phases.
- Do not recompute eight years x 200 tickers every EOD when nothing changed.
- Do not silently infer ambiguous ex-dates or rights terms.
- Do not apply a future announced action to historical prices before its canonical ex-date.
- Do not create separate adjustment logic for weekly/monthly/quarterly/yearly candles.

## 4. Source authority

### 4.1 Free-source gate

QEO-122 owns source validation. Current first candidate is VSDC/VSD public corporate-action data because it is free and authoritative enough to expose event terms such as record date, cash amount, stock ratio and rights issue terms.

The source is not considered production-ready until QEO-122 proves:

- retained-history coverage for the required ~8Y scope;
- deterministic ex-date strategy across historical settlement regimes;
- amendment/duplicate notice handling;
- stable parsing/access characteristics;
- representative HOSE/HNX/UPCOM coverage;
- cash dividend, stock dividend/bonus/split and rights issue coverage.

If the free-source spike is NO-GO, FiinGroup may be reconsidered as a paid fallback in a separate decision.

### 4.2 Authority boundaries

Corporate-action source data is event evidence, not chart OHLC authority.

```text
VSDC/VSD (or approved source)
        -> raw event evidence
        -> normalized corporate_actions

VCI/DNSE/other approved market providers
        -> raw Daily OHLCV evidence

QeoIndex adjustment engine
        -> market_price_adjustment_factors
        -> canonical adjusted Daily
```

FireAnt/Finhay/Yahoo may be used as independent regression/cross-check sources but must not become hidden factor authority.

## 5. Canonical data model

### 5.1 `corporate_actions`

Logical fields:

- `id`
- `ticker`
- `isin` nullable
- `exchange`
- `action_type`
- `announcement_date` nullable
- `ex_date` nullable until canonicalized
- `record_date`
- `payment_date` / `effective_date` where relevant
- `cash_per_share` nullable
- `stock_ratio_numerator` / `stock_ratio_denominator` nullable
- `rights_ratio_numerator` / `rights_ratio_denominator` nullable
- `rights_subscription_price` nullable
- `status`: `announced | effective | completed | ambiguous | canceled`
- `source`
- `source_event_id`
- `source_url`
- `source_published_at` nullable
- `source_updated_at` nullable
- `raw_evidence_hash`
- `normalization_version`
- `ex_date_derivation_method` nullable
- `trading_calendar_version` nullable
- `verified_at`
- timestamps

Requirements:

- Idempotent event identity.
- Amendments update the same logical event lineage or explicitly supersede prior evidence.
- Raw source evidence is retained separately from normalized fields.
- Derived ex-date is explicitly tagged; it is never indistinguishable from source-provided ex-date.
- Ambiguous terms remain ambiguous and block factor activation.

### 5.2 `market_price_adjustment_factors`

QeoIndex-owned derived data:

- `ticker`
- `session_date`
- `price_factor`
- `volume_factor`
- `step_factor`
- `factor_version`
- `engine_version`
- `event_lineage_hash`
- `corporate_action_ids`
- `computed_at`
- `effective_from`
- `status`

The table is recomputable. Corporate-action events are the source facts; factors are derived state.

### 5.3 Raw versus adjusted Daily

Long-term contract:

```text
raw/provider Daily evidence
        -> adjustment engine
        -> chart-facing canonical adjusted 1D
```

Raw/provider evidence must remain available for audit/recomputation. The exact physical table split may be staged to control storage cost, but chart consumers must never receive a mixed-basis series.

## 6. Adjustment engine semantics

### 6.1 Core rule

For each effective corporate action, calculate a deterministic step factor and cumulative backward factor. Adjust OHLC using the cumulative price factor. Volume factor is separate and action-specific.

### 6.2 Cash dividend

Cash dividend changes historical price basis but must not mechanically scale historical volume.

Conceptually:

```text
step_price_factor = theoretical_ex_price / previous_raw_close
volume_factor = 1
```

### 6.3 Stock dividend / bonus / split

Price and volume normalization are reciprocal where appropriate. Exact formulas must be encoded as deterministic fixtures and verified against authoritative event terms.

### 6.4 Rights issue

Requires explicit subscription ratio, issue price and prior canonical raw reference price. If terms are incomplete or multiple simultaneous actions cannot be resolved deterministically, factor activation fails closed.

### 6.5 Multiple actions on one ex-date

All same-date actions form one deterministic event set. The engine computes a single versioned lineage from the complete set, not order-dependent incremental mutations.

### 6.6 Future events

This is a hard invariant:

- announced future events are stored and exposed to UI immediately;
- factors may be precomputed as `pending` for observability if terms are complete;
- chart-facing historical adjusted prices do **not** change before canonical `ex_date`;
- first EOD on/after ex-date activates the factor lineage and rebuilds affected adjusted history.

This prevents premature historical price jumps merely because a company announced a future right.

## 7. EOD v4 integration

Do not create an eighth business phase. Keep the seven stable operator phases and add nested durable steps inside `HISTORY_REFRESH`.

```text
EOD v4
  -> freeze canonical universe
  -> HISTORY_REFRESH
       -> CORPORATE_ACTION_SYNC
       -> ADJUSTMENT_IMPACT_DETECTION
       -> CANONICAL_DAILY_REFRESH
       -> REBUILD_AFFECTED_ADJUSTED_DAILY
       -> INVALIDATE_DERIVED_HISTORY
  -> downstream deterministic consumers
  -> Market Synthesis
  -> LLM Council
```

### 7.1 `CORPORATE_ACTION_SYNC`

For the frozen canonical universe:

- fetch new/amended/future events using bounded concurrency;
- normalize and upsert event evidence;
- calculate event-lineage hashes;
- report counts: discovered, new, amended, canceled, ambiguous, upcoming.

### 7.2 `ADJUSTMENT_IMPACT_DETECTION`

Compare previous and current event lineage per ticker.

Outputs:

- unchanged ticker -> no-op;
- announced future event -> UI-visible, no active historical rebuild;
- action becoming effective -> activate factor lineage;
- amended historical/effective event -> recompute from earliest affected boundary;
- ambiguous event -> explicit blocker for that ticker, no mixed-basis rewrite.

### 7.3 Incremental rebuild scope

No global full-history recompute by default.

Each changed ticker gets:

- `affected_from_date`;
- previous lineage hash;
- new lineage hash;
- recompute/rebuild reason.

Rebuild only the required historical adjusted Daily range for impacted tickers. Unchanged tickers remain no-op.

### 7.4 Readback and fail-closed semantics

After persistence/rebuild:

- read back exact affected sessions;
- verify adjusted provenance/factor lineage;
- verify no duplicate session identities;
- only then count sessions/tickers as repaired or rebuilt.

An accepted HTTP/upsert response alone is insufficient evidence.

### 7.5 Downstream ordering

Wyckoff, indicators and AI Council must consume the rebuilt canonical adjusted Daily after `HISTORY_REFRESH`. They must not read stale pre-adjustment price history from a parallel branch.

## 8. Derived timeframe and cache invalidation

QEO-93 remains authoritative:

- `1D` = canonical adjusted Daily;
- `3D/1W/1M/1Q/1Y` derive only from canonical adjusted Daily;
- no provider-specific weekly/monthly history;
- no second adjustment pass after aggregation.

For a changed ticker:

1. rebuild adjusted Daily;
2. invalidate affected derived timeframe/cache ranges;
3. regenerate lazily or eagerly according to existing cache ownership;
4. recompute indicator caches from sufficient warm-up history.

The same VHM Daily correction must therefore fix its weekly/monthly candles without special weekly code.

## 9. Chart event markers

QEO-127 owns rendering.

### 9.1 Anchor

Canonical marker anchor = `ex_date`.

This date represents the market session where the right affects price reference. Record date/payment date remain detail metadata, not the chart anchor.

### 9.2 Marker types

Minimum visual categories:

- cash dividend;
- stock dividend / bonus / split;
- rights issue;
- grouped multi-action event.

### 9.3 Future events

Future canonical ex-date markers may render in chart future whitespace where supported by the existing TradingView-style timeline. Their presence does not imply active adjusted pricing before ex-date.

### 9.4 Interaction

Hover/click exposes compact summary. Detailed provenance belongs to the Stock Detail event tab/drawer, not the candle plot.

Multiple events on one ex-date are grouped deterministically.

Ambiguous/missing ex-date must not create a fabricated chart marker.

## 10. Stock Detail `Sự kiện doanh nghiệp` tab

QEO-128 owns this surface.

### 10.1 Sections

1. Upcoming / announced.
2. Historical events newest-first.
3. Event detail and source provenance.

### 10.2 Status language

Expose investor-facing status clearly:

- Upcoming
- Effective
- Completed
- Pending verification / Ambiguous
- Canceled where applicable

### 10.3 Fields

Display when known:

- event type;
- ex-date;
- record date;
- payment/effective date;
- cash per share;
- stock/bonus/split ratio;
- rights ratio and subscription price;
- source/provenance;
- verification status.

Never invent missing dates or terms.

### 10.4 Chart navigation

A canonical event with ex-date can focus the chart around that date. An ambiguous event without canonical ex-date cannot navigate to a fabricated location.

## 11. API/read-model boundary

UI code consumes a normalized server read model, for example:

```ts
type CorporateActionView = {
  id: string
  ticker: string
  actionType: "cash_dividend" | "stock_dividend" | "split" | "rights_issue" | "other"
  status: "upcoming" | "effective" | "completed" | "ambiguous" | "canceled"
  exDate: string | null
  recordDate: string | null
  paymentDate: string | null
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
  sourceLabel: string
  sourceUrl: string | null
  verificationStatus: string
}
```

The API is provider-agnostic. No VSDC HTML/source payload leaks into browser contracts.

## 12. Error handling

### Source unavailable

- EOD corporate-action sync records degraded/failure telemetry.
- Existing canonical event/factor lineage remains last-known-good.
- No factor rewrite is performed from missing evidence.

### Ambiguous event

- Persist event as ambiguous with provenance.
- Show it in Stock Detail as pending verification if appropriate.
- Do not activate adjustment factor.
- Do not create chart marker without canonical ex-date.

### Amendment

- Preserve old evidence lineage.
- Persist new normalized version.
- Recompute only impacted ticker factor/history boundary.
- Readback verify before downstream consumers proceed.

### Persistence mismatch

- If DB readback does not match expected factor lineage/session rows, mark ticker unresolved and fail closed for that rebuild.

## 13. Performance and cost

- Corporate-action sync uses bounded concurrency.
- Event pages are cached/conditional where source semantics permit.
- No all-history/all-ticker rewrite on each EOD.
- Lineage hashes make unchanged tickers O(1)-ish/no-op after event sync.
- Rebuild work is proportional to changed ticker count and affected historical boundary.
- UI event endpoint is ticker/range bounded and should be cacheable separately from OHLCV.
- Chart markers must not trigger one request per candle/event.

## 14. Security and provenance

- Source ingestion is server-only.
- Corporate-action raw evidence and mutation paths are service-role-only.
- Authenticated users receive normalized read-only event data only.
- Source URLs are exposed only when approved/safe for browser navigation.
- Every active factor lineage references exact normalized event identities and engine version.

## 15. Testing strategy

### 15.1 Source fixtures

QEO-122/QEO-123:

- VHM cash dividend;
- VHM stock dividend;
- historical VHM combined event;
- HNX cash event;
- UPCOM cash event;
- rights issue with ratio + subscription price;
- amended/duplicate source notice.

### 15.2 Adjustment fixtures

QEO-124:

- cash dividend;
- stock dividend/split;
- rights issue;
- multiple actions same ex-date;
- future event does not activate early;
- amended effective event changes lineage deterministically.

### 15.3 Persistence regression

A repair/rebuild counts only sessions verified through exact DB readback.

### 15.4 Golden VHM acceptance

For VHM week 13-17/10/2025, after canonical adjusted Daily rebuild:

- weekly high should match the independent adjusted benchmark around 63.31 within documented tolerance;
- weekly low should match around 55.18 within documented tolerance;
- no duplicate/shifted Daily sessions;
- no special-case weekly adjustment code.

### 15.5 EOD acceptance

- announced future event appears after EOD sync;
- no historical price mutation before ex-date;
- first EOD on/after ex-date activates factor/rebuild;
- unchanged rerun is idempotent/no-op;
- amended event rebuilds only affected ticker history;
- downstream consumer sees new canonical lineage.

### 15.6 UI acceptance

- chart marker remains anchored through zoom/pan/timeframe/fullscreen;
- same-date actions group correctly;
- future marker can appear in future whitespace;
- ambiguous event never gets fake marker;
- Stock Detail tab shows upcoming/historical events and provenance;
- event-to-chart navigation lands on canonical ex-date.

## 16. Rollout order

1. QEO-122 free-source GO/NO-GO.
2. QEO-123 canonical event schema + ingestion/provenance.
3. QEO-124 adjustment engine + deterministic factor fixtures.
4. QEO-126 EOD v4 sync/activation/incremental rebuild.
5. VHM-only production golden acceptance.
6. HCM/VCB/VIC regression set.
7. Multi-exchange sample.
8. QEO-125 staged canonical-200 migration.
9. QEO-127 chart markers and QEO-128 Stock Detail tab once normalized read model is stable; these may overlap with later data rollout after the contract is frozen.
10. QEO-98 final production visual/data acceptance.

## 17. Linear ownership

- QEO-121: parent architecture / release objective.
- QEO-122: free corporate-action source spike.
- QEO-123: normalized canonical event storage + source provenance.
- QEO-124: adjustment factor engine.
- QEO-125: canonical adjusted Daily migration / canonical-200 rollout.
- QEO-126: EOD v4 corporate-action sync + factor activation/rebuild.
- QEO-127: chart event markers.
- QEO-128: Stock Detail `Sự kiện doanh nghiệp` tab.
- QEO-98: final visual/data production acceptance.

## 18. Decision summary

Approved design decisions:

- Prefer free authoritative corporate-action source first; FiinGroup remains fallback only after spike NO-GO.
- QeoIndex owns adjustment-factor computation.
- Chart-facing Daily uses one adjusted basis.
- Future events are synced/displayed immediately but do not alter historical pricing before ex-date.
- Corporate-action maintenance is nested inside EOD v4 `HISTORY_REFRESH`, preserving seven business phases.
- Only changed tickers/ranges rebuild.
- Chart events anchor to canonical ex-date.
- Stock Detail gets a dedicated corporate-action tab.
- Higher timeframes remain deterministic derivations from adjusted Daily.
- Persistence/readback evidence is mandatory before a rebuild is considered successful.
