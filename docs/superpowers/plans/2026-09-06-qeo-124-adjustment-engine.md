# QEO-124 Adjustment Factor Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute deterministic, versioned, auditable Daily price/volume adjustment factors from canonical corporate actions and raw Daily evidence.

**Architecture:** Keep the factor engine pure and provider-agnostic. Load normalized events + raw reference Daily bars, compute every same-date corporate-action set as one theoretical ex-price transition, fold step factors backward into cumulative factors, persist derived factor lineage, and expose explicit `pending/active/ambiguous` status. Tickers with no effective action still receive deterministic identity factors so shadow adjusted Daily can be complete. No chart consumer reads factors directly until QEO-125 cutover.

**Tech Stack:** TypeScript, PostgreSQL/Supabase, existing market calendar/history modules, node tests.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123 canonical corporate actions.
- QeoIndex owns factor computation; never copy Yahoo/FireAnt factors as authority.
- Future events do not become active before canonical `ex_date`.
- Cash dividend does not mechanically scale volume.
- Ambiguous/missing terms fail closed.
- Same-date cash/stock/rights components are solved as one complete event set against the same prior raw reference price; never apply order-dependent sequential mutations.
- A ticker/session with no effective corporate action has explicit identity factors `priceFactor=1`, `volumeFactor=1`, `stepFactor=1` under the current lineage/version.
- Factors are recomputable and every active factor references exact event lineage + engine version.

---

### Task 1: Add factor persistence schema

**Files:**
- Create: `supabase/migrations/20260906164000_qeo124_market_price_adjustment_factors.sql`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Modify: `modules/shared/supabase/database.types.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**
- Produces `market_price_adjustment_factors` keyed by `(ticker, session_date, factor_version)`.

- [ ] **Step 1: RED migration contract**

Require columns for `price_factor`, `volume_factor`, `step_factor`, `engine_version`, `event_lineage_hash`, `corporate_action_ids`, `effective_from`, `status`, `computed_at` and a unique active-lineage invariant.

- [ ] **Step 2: Implement migration + service-role mutation policy**

Core shape:

```sql
create table public.market_price_adjustment_factors (
  ticker text not null,
  session_date date not null,
  price_factor numeric not null,
  volume_factor numeric not null,
  step_factor numeric not null,
  factor_version text not null,
  engine_version text not null,
  event_lineage_hash text not null,
  corporate_action_ids uuid[] not null,
  effective_from date not null,
  status text not null check (status in ('pending','active','superseded','ambiguous')),
  computed_at timestamptz not null default now(),
  primary key (ticker, session_date, factor_version)
);
```

Add checks `price_factor > 0`, `volume_factor > 0`, `step_factor > 0`, plus an index supporting `(ticker, status, session_date)` reads.

- [ ] **Step 3: Regenerate types and register migration equivalence**

Repository version is exactly `20260906164000`. If production applies under a different Supabase timestamp, map it explicitly in `supabase/migration-equivalence.json` and update the reviewed production ledger.

- [ ] **Step 4: Run DB Drift**

Expected: reviewed ledger, replay-from-zero, generated types and DB contracts all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906164000_qeo124_market_price_adjustment_factors.sql supabase/migration-equivalence.json docs/db/evidence/production-migration-ledger-2026-09-06.json modules/shared/supabase/database.types.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-124): add adjustment factor storage"
```

### Task 2: Implement pure factor formulas

**Files:**
- Create: `modules/market/corporate-actions/adjustment/formulas.ts`
- Create: `modules/market/corporate-actions/adjustment/types.ts`
- Test: `tests/qeo-124-adjustment-engine.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export type AdjustmentEventSet = {
  ticker: string
  exDate: string
  previousRawClose: number
  events: NormalizedCorporateAction[]
}

export type StepAdjustment = {
  priceFactor: number
  volumeFactor: number
  eventIds: string[]
}

export function computeStepAdjustment(input: AdjustmentEventSet): StepAdjustment
```

- [ ] **Step 1: Register `tests/qeo-124-adjustment-engine.test.ts` in `tests/test-contracts.json`** with owner `market-data` and deterministic factor/lineage invariant.
- [ ] **Step 2: RED identity fixture** — empty effective event set returns exactly `priceFactor=1`, `volumeFactor=1`; later cumulative-series tests prove no-action tickers receive full session coverage rather than missing factors.
- [ ] **Step 3: GREEN identity formula**
- [ ] **Step 4: RED cash-dividend fixture**

Assert:

```ts
priceFactor === (previousRawClose - cashPerShare) / previousRawClose
volumeFactor === 1
```

