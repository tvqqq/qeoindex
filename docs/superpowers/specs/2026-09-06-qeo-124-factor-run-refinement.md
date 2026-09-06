# QEO-124 Factor Run Architecture Refinement

Date: 2026-09-06
Status: Approved in chat
Parent design: `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Purpose

Refine the QEO-121 adjustment-factor storage and formula contract after QEO-123 landed in production. This addendum does not change source authority: QEO-123 canonical corporate actions remain source facts, QeoIndex computes derived factors, and chart consumers do not cut over until QEO-125.

## 1. Versioned factor runs

A factor computation is a versioned ticker-level run, not a mutable pile of independent action rows.

`market_adjustment_factor_runs` owns:

- `id`
- `ticker`
- `factor_version`
- `engine_version`
- `event_lineage_hash`
- `as_of_date`
- `status`: `candidate | active | superseded | blocked`
- `blocked_reason` nullable
- `computed_at`
- timestamps

Invariant: at most one `active` run per ticker. Promotion is atomic and belongs to the later activation/cutover flow; QEO-124 may persist candidates without changing chart consumers.

## 2. Combined same-date transitions

`market_price_adjustment_factors` stores one deterministic transition per `(run_id, effective_session)`, not one row per corporate action.

Each transition stores:

- `run_id`
- `ticker`
- `effective_session`
- `reference_session`
- `reference_raw_close`
- `step_price_factor`
- `step_volume_factor`
- `cumulative_price_factor`
- `cumulative_volume_factor`
- sorted `corporate_action_ids`
- `event_lineage_hash`
- `formula_inputs` JSONB for audit
- `computed_at`

All effective actions sharing one canonical `ex_date` form one event set and therefore one transition. Shuffling component order must not change factors or lineage.

## 3. Ratio semantics

QEO-123 VSDC parsing currently normalizes ratios as follows:

- stock dividend / bonus percent `30%` -> `100:30`;
- explicit stock dividend / bonus ratio -> source `existing:additional` entitlement;
- rights ratio -> source `existing:new-rights` entitlement;
- split/consolidation ratio -> source `old:new-total` share conversion.

The factor engine must therefore interpret ratios by `action_type`; it must never apply one generic numerator/denominator formula to every stock-like action.

For stock dividend / bonus:

```text
free_share_ratio = denominator / numerator
share_count_multiplier = 1 + free_share_ratio
```

For rights:

```text
rights_ratio = denominator / numerator
```

For split/consolidation:

```text
share_count_multiplier = denominator / numerator
```

Malformed, zero, non-finite, contradictory, or unsupported ratio semantics fail closed.

## 4. Price transition semantics

For one same-date event set, all terms are solved against the same `previousRawClose`.

Define:

- `P` = previous canonical raw close;
- `D` = total cash dividend per pre-event share;
- `F` = total free-share entitlement from stock dividend/bonus;
- `R` = total rights entitlement;
- `K_i` = subscription price for each rights component;
- `M` = split/consolidation old-to-new total-share multiplier, default `1`.

Then:

```text
rights_subscription_value = sum(R_i * K_i)
post_event_share_units = M + F + R

theoretical_ex_price = (P - D + rights_subscription_value) / post_event_share_units
step_price_factor = theoretical_ex_price / P
```

Constraints:

- `P > 0`;
- `P - D + rights_subscription_value > 0`;
- `post_event_share_units > 0`;
- at most one split/consolidation component is accepted in one event set unless a later source contract explicitly defines composition semantics;
- all same-date components use the original `P`, never a sequentially adjusted intermediate price.

Cash-only therefore reduces to `(P-D)/P`. A 1:1 stock dividend produces `0.5`. A pure 1:2 split produces `0.5`.

## 5. Volume transition semantics

Volume normalization is deliberately separate from price normalization.

- cash dividend: `step_volume_factor = 1`;
- stock dividend / bonus / split-consolidation: multiply historical volume by the deterministic free/split share-count multiplier;
- rights issue: does not mechanically scale historical trading volume at ex-date in QEO-124; rights affect TERP price, while actual issued-share timing/exercise is a distinct fact not represented by the QEO-123 ex-date event alone.

For a combined event set:

```text
step_volume_factor = M * (1 + F)
```

Rights entitlement is excluded from the volume multiplier. A later canonical issuance/effective-share event may revise this rule in a separate versioned engine change.

## 6. Lineage and idempotency

Run lineage hash is generated from stable canonical JSON containing:

- ticker;
- engine version;
- as-of date policy/version;
- sorted effective event sets;
- for every action: canonical database id, action type, ex-date, normalized terms, normalization version, source lineage identity and evidence hash;
- reference raw session/date/close inputs used by each transition.

Same inputs must produce the same lineage hash and factor version. Any amended event term, source evidence lineage, reference raw close, or engine version must produce a new candidate run.

## 7. Activation and future events

- Events with canonical `ex_date > as_of_date` may contribute to observability/pending diagnostics but must not change active historical cumulative factors.
- Missing canonical ex-date, ambiguous terms, unsupported composition, or missing reference raw session blocks the candidate run for that ticker.
- QEO-124 persists and validates factor candidates; QEO-126 owns scheduled activation at/after ex-date and QEO-125 owns consumer cutover.

## 8. Migration ordering

QEO-123 already owns repository migrations `20260906163000` and `20260906164000`. QEO-124 therefore uses repository migration version `20260906165000` for factor storage. QEO-125 remains planned at `20260906165500`.

## 9. Required deterministic fixtures

At minimum:

- identity/no-action;
- cash dividend;
- stock dividend 1:1 and percent-derived `100:30`;
- bonus issue;
- split 1:2;
- consolidation 2:1;
- rights issue with explicit subscription price;
- same-date cash + stock + rights, invariant under shuffled order;
- duplicate split component fails closed;
- future event does not activate early;
- amendment changes lineage;
- exact persisted readback;
- VHM golden weekly regression around H 63.31 / L 55.18 within documented tolerance.
