# QEO-124 Adjustment Factor Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute deterministic, versioned, auditable Daily price/volume adjustment factors from canonical corporate actions and raw Daily evidence.

**Architecture:** Keep the factor engine pure and provider-agnostic. Load normalized events + raw reference Daily bars, compute same-date event sets into step factors, fold them backward into cumulative factors, persist derived factor lineage, and expose explicit `pending/active/ambiguous` status. No chart consumer reads factors directly until QEO-125 cutover.

**Tech Stack:** TypeScript, PostgreSQL/Supabase, existing market calendar/history modules, node tests.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123 canonical corporate actions.
- QeoIndex owns factor computation; never copy Yahoo/FireAnt factors as authority.
- Future events do not become active before canonical `ex_date`.
- Cash dividend does not mechanically scale volume.
- Ambiguous/missing terms fail closed.
- Factors are recomputable and every active factor references exact event lineage + engine version.

---

### Task 1: Add factor persistence schema

**Files:**
- Create: `supabase/migrations/<timestamp>_qeo124_market_price_adjustment_factors.sql`
- Modify: `lib/supabase/database.types.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**
- Produces `market_price_adjustment_factors` keyed by `(ticker, session_date, factor_version)`.

- [ ] **Step 1: RED migration contract**

Require columns for `price_factor`, `volume_factor`, `step_factor`, `engine_version`, `event_lineage_hash`, `corporate_action_ids`, `effective_from`, `status`, `computed_at` and a unique active lineage invariant.

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

- [ ] **Step 3: Regenerate types; run DB Drift**
- [ ] **Step 4: Commit**

### Task 2: Implement pure factor formulas

**Files:**
- Create: `modules/market/corporate-actions/adjustment/formulas.ts`
- Create: `modules/market/corporate-actions/adjustment/types.ts`
- Test: `tests/qeo-124-adjustment-engine.test.ts`

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

- [ ] **Step 1: RED cash-dividend fixture**

Assert:

```ts
priceFactor === (previousRawClose - cashPerShare) / previousRawClose
volumeFactor === 1
```

Reject `cashPerShare >= previousRawClose` as ambiguous rather than creating non-positive price factor.

- [ ] **Step 2: GREEN cash formula**
- [ ] **Step 3: RED stock dividend/split fixture** — ratio `1:1` gives price factor `0.5` and reciprocal volume normalization where the chosen canonical volume basis requires it.
- [ ] **Step 4: GREEN stock/split formula**
- [ ] **Step 5: RED rights issue fixture** using explicit ratio + subscription price + previous raw close.
- [ ] **Step 6: GREEN rights formula**
- [ ] **Step 7: RED multi-action same-date event-set determinism** — shuffled event order must produce the same output.
- [ ] **Step 8: GREEN deterministic event-set calculation**
- [ ] **Step 9: Commit**

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

- [ ] **Step 1: RED future event activation test** — an event with `exDate > asOfDate` may yield pending metadata but must not alter active historical cumulative factors.
- [ ] **Step 2: RED backward-fold test** — two historical events compound from newest to oldest deterministically.
- [ ] **Step 3: Implement engine**
- [ ] **Step 4: Verify event amendment changes only lineage from the earliest affected action backward**
- [ ] **Step 5: Commit**

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

- [ ] **Step 1: RED idempotency test** — same event/raw inputs produce identical hash/version.
- [ ] **Step 2: RED persisted-readback test** — count success only when DB rows match exact lineage and factor values.
- [ ] **Step 3: Implement stable canonical JSON hashing of event IDs/terms + engine version**
- [ ] **Step 4: Implement persistence with supersede/activate semantics**
- [ ] **Step 5: Commit**

### Task 5: Golden VHM factor validation

**Files:**
- Create: `tests/fixtures/corporate-actions/vhm-golden.json`
- Modify: `tests/qeo-124-adjustment-engine.test.ts`
- Create: `docs/db/evidence/qeo124-vhm-adjustment-factors.md`

- [ ] **Step 1: Encode exact VHM corporate-action terms from QEO-123 canonical rows**
- [ ] **Step 2: Load raw Daily references from deterministic fixture, not current live provider calls**
- [ ] **Step 3: Assert adjusted Daily around 13–17/10/2025 aggregates toward weekly H≈63.31 / L≈55.18 within documented tolerance**
- [ ] **Step 4: Assert no duplicate/session shift is introduced by factor application**
- [ ] **Step 5: Record factor transitions and benchmark deltas in evidence doc**
- [ ] **Step 6: Commit**

### Task 6: Production promotion gate

- [ ] Verify QEO-123 production event rows exist with exact provenance.
- [ ] Apply QEO-124 migration only after Verify + DB Drift green.
- [ ] Generate factors for VHM only; do not switch chart consumers yet.
- [ ] Read back factor lineage and compare golden calculations.
- [ ] Re-run unchanged generation and prove idempotent/no-op.
- [ ] Update Linear QEO-124 with factor evidence; only then unblock QEO-126/QEO-125.
