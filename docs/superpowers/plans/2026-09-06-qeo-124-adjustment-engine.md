# QEO-124 Adjustment Factor Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute deterministic, versioned, auditable Daily price/volume adjustment factors from QEO-123 canonical corporate actions and raw Daily evidence without changing chart consumers.

**Architecture:** Keep factor math pure/provider-agnostic, but persist results as a versioned ticker-level factor run plus one combined transition per effective session. Same-date corporate actions are solved as one event set against the same prior raw close; ratio semantics are action-type-specific. QEO-124 persists and readback-verifies candidate runs only; QEO-126 owns scheduled activation and QEO-125 owns consumer cutover.

**Tech Stack:** TypeScript 5.7, Node test runner, PostgreSQL/Supabase, existing corporate-action and raw Daily contracts.

**Spec:**
- `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`
- `docs/superpowers/specs/2026-09-06-qeo-124-factor-run-refinement.md`

## Global Constraints

- Depends on production-accepted QEO-123 canonical corporate actions.
- QeoIndex owns factor computation; Yahoo/FireAnt/Finhay may be regression evidence but never hidden factor authority.
- Repository migration version is `20260906165000`; QEO-123 already owns `20260906163000` and `20260906164000`.
- Future events do not alter active historical factors before canonical `ex_date`.
- Missing canonical ex-date, missing prior raw reference close, malformed terms, unsupported composition or ambiguous lineage fail closed.
- Same-date actions form one complete event set and one transition; component order must not affect factors or lineage.
- QEO-123 ratio representation is interpreted by action type: stock dividend/bonus and rights are `existing:entitlement`; split/consolidation is `old:new-total`.
- Cash dividend does not mechanically scale volume. Rights affect TERP price but do not scale historical volume at ex-date in engine v1.
- Raw/provider Daily evidence remains unchanged. No chart/Wyckoff/AI Council consumer reads QEO-124 factors directly.
- Persistence is not accepted until exact DB readback matches expected run lineage and transition values.

---

### Task 1: Add versioned factor-run persistence schema

**Files:**
- Create: `supabase/migrations/20260906165000_qeo124_adjustment_factor_runs.sql`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Modify: `modules/shared/supabase/database.types.ts`
- Modify: `tests/db-schema-contract.test.ts`
- Modify: `tests/market-data-contract.test.ts`

**Interfaces:**

Produces:

```text
market_adjustment_factor_runs
  id uuid PK
  ticker text
  factor_version text
  engine_version text
  event_lineage_hash text
  as_of_date date
  status candidate|active|superseded|blocked
  blocked_reason text nullable
  computed_at timestamptz
  created_at timestamptz
  updated_at timestamptz

market_price_adjustment_factors
  run_id uuid FK
  ticker text
  effective_session date
  reference_session date
  reference_raw_close numeric
  step_price_factor numeric
  step_volume_factor numeric
  cumulative_price_factor numeric
  cumulative_volume_factor numeric
  corporate_action_ids uuid[]
  event_lineage_hash text
  formula_inputs jsonb
  computed_at timestamptz
```

Required invariants:

- unique `(ticker, factor_version)` run identity;
- at most one `active` run per ticker via partial unique index;
- unique `(run_id, effective_session)` transition;
- all factor/close values strictly positive;
- `corporate_action_ids` non-null and deterministically sorted by application code;
- mutations revoked from `anon` and `authenticated`; service-role only;
- authenticated users do not need direct factor-table access in QEO-124.

- [ ] **Step 1: Write RED schema contracts** in `tests/db-schema-contract.test.ts` and `tests/market-data-contract.test.ts` requiring both tables, columns, FK, checks, partial active-run uniqueness, RLS and privilege posture.
- [ ] **Step 2: Push tests-only commit and verify RED** with PR CI; expected failure is missing `market_adjustment_factor_runs` / `market_price_adjustment_factors` schema.
- [ ] **Step 3: Add migration `20260906165000_qeo124_adjustment_factor_runs.sql`** with both tables, constraints, indexes, RLS and service-role grants.
- [ ] **Step 4: Register migration equivalence/ledger as source-only pending production promotion** without inventing a production version.
- [ ] **Step 5: Regenerate `modules/shared/supabase/database.types.ts` from zero-to-latest local replay.**
- [ ] **Step 6: Verify GREEN** with `pnpm db:replay:verify`, `pnpm db:types:verify`, `pnpm test:db-drift`, the two targeted schema tests, and `pnpm typecheck`.
- [ ] **Step 7: Commit** `feat(QEO-124): add versioned adjustment factor storage`.

### Task 2: Implement action-type-specific pure formulas

