# QEO-129 Adjusted Daily Shadow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-safe adjusted-Daily shadow store and exact-readback rebuild boundary from raw `1D` + one exact QEO-124 factor run, without changing any current Chart, Wyckoff, indicator, AI Council or EOD consumer authority.

**Architecture:** Preserve `market_ohlcv_history` as raw/provider evidence. Persist recomputable adjusted Daily rows in `market_ohlcv_adjusted_daily`, keyed by canonical ticker/session and linked to the exact QEO-124 `factor_run_id`; project transition-level cumulative factors to sessions using strict next-effective-session semantics. Track per-ticker verification state in `market_adjusted_daily_rollout`, keep QEO-129 production state `shadow`, and count rebuild success only from exact persisted DB readback.

**Tech Stack:** Supabase/PostgreSQL, TypeScript, existing `modules/market/history/*`, QEO-124 adjustment engine/store, QEO-93 timeframe aggregation, GitHub Actions DB replay/type generation.

**Spec:** `docs/superpowers/specs/2026-09-06-qeo-129-adjusted-daily-shadow-design.md`

## Global Constraints

- QEO-123 and QEO-124 are production dependencies and must remain canonical source facts / factor authority respectively.
- Repository migration version is exactly `20260906170000`; `20260906165000` belongs to QEO-124.
- `market_ohlcv_history` remains raw/provider evidence; QEO-129 must not update, delete, rename or repurpose it.
- No Chart/Wyckoff/indicator/AI Council consumer cutover in QEO-129.
- QEO-129 may persist rollout `shadow` or `blocked`; it must never set `active`.
- Shadow rebuild may consume an exact verified QEO-124 run in `candidate` or `active`; `blocked` and `superseded` fail closed.
- QEO-124 stores transition-level cumulative factors. For raw session `d`, use the first transition with `effective_session > d`; use that transition's cumulative price/volume factors. If no later transition exists, use identity `1.0/1.0` from the same valid factor run.
- Missing/ambiguous factor coverage, invalid numeric outputs or lineage mismatch are unresolved; raw passthrough is forbidden.
- Success counts come from exact DB readback, never from an upsert acknowledgment or in-memory candidate count.
- Production terminal gate is VHM shadow acceptance only; QEO-126 follows, then QEO-125 consumer cutover.

---

### Task 1: Add adjusted-Daily shadow schema, rollout state and exact readback RPC

**Files:**
- Create: `supabase/migrations/20260906170000_qeo129_adjusted_daily_shadow.sql`
- Modify: `tests/db-schema-contract.test.ts`
- Modify: `tests/market-data-contract.test.ts`
- Modify later after real promotion: `supabase/migration-equivalence.json`
- Modify later after real promotion: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Regenerate after migration: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- Consumes: `market_adjustment_factor_runs(id,ticker,factor_version,engine_version,event_lineage_hash,status)` from QEO-124.
- Produces: `market_ohlcv_adjusted_daily`, `market_adjusted_daily_rollout`, `qeo_adjusted_daily_readback(...)`.

Target schema:

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
  factor_run_id uuid not null,
  factor_version text not null,
  event_lineage_hash text not null,
  adjustment_engine_version text not null,
  rebuilt_at timestamptz not null default now(),
  primary key (ticker, session_date),
  foreign key (factor_run_id, ticker)
    references public.market_adjustment_factor_runs (id, ticker)
);

