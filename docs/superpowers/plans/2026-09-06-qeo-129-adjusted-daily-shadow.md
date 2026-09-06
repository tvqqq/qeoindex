# QEO-129 Adjusted Daily Shadow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adjusted-Daily shadow store, exact factor/session projection, bounded rebuild API and exact-readback verification required before EOD activation, while keeping every current production consumer on raw Daily.

**Architecture:** Preserve `market_ohlcv_history` as raw/provider evidence. Persist recomputable adjusted rows in `market_ohlcv_adjusted_daily`, keyed by canonical ticker/session and linked to one exact QEO-124 `factor_run_id`; project transition-level cumulative factors to Daily sessions using strict next-effective-session semantics. Track verification in `market_adjusted_daily_rollout`, keep QEO-129 rollout `shadow`, and count success only from exact persisted DB readback.

**Tech Stack:** Supabase/PostgreSQL, TypeScript, existing `modules/market/history/*`, QEO-124 factor tables/store, QEO-93 timeframe aggregation, GitHub Actions replay/type generation.

**Spec:** `docs/superpowers/specs/2026-09-06-qeo-129-adjusted-daily-shadow-design.md`

## Global Constraints

- QEO-123 and QEO-124 are production dependencies.
- Repository migration version is exactly `20260906170000`; QEO-124 owns `20260906165000`.
- Never update/delete/rename/repurpose `market_ohlcv_history` in QEO-129.
- No Chart/Wyckoff/indicator/AI Council consumer cutover.
- QEO-129 may write rollout `shadow|blocked`, never `active`.
- Shadow rebuild accepts an exact verified QEO-124 run in `candidate|active`; `blocked|superseded` fail closed.
- For raw session `d`, choose the first transition where `effective_session > d`; apply that transition's cumulative price/volume factors. If no later transition exists, use identity `1/1` from the same valid run.
- Missing/ambiguous factors, invalid output or lineage mismatch are unresolved; raw passthrough is forbidden.
- Exact DB readback is the only rebuild success authority.
- QEO-129 terminal gate is VHM production shadow acceptance; QEO-126 follows, then QEO-125 consumer cutover.

---

### Task 1: Add shadow schema + readback RPC

**Files:**
- Create: `supabase/migrations/20260906170000_qeo129_adjusted_daily_shadow.sql`
- Modify: `tests/db-schema-contract.test.ts`
- Modify: `tests/market-data-contract.test.ts`
- Regenerate: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- Consumes: QEO-124 `market_adjustment_factor_runs(id,ticker,...)`.
- Produces: `market_ohlcv_adjusted_daily`, `market_adjusted_daily_rollout`, `qeo_adjusted_daily_readback(...)`.

- [ ] **Step 1: Write RED schema tests**

Require migration `20260906170000_qeo129_adjusted_daily_shadow.sql` and assert:

```ts
assert.match(sql, /create table public\.market_ohlcv_adjusted_daily/i)
assert.match(sql, /primary key\s*\(ticker,\s*session_date\)/i)
assert.match(sql, /foreign key\s*\(factor_run_id,\s*ticker\)[\s\S]*market_adjustment_factor_runs\s*\(id,\s*ticker\)/i)
assert.match(sql, /create table public\.market_adjusted_daily_rollout/i)
assert.match(sql, /default\s+'shadow'/i)
assert.match(sql, /qeo_adjusted_daily_readback/i)
assert.match(sql, /security definer/i)
```