**Files:**
- Create: `modules/market/corporate-actions/adjustment/types.ts`
- Create: `modules/market/corporate-actions/adjustment/formulas.ts`
- Create: `tests/qeo-124-adjustment-engine.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export type CanonicalFactorAction = {
  id: string
  ticker: string
  actionType: "cash_dividend" | "stock_dividend" | "bonus_issue" | "stock_split" | "rights_issue"
  exDate: string
  cashPerShare: number | null
  stockRatioNumerator: number | null
  stockRatioDenominator: number | null
  rightsRatioNumerator: number | null
  rightsRatioDenominator: number | null
  subscriptionPrice: number | null
  normalizationVersion: string
  rawEvidenceHash: string
  source: string
  lineageRootSourceEventId: string
  sourceComponentKey: string
}

export type AdjustmentEventSet = {
  ticker: string
  exDate: string
  previousRawClose: number
  events: CanonicalFactorAction[]
}

export type StepAdjustment = {
  theoreticalExPrice: number
  stepPriceFactor: number
  stepVolumeFactor: number
  corporateActionIds: string[]
  formulaInputs: Record<string, unknown>
}

export function computeStepAdjustment(input: AdjustmentEventSet): StepAdjustment
```

Formula contract for engine v1:

```text
P = previousRawClose
D = sum(cash_per_share)
F = sum(stock/bonus denominator / numerator)
R_i = rights denominator / numerator
M = split denominator / numerator, default 1

rights_subscription_value = sum(R_i * subscription_price_i)
post_event_share_units = M + F + sum(R_i)
theoretical_ex_price = (P - D + rights_subscription_value) / post_event_share_units
step_price_factor = theoretical_ex_price / P
step_volume_factor = M * (1 + F)
```

Rights are intentionally excluded from `step_volume_factor` in engine v1.

- [ ] **Step 1: Register test contract** for `tests/qeo-124-adjustment-engine.test.ts` with owner `market-data` and deterministic factor/lineage invariant.
- [ ] **Step 2: RED identity test** — empty event set returns theoretical price `P`, price factor `1`, volume factor `1`, empty sorted action IDs.
- [ ] **Step 3: GREEN identity implementation.**
- [ ] **Step 4: RED cash test** — `P=100`, cash `10` => price `90`, factor `0.9`, volume `1`; reject total cash `>= P`.
- [ ] **Step 5: GREEN cash implementation.**
- [ ] **Step 6: RED stock dividend/bonus tests** — `1:1` => price factor `0.5`, volume factor `2`; percent-normalized `100:30` => share multiplier `1.3`.
- [ ] **Step 7: GREEN stock-dividend/bonus implementation.**
- [ ] **Step 8: RED split/consolidation tests** — `1:2` split => price factor `0.5`, volume `2`; `2:1` consolidation => price factor `2`, volume `0.5`; reject more than one split/consolidation component in one event set.
- [ ] **Step 9: GREEN split implementation.**
- [ ] **Step 10: RED rights test** — explicit `existing:new-rights` + subscription price changes TERP price but keeps volume multiplier `1` when no stock/split component exists.
- [ ] **Step 11: GREEN rights implementation.**
- [ ] **Step 12: RED same-date multi-action permutation test** — shuffled cash + stock + rights arrays yield byte-equivalent action-ID ordering, factor values and formula inputs.
- [ ] **Step 13: GREEN deterministic event-set implementation.**
- [ ] **Step 14: RED invalid-input tests** — wrong ticker/date, non-positive reference close, zero/non-finite ratios, missing subscription price and contradictory fields fail closed with typed errors.
- [ ] **Step 15: GREEN validation and refactor.**
- [ ] **Step 16: Run** `node --test tests/qeo-124-adjustment-engine.test.ts`, `pnpm test:manifest`, `pnpm typecheck`; commit `feat(QEO-124): implement deterministic factor formulas`.

### Task 3: Build deterministic lineage and cumulative backward transitions

**Files:**
- Create: `modules/market/corporate-actions/adjustment/lineage.ts`
- Create: `modules/market/corporate-actions/adjustment/engine.ts`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`

**Interfaces:**

```ts
export type RawDailyReference = {
  sessionDate: string
  close: number
}

export type FactorTransition = StepAdjustment & {
  ticker: string
  effectiveSession: string
  referenceSession: string
  referenceRawClose: number
  cumulativePriceFactor: number
  cumulativeVolumeFactor: number
  eventLineageHash: string
}

export type FactorRunCandidate = {
  ticker: string
  factorVersion: string
  engineVersion: string
  eventLineageHash: string
  asOfDate: string
  status: "candidate" | "blocked"
  blockedReason: string | null
  transitions: FactorTransition[]
}