create table public.market_adjusted_daily_rollout (
  ticker text primary key,
  status text not null default 'shadow'
    check (status in ('shadow','active','blocked')),
  factor_run_id uuid,
  factor_version text,
  event_lineage_hash text,
  verified_from date,
  verified_through date,
  verified_at timestamptz,
  activated_at timestamptz,
  blocked_reason text,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 1: Write RED schema contracts**

Add assertions that migration `20260906170000_qeo129_adjusted_daily_shadow.sql` exists and requires:

```ts
assert.match(sql, /create table public\.market_ohlcv_adjusted_daily/i)
assert.match(sql, /primary key\s*\(ticker,\s*session_date\)/i)
assert.match(sql, /foreign key\s*\(factor_run_id,\s*ticker\)[\s\S]*market_adjustment_factor_runs\s*\(id,\s*ticker\)/i)
assert.match(sql, /status[^\n]*default\s+'shadow'/i)
assert.match(sql, /status in \('shadow','active','blocked'\)/i)
assert.match(sql, /alter table public\.market_ohlcv_adjusted_daily enable row level security/i)
assert.match(sql, /alter table public\.market_adjusted_daily_rollout enable row level security/i)
assert.match(sql, /qeo_adjusted_daily_readback/i)
assert.match(sql, /security definer/i)
assert.match(sql, /grant execute[\s\S]*to service_role/i)
```

Also assert positive OHLC, high/low invariants, non-negative volume, lowercase-hex lineage, non-empty factor/engine version and no direct `anon/authenticated` privileges.

- [ ] **Step 2: Run focused schema tests and prove RED**

Run:

```bash
pnpm exec tsx --test tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
```

Expected: FAIL because QEO-129 migration/schema/RPC do not exist.

- [ ] **Step 3: Implement migration minimally**

Create tables with the constraints above. Add rollout consistency checks:

```sql
check (
  (status = 'blocked' and blocked_reason is not null and btrim(blocked_reason) <> '')
  or (status <> 'blocked' and blocked_reason is null)
),
check (status <> 'active' or activated_at is not null)
```

QEO-129 application code must never write `active`; schema retains `active` for QEO-126/QEO-125 future ownership.

Create service-role-only readback RPC:

```sql
create or replace function public.qeo_adjusted_daily_readback(
  p_ticker text,
  p_from date,
  p_to date,
  p_factor_run_id uuid,
  p_lineage_hash text
)
returns table (
  session_date date,
  bar_time timestamptz,
  raw_bar_time timestamptz,
  factor_run_id uuid,
  factor_version text,
  event_lineage_hash text,
  adjustment_engine_version text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.session_date,
    a.bar_time,
    a.raw_bar_time,
    a.factor_run_id,
    a.factor_version,
    a.event_lineage_hash,
    a.adjustment_engine_version
  from public.market_ohlcv_adjusted_daily a
  where a.ticker = p_ticker
    and a.session_date between p_from and p_to
    and a.factor_run_id = p_factor_run_id
    and a.event_lineage_hash = p_lineage_hash
  order by a.session_date;
$$;
```

Revoke all from `public, anon, authenticated`; grant execute only to `service_role`.

- [ ] **Step 4: Run schema tests GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Run zero-to-latest migration replay before any production promotion**

Use the existing Supabase CI/rehearsal path:

```bash
supabase start
pnpm db:replay:verify
supabase db lint --local
```

Expected: zero-to-latest replay and lint PASS.

- [ ] **Step 6: Regenerate and verify Database types**

```bash
supabase gen types typescript --local --schema public > modules/shared/supabase/database.types.ts
pnpm db:types:verify
pnpm typecheck
```

Expected: generated tables/RPC are present and TypeScript PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add supabase/migrations/20260906170000_qeo129_adjusted_daily_shadow.sql \
  modules/shared/supabase/database.types.ts \
  tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-129): add adjusted Daily shadow storage"
```

Do **not** add production migration equivalence/ledger yet. DB Drift may remain expected-red for a repo-only active migration until real Supabase promotion.

---

### Task 2: Implement deterministic transition-to-session projection and pure raw→adjusted transformation

**Files:**
- Create: `modules/market/history/adjusted-daily.ts`
- Create: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: exact QEO-124 factor run row + ordered `market_price_adjustment_factors` transitions.
- Produces:

```ts
export type ShadowFactorRun = {
  id: string
  ticker: string
  factorVersion: string
  engineVersion: string
  eventLineageHash: string
  status: "candidate" | "active"
}

export type ShadowFactorTransition = {
  effectiveSession: string
  cumulativePriceFactor: number
  cumulativeVolumeFactor: number
}

export type RawDailyBar = {
  ticker: string
  sessionDate: string
  barTime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

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
  factorRunId: string
  factorVersion: string
  eventLineageHash: string
  adjustmentEngineVersion: string
}