Also require positive OHLC, high/low invariants, non-negative volume, lowercase-hex lineage, RLS on both tables, no `anon/authenticated` table privileges and service-role-only RPC execute.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
```

Expected: FAIL because QEO-129 migration does not exist.

- [ ] **Step 3: Implement minimal migration**

Core table shape:

```sql
create table public.market_ohlcv_adjusted_daily (
  ticker text not null,
  session_date date not null,
  bar_time timestamptz not null,
  open numeric not null check (open > 0),
  high numeric not null check (high > 0),
  low numeric not null check (low > 0),
  close numeric not null check (close > 0),
  volume numeric not null check (volume >= 0),
  raw_bar_time timestamptz not null,
  factor_run_id uuid not null,
  factor_version text not null check (btrim(factor_version) <> ''),
  event_lineage_hash text not null check (event_lineage_hash ~ '^[a-f0-9]{64}$'),
  adjustment_engine_version text not null check (btrim(adjustment_engine_version) <> ''),
  rebuilt_at timestamptz not null default now(),
  primary key (ticker, session_date),
  foreign key (factor_run_id, ticker)
    references public.market_adjustment_factor_runs (id, ticker),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);
```

Rollout fields: `ticker`, `status shadow|active|blocked default shadow`, `factor_run_id`, `factor_version`, `event_lineage_hash`, `verified_from`, `verified_through`, `verified_at`, `activated_at`, `blocked_reason`, `updated_at`. Require blocked reason only for `blocked`; require `activated_at` for `active`.

Readback RPC signature:

```sql
qeo_adjusted_daily_readback(
  p_ticker text,
  p_from date,
  p_to date,
  p_factor_run_id uuid,
  p_lineage_hash text
)
```

It returns ordered persisted session identity + factor lineage, is `SECURITY DEFINER`, fixed search path, and executable only by `service_role`.

- [ ] **Step 4: Run schema tests GREEN**

Run the Step 2 command; expected PASS.

- [ ] **Step 5: Run clean local DB replay/lint**

```bash
supabase start
pnpm db:replay:verify
supabase db lint --local
```

Expected PASS.

- [ ] **Step 6: Regenerate Database types and verify**

```bash
supabase gen types typescript --local --schema public > modules/shared/supabase/database.types.ts
pnpm db:types:verify
pnpm typecheck
```

Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260906170000_qeo129_adjusted_daily_shadow.sql \
  modules/shared/supabase/database.types.ts \
  tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-129): add adjusted Daily shadow storage"
```

Do not add production migration mapping/ledger before real promotion. Until promotion, DB Drift may be red only for the repo-only QEO-129 migration.

---

### Task 2: Implement strict factor projection + pure adjustment

**Files:**
- Create: `modules/market/history/adjusted-daily.ts`
- Create: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

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

- [ ] **Step 1: Register focused test in `tests/test-contracts.json`** under owner `market-data`.

- [ ] **Step 2: Write RED projection tests**

```ts
const transitions = [
  { effectiveSession: "2026-06-29", cumulativePriceFactor: 13 / 27, cumulativeVolumeFactor: 2 },
  { effectiveSession: "2026-08-06", cumulativePriceFactor: 1 / 2, cumulativeVolumeFactor: 2 },
]

assert.deepEqual(factorForSession("2025-10-15", transitions), { priceFactor: 13 / 27, volumeFactor: 2 })
assert.deepEqual(factorForSession("2026-06-29", transitions), { priceFactor: 1 / 2, volumeFactor: 2 })
assert.deepEqual(factorForSession("2026-08-06", transitions), { priceFactor: 1, volumeFactor: 1 })
```

This pins strict `effective_session > sessionDate` semantics.

- [ ] **Step 3: Write RED transform tests**

Require OHLC × price factor, volume × volume factor, raw session/bar identity preserved, exact run/version/lineage copied. Reject invalid run status, unsorted/duplicate transition dates and non-finite/non-positive factors.

- [ ] **Step 4: Prove RED**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
```

Expected: module/function missing.

- [ ] **Step 5: Implement minimal pure functions**

```ts
const next = transitions.find((transition) => transition.effectiveSession > sessionDate)
const factor = next
  ? { priceFactor: next.cumulativePriceFactor, volumeFactor: next.cumulativeVolumeFactor }
  : { priceFactor: 1, volumeFactor: 1 }
```

Validate the transition sequence first; `applyDailyAdjustment` fails closed on invalid output.

- [ ] **Step 6: Run GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
pnpm test:manifest
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add modules/market/history/adjusted-daily.ts tests/qeo-129-adjusted-daily-shadow.test.ts tests/test-contracts.json
git commit -m "feat(QEO-129): derive adjusted Daily bars"
```