Reject `cashPerShare >= previousRawClose` as ambiguous rather than creating a non-positive factor.

- [ ] **Step 5: GREEN cash formula**
- [ ] **Step 6: RED stock dividend/split fixture** — ratio `1:1` gives price factor `0.5`; volume factor is the explicit reciprocal normalization required by the selected adjusted-volume basis, never inferred from the price field at render time.
- [ ] **Step 7: GREEN stock/split formula**
- [ ] **Step 8: RED rights issue fixture** using explicit ratio + subscription price + previous raw close.
- [ ] **Step 9: GREEN rights formula**
- [ ] **Step 10: RED multi-action same-date event-set fixture** — shuffled cash/stock/right components must produce the same single theoretical ex-price and the same price/volume step factors. The implementation must solve from the complete entitlement set against the original `previousRawClose`; it must not feed one component's adjusted price into the next component.
- [ ] **Step 11: GREEN deterministic event-set calculation**
- [ ] **Step 12: Commit**

### Task 3: Build cumulative backward factor series

**Files:**
- Create: `modules/market/corporate-actions/adjustment/engine.ts`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`

**Interfaces:**

```ts
export type FactorRow = {
  ticker: string
  sessionDate: string
  priceFactor: number
  volumeFactor: number
  stepFactor: number
  eventLineageHash: string
  corporateActionIds: string[]
  status: "pending" | "active" | "ambiguous"
}

export function buildAdjustmentFactorSeries(input: {
  ticker: string
  sessions: string[]
  rawDailyByDate: Map<string, RawDailyBar>
  actions: CanonicalCorporateAction[]
  asOfDate: string
  engineVersion: string
}): FactorRow[]
```

- [ ] **Step 1: RED zero-action series** — every requested canonical session receives an active identity row under deterministic empty-event lineage; no missing factor gaps are allowed solely because a ticker had no corporate action.
- [ ] **Step 2: RED future event activation test** — an event with `exDate > asOfDate` may yield pending metadata but must not alter active historical cumulative factors.
- [ ] **Step 3: RED backward-fold test** — two historical event sets compound from newest to oldest deterministically.
- [ ] **Step 4: Implement engine**
- [ ] **Step 5: Verify event amendment changes lineage from the earliest affected action backward and leaves later unaffected sessions unchanged**
- [ ] **Step 6: Commit**

### Task 4: Add lineage hashing and persistence/readback

**Files:**
- Create: `modules/market/corporate-actions/adjustment/store.ts`
- Modify: `modules/market/corporate-actions/adjustment/engine.ts`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`

**Interfaces:**

```ts
export async function persistFactorSeries(
  supabase: SupabaseClient,
  rows: FactorRow[],
): Promise<{ persisted: number; lineageHash: string }>
```

- [ ] **Step 1: RED idempotency test** — same normalized events/raw references/engine version produce identical hash/version.
- [ ] **Step 2: RED persisted-readback test** — count success only when DB rows match exact lineage and factor values.
- [ ] **Step 3: Implement stable canonical JSON hashing of event component IDs/terms + engine version**
- [ ] **Step 4: Implement persistence with supersede/activate semantics**
- [ ] **Step 5: Commit**

### Task 5: Golden VHM factor validation

**Files:**
- Create: `tests/fixtures/corporate-actions/vhm-golden.json`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`
- Create: `docs/db/evidence/qeo124-vhm-adjustment-factors.md`

- [ ] **Step 1: Encode exact VHM corporate-action terms from QEO-123 canonical rows**
- [ ] **Step 2: Load raw Daily references from deterministic fixture, not current live provider calls**
- [ ] **Step 3: Apply factor rows to the VHM Daily fixture and aggregate 13–17/10/2025 through the same QEO-93 calendar semantics; require weekly H≈63.31 / L≈55.18 within documented tolerance**
- [ ] **Step 4: Assert no duplicate/session shift is introduced by factor application**
- [ ] **Step 5: Record factor transitions, event component IDs and benchmark deltas in evidence doc**
- [ ] **Step 6: Commit**

### Task 6: Production promotion gate

- [ ] Verify QEO-123 production event rows exist with exact provenance.
- [ ] Apply QEO-124 migration only after Verify + DB Drift green.
- [ ] Record exact production migration version in equivalence/ledger evidence.
- [ ] Generate factors for VHM only; do not switch chart consumers yet.
- [ ] Read back factor lineage and compare golden calculations.
- [ ] Re-run unchanged generation and prove idempotent/no-op.
- [ ] Update Linear QEO-124 with factor evidence; only then unblock QEO-129.