export function factorForSession(
  sessionDate: string,
  transitions: ShadowFactorTransition[],
): { priceFactor: number; volumeFactor: number }

export function applyDailyAdjustment(input: {
  raw: RawDailyBar
  run: ShadowFactorRun
  transitions: ShadowFactorTransition[]
}): AdjustedDailyBar
```

- [ ] **Step 1: Register canonical focused test before code**

Add `tests/qeo-129-adjusted-daily-shadow.test.ts` to `tests/test-contracts.json` under owner `market-data`; invariant: adjusted Daily is pure raw+exact-factor derivation, strict transition projection and never raw-fallbacks.

- [ ] **Step 2: Write RED projection tests**

Pin transitions:

```ts
const transitions = [
  { effectiveSession: "2026-06-29", cumulativePriceFactor: 13 / 27, cumulativeVolumeFactor: 2 },
  { effectiveSession: "2026-08-06", cumulativePriceFactor: 1 / 2, cumulativeVolumeFactor: 2 },
]
```

Assertions:

```ts
assert.deepEqual(factorForSession("2025-10-15", transitions), {
  priceFactor: 13 / 27,
  volumeFactor: 2,
})
assert.deepEqual(factorForSession("2026-06-29", transitions), {
  priceFactor: 1 / 2,
  volumeFactor: 2,
})
assert.deepEqual(factorForSession("2026-08-06", transitions), {
  priceFactor: 1,
  volumeFactor: 1,
})
```

This proves **strict** `effective_session > sessionDate`; ex-date itself does not receive its own backward factor.

- [ ] **Step 3: Write RED transform tests**

Assert:

```ts
adjusted.open === raw.open * priceFactor
adjusted.high === raw.high * priceFactor
adjusted.low === raw.low * priceFactor
adjusted.close === raw.close * priceFactor
adjusted.volume === raw.volume * volumeFactor
adjusted.rawBarTime === raw.barTime
adjusted.factorRunId === run.id
```

Also RED cases:
- `run.status` not `candidate|active` is rejected;
- unsorted/duplicate transition dates are rejected;
- non-positive/non-finite factor rejects;
- adjusted OHLC invalid/non-finite rejects;
- no raw passthrough branch exists.

- [ ] **Step 4: Run focused test and prove RED**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
```

Expected: FAIL because `adjusted-daily.ts` does not exist.

- [ ] **Step 5: Implement minimal pure functions**

`factorForSession()`:

```ts
const next = transitions.find((transition) => transition.effectiveSession > sessionDate)
return next
  ? { priceFactor: next.cumulativePriceFactor, volumeFactor: next.cumulativeVolumeFactor }
  : { priceFactor: 1, volumeFactor: 1 }
```

Validate transitions are strictly ascending and factors finite/positive before projecting.

`applyDailyAdjustment()` validates run status and numeric output, then copies exact run lineage fields into the adjusted row.

- [ ] **Step 6: Run focused + manifest + TypeScript GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
pnpm test:manifest
pnpm typecheck
```

- [ ] **Step 7: Commit Task 2**

```bash
git add modules/market/history/adjusted-daily.ts \
  tests/qeo-129-adjusted-daily-shadow.test.ts tests/test-contracts.json
git commit -m "feat(QEO-129): derive adjusted Daily bars"
```

---

### Task 3: Implement exact factor loading, bounded persistence and DB-readback authority

**Files:**
- Create: `modules/market/history/adjusted-daily-store.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Create: `tests/db/qeo129-adjusted-daily-persistence.sql`
- Modify: `.github/workflows/qeo123-preprod-rehearsal.yml` only if this repository's rehearsal uses explicit SQL fixture registration; otherwise add to the current equivalent DB rehearsal step.

**Interfaces:**
- Consumes: `applyDailyAdjustment()`, `market_ohlcv_history`, `market_adjustment_factor_runs`, `market_price_adjustment_factors`, Task 1 readback RPC.
- Produces:

```ts
export type RebuildAdjustedDailyResult = {
  rebuiltSessions: number
  unresolvedSessions: string[]
  firstSession: string | null
  lastSession: string | null
  factorRunId: string
  factorVersion: string
  lineageHash: string
}

export async function rebuildAdjustedDailyRange(input: {
  supabase: SupabaseClient
  ticker: string
  fromDate: string
  toDate: string
  expectedFactorRunId: string
  expectedLineageHash: string
}): Promise<RebuildAdjustedDailyResult>
```

- [ ] **Step 1: Write RED application-store false-positive test**

Mock `.upsert()` success but make `qeo_adjusted_daily_readback` omit one expected session. Assert:

```ts
assert.equal(result.rebuiltSessions, expectedSessions.length - 1)
assert.deepEqual(result.unresolvedSessions, [missingSession])
```

A successful write acknowledgment must not count missing DB readback as rebuilt.

- [ ] **Step 2: Write RED factor-run status/lineage tests**

Require exact `id + ticker + expectedLineageHash`; only `candidate|active` accepted. `blocked|superseded`, different lineage, different ticker or missing run must fail closed before adjusted persistence.

- [ ] **Step 3: Write RED SQL atomic/readback fixture**

In one transaction:
1. create a synthetic valid QEO-124 candidate run;
2. insert two adjusted Daily rows linked to it;
3. call `qeo_adjusted_daily_readback` and require exactly two ordered rows with exact factor run/lineage;
4. verify wrong run/lineage returns zero;
5. verify duplicate `(ticker,session_date)` cannot create a second identity;
6. rollback;
7. confirm zero residual synthetic adjusted/rollout rows.

- [ ] **Step 4: Run RED gates**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/db/qeo129-adjusted-daily-persistence.sql
```

Expected: application test fails because store does not exist; SQL fixture fails until migration/RPC contract is wired as expected.

- [ ] **Step 5: Implement exact factor/run loading**

Load run by `id+ticker`; verify stored run `event_lineage_hash === expectedLineageHash` and status in `candidate|active`. Load transitions by `run_id`, ascending `effective_session`. Never select a different/latest run implicitly.

- [ ] **Step 6: Implement canonical raw Daily loading**

Load only `timeframe='1D'` rows from `market_ohlcv_history` for the requested bounded date range, then canonicalize each `bar_time` to Asia/Ho_Chi_Minh session date using existing market-history session rules. Reject duplicate canonical dates rather than choosing one silently.

- [ ] **Step 7: Implement bounded adjusted upsert**

Derive every raw session through Task 2 functions. Upsert batches by `(ticker,session_date)` with exact `factor_run_id/version/lineage/engine` fields.

- [ ] **Step 8: Implement exact readback comparison**

Call:

```ts
supabase.rpc("qeo_adjusted_daily_readback", {
  p_ticker: ticker,
  p_from: fromDate,
  p_to: toDate,
  p_factor_run_id: expectedFactorRunId,
  p_lineage_hash: expectedLineageHash,
})
```

Build `rebuiltSessions` only from exact matching readback rows. Missing/duplicate/mismatched sessions remain unresolved.

- [ ] **Step 9: Persist rollout metadata without activation**

If every expected raw session has exact readback, upsert rollout:

```ts
{
  ticker,
  status: "shadow",
  factor_run_id: run.id,
  factor_version: run.factor_version,
  event_lineage_hash: run.event_lineage_hash,
  verified_from: fromDate,
  verified_through: toDate,
  verified_at: now,
  activated_at: null,
  blocked_reason: null,
}
```

If incomplete, persist `blocked` with bounded reason and no `activated_at`. No QEO-129 path may write `active`.

- [ ] **Step 10: Run application + SQL + TypeScript GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/db/qeo129-adjusted-daily-persistence.sql
pnpm typecheck
```

- [ ] **Step 11: Commit Task 3**

```bash
git add modules/market/history/adjusted-daily-store.ts \
  tests/qeo-129-adjusted-daily-shadow.test.ts \
  tests/db/qeo129-adjusted-daily-persistence.sql \
  .github/workflows/qeo123-preprod-rehearsal.yml
git commit -m "feat(QEO-129): rebuild shadow Daily with exact readback"
```

---

