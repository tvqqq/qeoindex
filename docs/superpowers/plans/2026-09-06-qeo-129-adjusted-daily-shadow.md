# QEO-129 Adjusted Daily Shadow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adjusted-Daily shadow store, rollout state and exact-readback rebuild API required by EOD activation, while keeping every production consumer on the existing raw Daily path.

**Architecture:** Preserve `market_ohlcv_history` as raw/provider evidence. Store recomputable adjusted rows in `market_ohlcv_adjusted_daily`, track per-ticker rollout state separately, and provide server-only rebuild/read functions. QEO-129 ends with VHM shadow data verified but rollout status still `shadow`; QEO-126 can then call the rebuild API safely.

**Tech Stack:** Supabase/PostgreSQL, TypeScript, existing `modules/market/history/*`, QEO-124 factor store.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123 + QEO-124.
- No Chart/Wyckoff/AI Council cutover in this issue.
- Raw provider Daily rows remain unchanged.
- Adjusted rows are derived/recomputable, keyed by canonical trading session and exact factor/event lineage.
- Missing or ambiguous effective factors fail closed.
- Success counts come from exact DB readback, never from candidate/upsert counts.

---

### Task 1: Add adjusted-Daily shadow + rollout schema

**Files:**
- Create: `supabase/migrations/20260906165000_qeo129_adjusted_daily_shadow.sql`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Modify: `modules/shared/supabase/database.types.ts`
- Test: `tests/db-schema-contract.test.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**

```sql
create table public.market_ohlcv_adjusted_daily (
  ticker text not null,
  session_date date not null,
  bar_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  raw_bar_time timestamptz not null,
  factor_version text not null,
  event_lineage_hash text not null,
  adjustment_engine_version text not null,
  rebuilt_at timestamptz not null default now(),
  primary key (ticker, session_date)
);

create table public.market_adjusted_daily_rollout (
  ticker text primary key,
  status text not null check (status in ('shadow','active','blocked')),
  event_lineage_hash text,
  factor_version text,
  verified_at timestamptz,
  activated_at timestamptz,
  blocked_reason text,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 1: RED schema contract**

Require unique ticker/session identity, OHLC validity checks, positive price values, nonnegative volume, rollout default `shadow`, and service-role-only mutation grants. Authenticated reads of adjusted shadow rows must remain unavailable until the later canonical read boundary is introduced.

- [ ] **Step 2: Implement migration**

Add an RPC `qeo_adjusted_daily_readback(p_ticker text, p_from date, p_to date, p_lineage_hash text)` restricted to service role. It returns session dates + lineage needed to prove persistence.

- [ ] **Step 3: Regenerate Database types and register migration equivalence**

Repository migration version is exactly `20260906165000`; map a differing production timestamp explicitly if Supabase applies one.

- [ ] **Step 4: Run DB Drift**

Expected: reviewed ledger, replay-from-zero, generated types and DB contracts PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906165000_qeo129_adjusted_daily_shadow.sql supabase/migration-equivalence.json docs/db/evidence/production-migration-ledger-2026-09-06.json modules/shared/supabase/database.types.ts tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-129): add adjusted Daily shadow storage"
```

### Task 2: Implement pure raw→adjusted transformation

**Files:**
- Create: `modules/market/history/adjusted-daily.ts`
- Create: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export type AdjustedDailyBar = {
  ticker: string
  sessionDate: string
  barTime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  rawBarTime: string
  factorVersion: string
  eventLineageHash: string
  adjustmentEngineVersion: string
}

export function applyDailyAdjustment(raw: RawDailyBar, factor: FactorRow): AdjustedDailyBar
```

- [ ] **Step 1: Register the focused canonical test in `tests/test-contracts.json`**

Owner `market-data`; invariant: adjusted Daily is a pure raw+factor derivation and never falls back silently on missing factors.

- [ ] **Step 2: RED OHLC factor application** — O/H/L/C multiply by `priceFactor`.
- [ ] **Step 3: RED volume semantics** — volume uses explicit `volumeFactor`, not price factor.
- [ ] **Step 4: RED missing/ambiguous factor** — typed unresolved result/error; no raw passthrough.
- [ ] **Step 5: Implement minimal pure transformation**
- [ ] **Step 6: Run focused test GREEN and commit**

### Task 3: Implement bounded shadow rebuild + exact DB readback

**Files:**
- Create: `modules/market/history/adjusted-daily-store.ts`
- Modify: `modules/market/history/adjusted-daily.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`

**Interfaces:**

```ts
export async function rebuildAdjustedDailyRange(input: {
  supabase: SupabaseClient
  ticker: string
  fromDate: string
  toDate: string
  expectedLineageHash: string
}): Promise<{
  rebuiltSessions: number
  unresolvedSessions: string[]
  firstSession: string | null
  lastSession: string | null
}>
```

- [ ] **Step 1: RED persistence false-positive regression** — if DB readback does not contain the expected session+lineage, that session remains unresolved even when upsert returned no error.
- [ ] **Step 2: Load raw Daily from `market_ohlcv_history` using the existing canonical session rules and active factors from QEO-124**
- [ ] **Step 3: Upsert adjusted rows in bounded batches**
- [ ] **Step 4: Call `qeo_adjusted_daily_readback` and derive success only from persisted exact sessions**
- [ ] **Step 5: Set rollout row to `shadow` with verified lineage; never `active` here**
- [ ] **Step 6: Commit**

### Task 4: Add server-only shadow read abstraction

**Files:**
- Create: `modules/market/history/adjusted-daily-read.ts`
- Modify: `modules/market/history/index.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`

**Interfaces:**

```ts
export async function loadAdjustedDailyRange(
  supabase: SupabaseClient,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<{ bars: MarketHistoryBar[]; lineageHash: string | null; complete: boolean }>
```

- [ ] **Step 1: RED complete shadow read contract** — ordered canonical sessions, exact lineage, no duplicate dates.
- [ ] **Step 2: RED incomplete range contract** — `complete=false`; no automatic raw merge.
- [ ] **Step 3: Implement server-only loader**
- [ ] **Step 4: Verify no import/use from chart service, Wyckoff or AI Council yet**
- [ ] **Step 5: Commit**

### Task 5: VHM shadow production acceptance

**Files:**
- Create: `docs/db/evidence/qeo129-vhm-adjusted-daily-shadow.md`

- [ ] Apply migration only after Verify + DB Drift green.
- [ ] Generate/reuse verified VHM QEO-124 factor lineage.
- [ ] Rebuild the retained VHM adjusted Daily range in `shadow`.
- [ ] Require complete factor/session coverage, 0 duplicate/shifted sessions and exact readback lineage.
- [ ] Aggregate 13–17/10/2025 from shadow Daily using QEO-93 rules and require H≈63.31 / L≈55.18 within documented tolerance.
- [ ] Verify `market_ohlcv_history` raw evidence is unchanged.
- [ ] Verify rollout status remains `shadow` and every current production consumer still reads its pre-QEO-129 source.
- [ ] Measure table/database growth.
- [ ] Update QEO-129 with evidence; only then unblock QEO-126.