---

### Task 3: Implement bounded rebuild + exact DB readback

**Files:**
- Create: `modules/market/history/adjusted-daily-store.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Create: `tests/db/qeo129-adjusted-daily-persistence.sql`
- Modify: current preprod DB rehearsal workflow to execute the SQL fixture.

**Interface:**

```ts
export async function rebuildAdjustedDailyRange(input: {
  supabase: SupabaseClient
  ticker: string
  fromDate: string
  toDate: string
  expectedFactorRunId: string
  expectedLineageHash: string
}): Promise<{
  rebuiltSessions: number
  unresolvedSessions: string[]
  firstSession: string | null
  lastSession: string | null
  factorRunId: string
  factorVersion: string
  lineageHash: string
}>
```

- [ ] **Step 1: Write RED false-positive test** — mock adjusted upsert success but omit one expected row from `qeo_adjusted_daily_readback`; assert that session remains unresolved.

- [ ] **Step 2: Write RED run-status/lineage tests** — exact `id+ticker+lineage`; accept only `candidate|active`; reject `blocked|superseded`, wrong ticker/lineage or missing run.

- [ ] **Step 3: Write RED SQL persistence fixture** — transactionally insert synthetic QEO-124 run + two adjusted sessions, read back exact run/lineage/order, prove wrong run/lineage returns zero, prove canonical session uniqueness, rollback and verify zero residual synthetic rows.

- [ ] **Step 4: Prove RED** with focused TS test + local SQL fixture.

- [ ] **Step 5: Implement exact factor loading** — select the expected run by ID/ticker, validate expected lineage/status, then load its transitions ascending. Never choose “latest” implicitly.

- [ ] **Step 6: Load raw `1D` range** from `market_ohlcv_history`; canonicalize `bar_time` with existing Asia/Ho_Chi_Minh session rules; reject duplicate canonical dates.

- [ ] **Step 7: Derive/upsert adjusted rows in bounded batches** using Task 2 only.

- [ ] **Step 8: Call exact readback RPC** and count only persisted matching sessions.

- [ ] **Step 9: Persist rollout metadata** — complete range => `shadow`; incomplete range => `blocked` with bounded reason; never `active`.

- [ ] **Step 10: Run GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/db/qeo129-adjusted-daily-persistence.sql
pnpm typecheck
```

- [ ] **Step 11: Commit**

```bash
git add modules/market/history/adjusted-daily-store.ts \
  tests/qeo-129-adjusted-daily-shadow.test.ts tests/db/qeo129-adjusted-daily-persistence.sql \
  .github/workflows/
git commit -m "feat(QEO-129): rebuild shadow Daily with exact readback"
```

---

### Task 4: Add server-only shadow read boundary + isolation guard

**Files:**
- Create: `modules/market/history/adjusted-daily-read.ts`
- Modify: `modules/market/history/index.ts`
- Modify: `tests/qeo-129-adjusted-daily-shadow.test.ts`
- Modify: `tests/market-data-contract.test.ts`

**Interface:**

```ts
export async function loadAdjustedDailyRange(
  supabase: SupabaseClient,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<{
  bars: MarketHistoryBar[]
  factorRunId: string | null
  factorVersion: string | null
  lineageHash: string | null
  complete: boolean
  unresolvedSessions: string[]
}>
```

- [ ] **Step 1: RED complete-read test** — rollout lineage matches ordered unique adjusted sessions => `complete=true`.
- [ ] **Step 2: RED fail-closed tests** — missing row, duplicate canonical session, row/rollout lineage mismatch or missing rollout => `complete=false`; loader never queries/merges raw history.
- [ ] **Step 3: Implement loader** — query rollout then adjusted table only; validate one expected run/lineage and ordered canonical sessions.
- [ ] **Step 4: Add consumer-isolation contract** — current Chart, Wyckoff and AI Council source paths must not import `adjusted-daily-read.ts` or query `market_ohlcv_adjusted_daily` in QEO-129.
- [ ] **Step 5: Run GREEN**