### Task 4: Add server-only shadow read boundary and consumer-isolation guard

**Files:**
- Create: `modules/market/history/adjusted-daily-read.ts`
- Modify: `modules/market/history/index.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Modify: `tests/market-data-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 tables + rollout metadata.
- Produces:

```ts
export type AdjustedDailyRangeRead = {
  bars: MarketHistoryBar[]
  factorRunId: string | null
  factorVersion: string | null
  lineageHash: string | null
  complete: boolean
  unresolvedSessions: string[]
}

export async function loadAdjustedDailyRange(
  supabase: SupabaseClient,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<AdjustedDailyRangeRead>
```

- [ ] **Step 1: Write RED complete-read test**

Given rollout `shadow` with exact run/lineage and contiguous requested shadow rows, assert ordered bars, one run/lineage and `complete=true`.

- [ ] **Step 2: Write RED fail-closed read tests**

Cases:
- missing adjusted session ⇒ `complete=false`;
- duplicate canonical session ⇒ reject/fail closed;
- row lineage differs from rollout ⇒ `complete=false`;
- no rollout metadata ⇒ `complete=false`;
- no automatic query/merge from `market_ohlcv_history`.

- [ ] **Step 3: Implement loader**

The loader queries rollout first, then only `market_ohlcv_adjusted_daily`; it never falls back to raw. Sort by canonical session ascending and validate every row's run/lineage matches rollout metadata.

- [ ] **Step 4: Add consumer-isolation source contract**

Search/guard that current Chart, Wyckoff and AI Council production modules do not import `adjusted-daily-read.ts` and do not query `market_ohlcv_adjusted_daily` in QEO-129. Expected existing direct/raw paths remain unchanged until QEO-125.

- [ ] **Step 5: Run focused + current contracts GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts tests/market-data-contract.test.ts
pnpm test:current
pnpm typecheck
```

- [ ] **Step 6: Commit Task 4**

```bash
git add modules/market/history/adjusted-daily-read.ts modules/market/history/index.ts \
  tests/qeo-129-adjusted-daily-shadow.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-129): add shadow Daily read boundary"