export function buildFactorRunCandidate(input: {
  ticker: string
  sessions: string[]
  rawDailyByDate: Map<string, RawDailyReference>
  actions: CanonicalFactorAction[]
  asOfDate: string
  engineVersion: string
}): FactorRunCandidate
```

- [ ] **Step 1: RED no-action lineage test** — deterministic candidate with no transitions and stable hash/version.
- [ ] **Step 2: RED reference-session test** — each event set uses the immediately preceding canonical trading session supplied in `sessions`; missing reference row blocks the run.
- [ ] **Step 3: RED future-event test** — actions after `asOfDate` do not create active/candidate transitions affecting historical cumulative factors.
- [ ] **Step 4: RED cumulative fold test** — newest-to-oldest price and volume step factors compound deterministically.
- [ ] **Step 5: RED amendment/input-change test** — changing normalized terms, raw evidence hash, reference close or engine version changes lineage/factorVersion.
- [ ] **Step 6: Implement canonical stable JSON hashing** with sorted object keys, sorted event sets and sorted action IDs.
- [ ] **Step 7: Implement engine and typed blocked reasons** for missing ex-date/reference/unsupported composition.
- [ ] **Step 8: Verify GREEN** with targeted node test + `pnpm typecheck`; commit `feat(QEO-124): build versioned factor runs`.

### Task 4: Add atomic persistence RPC and exact readback store

**Files:**
- Modify: `supabase/migrations/20260906165000_qeo124_adjustment_factor_runs.sql` before production promotion only
- Create: `modules/market/corporate-actions/adjustment/store.ts`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`
- Create: `tests/corporate-actions/qeo124-factor-persistence.sql`
- Modify: `tests/db-schema-contract.test.ts`

**Interfaces:**

Database RPC:

```text
qeo_persist_adjustment_factor_candidate(
  p_ticker text,
  p_factor_version text,
  p_engine_version text,
  p_event_lineage_hash text,
  p_as_of_date date,
  p_status text,
  p_blocked_reason text,
  p_transitions jsonb
) -> uuid run_id
```

Application store:

```ts
export async function persistFactorRunCandidate(
  supabase: SupabaseClient,
  candidate: FactorRunCandidate,
): Promise<{ runId: string; persistedTransitions: number }>
```

- [ ] **Step 1: RED DB contract** requiring RPC to be service-role-only and transactionally replace only the same `(ticker, factor_version)` candidate, never mutate an active run.
- [ ] **Step 2: RED SQL persistence fixture** proving one same-date event set creates one transition, unchanged rerun is idempotent, and active-run rows are immutable through candidate persistence.
- [ ] **Step 3: RED TypeScript readback test** — application reports success only if run fields and every persisted transition exactly match expected factor values, action IDs and lineage.
- [ ] **Step 4: Implement minimal SECURITY DEFINER RPC** with fixed search path, explicit input validation, candidate upsert + transition replacement in one transaction, and grants only to `service_role`.
- [ ] **Step 5: Implement store call + exact readback comparison**; never trust RPC return alone.
- [ ] **Step 6: Replay migration from zero, regenerate types and execute SQL fixture.**
- [ ] **Step 7: Verify GREEN** with DB schema test, SQL fixture, node engine tests, `pnpm db:replay:verify`, `pnpm db:types:verify`, `pnpm test:db-drift`, `pnpm typecheck`; commit `feat(QEO-124): persist factor candidates atomically`.

### Task 5: Golden VHM factor regression

**Files:**
- Create: `tests/fixtures/corporate-actions/vhm-qeo124-golden.json`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`
- Create: `docs/db/evidence/qeo124-vhm-adjustment-factors.md`

- [ ] **Step 1: Build fixture only from exact QEO-123 canonical VHM rows and deterministic raw Daily reference rows captured as evidence; no live provider call inside the test.**
- [ ] **Step 2: RED historical VHM factor transitions** requiring expected event-set dates, sorted action IDs, reference sessions and lineage.
- [ ] **Step 3: RED weekly regression** — apply cumulative price factors to the fixture Daily bars and aggregate 13–17/10/2025 using existing QEO-93 calendar semantics; require H≈63.31 / L≈55.18 within documented tolerance.
- [ ] **Step 4: Assert exact session identities are unchanged and no duplicate/shift is introduced.**
- [ ] **Step 5: Record source action IDs/terms, factor transitions, benchmark source role and numerical deltas in evidence doc.**
- [ ] **Step 6: Verify targeted tests and commit** `test(QEO-124): pin VHM adjustment factor regression`.

### Task 6: Exact-head CI and production promotion gate

- [ ] Open/maintain QEO-124 PR from `feat/qeo-124-adjustment-engine` to `main`.
- [ ] Run exact-head `Verify`, `DB Drift`, migration replay/generated-types and relevant QEO-124 tests; no merge while any exact-head gate is non-green.
- [ ] Reconcile `main` if concurrent migrations/types/ledger changed, rerun zero-to-latest replay and exact-head gates.
- [ ] Merge with expected-head SHA protection.
- [ ] Only after merge GREEN, apply QEO-124 migration to production; record actual production timestamp in `supabase/migration-equivalence.json` and reviewed migration ledger if it differs from repository version.
- [ ] Read back production schema/RLS/RPC grants exactly.
- [ ] Generate/persist VHM candidate only; do not activate chart consumers.
- [ ] Read back VHM candidate run and every transition; compare exact lineage/factors to deterministic fixture.
- [ ] Rerun unchanged VHM generation and prove same factorVersion/lineage and no duplicate transition rows.
- [ ] Update Linear QEO-124 with source SHA, CI evidence, production migration/readback and VHM candidate evidence.
- [ ] Unblock QEO-129 only when all production evidence is GREEN.