```bash
pnpm exec tsx --test tests/qeo-129-adjusted-daily-shadow.test.ts tests/market-data-contract.test.ts
pnpm test:current
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add modules/market/history/adjusted-daily-read.ts modules/market/history/index.ts \
  tests/qeo-129-adjusted-daily-shadow.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-129): add shadow Daily read boundary"
```

---

### Task 5: Pre-production verification + real migration promotion

**Files after real promotion:**
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Create: `docs/db/evidence/qeo129-vhm-adjusted-daily-shadow.md`

- [ ] **Step 1: Sync latest `main`**, semantic-merge shared ledger/types if necessary.
- [ ] **Step 2: Run exact pre-promotion gates** — Verify code/contracts/lint/TS/build, preprod zero→latest + SQL persistence + DB lint, EOD v4. DB Drift may fail only because `20260906170000` is repo-only; any other failure blocks promotion.
- [ ] **Step 3: Apply only the QEO-129 migration to production Supabase** and record the migration version returned by Supabase as `actualProductionVersion`.
- [ ] **Step 4: Run rollback-only production smoke** — tables/RLS/grants/RPC security, exact synthetic readback, wrong run/lineage returns zero, rollback leaves zero synthetic QEO-129 rows.
- [ ] **Step 5: Reconcile migration identity using the captured runtime value**. Add a mapping whose `repositoryVersion` is `20260906170000`, whose `productionVersion` is the exact `actualProductionVersion` captured in Step 3, `state` is `MAPPED`, evidence is `qeo129-production-ledger-schema-rls-readback-and-rollback-smoke`, and rationale records successful replay + rollback smoke. Insert the same exact production version into the reviewed ledger in chronological order.
- [ ] **Step 6: Regenerate combined-schema types and obtain exact-head GREEN** — Verify, DB Drift, Preprod, EOD v4 all GREEN. Do not merge yet; VHM shadow acceptance remains required.

---

### Task 6: VHM production shadow acceptance + merge

**Files:**
- Create/update: `docs/db/evidence/qeo129-vhm-adjusted-daily-shadow.md`
- Update: Linear QEO-129

- [ ] **Step 1: Capture raw VHM pre-rebuild evidence** — `1D` row count, first/last session, distinct canonical sessions, stable checksum over raw OHLCV/provider identity.
- [ ] **Step 2: Materialize/reuse one exact persisted QEO-124 VHM factor run**. `candidate` is valid for QEO-129 shadow after exact QEO-124 persistence/readback; do not activate it here.
- [ ] **Step 3: Rebuild retained VHM adjusted Daily in bounded ranges** using exact expected run ID + lineage. Any unresolved session blocks acceptance.
- [ ] **Step 4: Verify integrity** — adjusted count equals expected raw canonical sessions for verified range, zero duplicate/shifted sessions, one exact run/version/lineage, rollout `shadow`, `activated_at is null`.
- [ ] **Step 5: Run QEO-93 VHM golden** for 13–17/10/2025; require approximately `H=63.31`, `L=55.18` within documented tolerance, with no weekly special-case adjustment.
- [ ] **Step 6: Re-run raw evidence query** and require row count/session/checksum unchanged.
- [ ] **Step 7: Prove consumer isolation** — Chart/Wyckoff/AI Council production source remains pre-QEO-129.
- [ ] **Step 8: Measure capacity** — adjusted row count, both QEO-129 relation sizes, measured bytes/row, and an explicitly labeled canonical-200 extrapolation.
- [ ] **Step 9: Update evidence + Linear**; mark QEO-129 Done only with actual production evidence and record QEO-126 unblocked.
- [ ] **Step 10: Final sync + exact-head Verify/DB Drift/Preprod/EOD GREEN, merge with expected head SHA, then verify exact merge-sha Vercel production deployment and fresh Supabase QEO-129 readback. No consumer cutover occurs in this PR.