```

---

### Task 5: Pre-production verification, production migration promotion and reconciliation

**Files:**
- Modify after real promotion: `supabase/migration-equivalence.json`
- Modify after real promotion: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Create: `docs/db/evidence/qeo129-vhm-adjusted-daily-shadow.md`

**Interfaces:**
- Consumes: Tasks 1-4 fully GREEN.
- Produces: reconciled production schema and evidence; still no consumer cutover.

- [ ] **Step 1: Sync latest `main` into feature branch**

Require no hidden overlap. If shared ledger/types changed, semantic-merge and rerun all gates.

- [ ] **Step 2: Run exact pre-promotion gates**

Require:
- Verify code/contracts/lint/TypeScript/build GREEN except any expected repo-only migration-ledger gate;
- QEO-123 Preprod rehearsal including zero-to-latest replay, QEO-129 SQL persistence fixture and DB lint GREEN;
- EOD v4 GREEN;
- DB Drift failure, if any, is only `20260906170000` as unexplained repo-only migration.

Any other failure blocks promotion.

- [ ] **Step 3: Apply migration to production Supabase**

Apply only `20260906170000_qeo129_adjusted_daily_shadow.sql`. Record the actual production migration version returned by Supabase.

- [ ] **Step 4: Run rollback-only production schema/persistence smoke**

Verify:
- both new tables exist and RLS is enabled;
- `anon/authenticated` have no table privileges;
- readback RPC is `SECURITY DEFINER`, fixed search path and service-role-only execute;
- synthetic candidate factor run + adjusted rows can be read back exactly;
- wrong run/lineage returns no rows;
- rollback leaves zero synthetic QEO-129 rows.

- [ ] **Step 5: Reconcile repo→production migration identity**

Add `qeo129_adjusted_daily_shadow` mapping:

```json
{
  "logicalName": "qeo129_adjusted_daily_shadow",
  "repositoryVersion": "20260906170000",
  "productionVersion": "<actual>",
  "state": "MAPPED",
  "evidence": "qeo129-production-ledger-schema-rls-readback-and-rollback-smoke",
  "rationale": "QEO-129 shadow adjusted-Daily storage was promoted after zero-to-latest replay and rollback-only production readback smoke; repository and production timestamps differ only by promotion timestamp."
}
```

Update reviewed production ledger with the actual version in chronological order.

- [ ] **Step 6: Regenerate types from combined schema and obtain exact-head GREEN**

Require final exact head:
- Verify GREEN;
- DB Drift GREEN including reviewed ledger, zero-to-latest replay, generated Database types and current DB contracts;
- QEO-123 Preprod rehearsal GREEN;
- EOD v4 GREEN.

Do not merge yet: QEO-129 still needs VHM production shadow evidence.

---

### Task 6: Materialize VHM shadow history and complete production acceptance

**Files:**
- Create/update: `docs/db/evidence/qeo129-vhm-adjusted-daily-shadow.md`
- Update: Linear QEO-129 acceptance/evidence

**Interfaces:**
- Consumes: production QEO-129 schema, production raw VHM Daily, exact verified QEO-124 VHM factor run, `rebuildAdjustedDailyRange`, QEO-93 aggregation.
- Produces: VHM `shadow` acceptance; unblocks QEO-126.

- [ ] **Step 1: Capture raw VHM pre-rebuild evidence**

Record:
- `market_ohlcv_history` VHM `1D` row count;
- first/last session;
- distinct canonical session count;
- stable checksum over `ticker,bar_time,open,high,low,close,volume,provider,fetched_at` for retained VHM Daily.

- [ ] **Step 2: Materialize/reuse one verified QEO-124 VHM factor run**

Use exact persisted run ID and lineage. For QEO-129 shadow, `candidate` is valid after exact QEO-124 persistence/readback; do not activate it here.

- [ ] **Step 3: Rebuild retained VHM adjusted Daily in bounded ranges**

Call the production server/rebuild boundary using the exact expected run ID/lineage. Every expected session must be resolved through exact DB readback. Any unresolved session blocks acceptance.

- [ ] **Step 4: Verify shadow integrity**

Require:
- adjusted row count equals expected canonical raw Daily session count for verified range;
- `count(*) = count(distinct session_date)`;
- no shifted/non-trading canonical sessions;
- one exact factor run/version/lineage for the verified shadow snapshot;
- rollout `status='shadow'`, `activated_at is null`.

- [ ] **Step 5: Run VHM golden through QEO-93 aggregation**

Load adjusted Daily 13-17/10/2025, call the production aggregation path and require approximately:

```text
weekly high = 63.31
weekly low  = 55.18
```

Use documented market-data tolerance; no special weekly adjustment code.

- [ ] **Step 6: Prove raw evidence unchanged**

Re-run the exact raw VHM row-count/session/checksum query from Step 1. All values must match pre-rebuild evidence.

- [ ] **Step 7: Prove consumer isolation**

Verify current Chart/Wyckoff/AI Council production read paths remain their pre-QEO-129 source. Existence of shadow rows must not change consumer output/source automatically.

- [ ] **Step 8: Measure storage/capacity impact**

Record:
- VHM adjusted row count;
- `pg_total_relation_size('public.market_ohlcv_adjusted_daily')`;
- `pg_total_relation_size('public.market_adjusted_daily_rollout')`;
- estimated canonical-200 retained-history growth using measured bytes/row, explicitly labeled as extrapolation rather than measured production usage.

- [ ] **Step 9: Update evidence and Linear QEO-129**

Mark acceptance items complete only with actual production evidence. Set QEO-129 Done only after VHM shadow acceptance passes. Record that QEO-126 is now unblocked and QEO-125 remains blocked until QEO-126 production acceptance.

- [ ] **Step 10: Final PR exact-head verification and merge**

Before merge, re-sync latest main if needed and require fresh exact-head Verify, DB Drift, QEO-123 Preprod and EOD v4 GREEN. Merge with expected head SHA; then verify Vercel production deployment for the merge SHA and fresh Supabase QEO-129 readback. No consumer cutover occurs in this PR.
