# QEO-234 Compact Daily Provenance Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `market_ohlcv_history` over to compact registry-backed Daily provenance, prove production compact writes, remove repeated inline `provider_detail` / `source_url`, and reclaim physical storage only when measured production capacity gates permit it.

**Architecture:** Ship a non-destructive registry-canonical bridge first: long legacy columns become nullable, provenance-sensitive readers/RPCs become registry-backed, and writers persist only `provider`, `fetched_at`, `provenance_id`, and OHLCV. After a machine-authenticated production canary proves that bridge, a separately authorized maintenance migration enforces `provenance_id NOT NULL`, removes only the two long columns, retires the QEO-233 backfill RPC, and preserves logical provenance APIs. Physical reclaim is a separate maintenance action: benchmark the overlapping lookup index, calculate the approved peak-space gate, and run `VACUUM FULL` only if both thresholds pass.

**Tech Stack:** TypeScript, Next.js route handlers, Supabase/PostgreSQL migrations, `@supabase/supabase-js`, PostgreSQL `pgcrypto`, Node.js 24 test runner, pnpm 10.28.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-qeo-234-compact-daily-provenance-cutover-design.md`

## Global Constraints

- `market_ohlcv_history` remains the canonical completed-Daily fact store keyed by `(ticker,timeframe,bar_time)`.
- Version-1 provenance identity remains exact byte equality of `(identity_version, provider, provider_detail, source_url)`; no normalization is allowed.
- Final fact rows retain inline `provider`, inline `fetched_at`, and `provenance_id`; remove only `provider_detail` and `source_url`.
- Final `provenance_id` is `NOT NULL`; the FK remains `ON DELETE RESTRICT`.
- Grouped Daily RPC ABI remains exact width 10: `[bar_time, open, high, low, close, volume, provider, provider_detail, source_url, fetched_at]`.
- Zero-volume fallback authority remains logically equivalent to `provider='Fallback'`, `source_url='internal://stock_orderbook_snapshots'`, and `provider_detail ILIKE 'Verified final market-close repair%'`.
- Do not change Daily OHLCV values, provider precedence, RAW/ADJUSTED basis, fact identity, or Daily retention.
- Do not reuse intraday provenance contracts.
- Do not use a shadow-table copy under the current production headroom unless a later measured review explicitly supersedes the approved design.
- Do not drop `market_ohlcv_history_lookup_idx` without the approved benchmark gates.
- `VACUUM FULL` is not part of a migration and is not automatic. It requires explicit production maintenance authorization after bridge acceptance.
- `VACUUM FULL` is allowed only when current DB size is `<= 385000000` bytes and conservative estimated peak is `<= 470000000` bytes.
- QeoIndex inline-only policy applies: source implementation uses GitHub; runtime verification is GitHub Actions; do not run local/remote shell commands unless explicitly authorized.
- Production bridge migration, merge/deploy, Stage-2 maintenance cutover, and physical rewrite each remain explicit authorization gates.

---

## File Map

### New files

- `tests/qeo-234-daily-provenance-cutover.cases.ts` — focused source/schema/runtime contract for both bridge and final cutover.
- `.github/workflows/qeo-234.yml` — focused Node 24 contract workflow.
- `supabase/migrations/20260915193000_qeo234_daily_provenance_bridge.sql` — nullable-long-column bridge, registry-canonical compatibility model, registry-aware SQL consumers.
- `supabase/migrations/20260915194500_qeo234_daily_provenance_cutover.sql` — fail-closed final schema cutover; no `VACUUM FULL`.
- `modules/market/history/daily-provenance-canary.ts` — controlled idempotent compact-writer verification against one existing Daily fact.
- `app/api/qeoindex/daily-provenance-canary/route.ts` — machine-only POST wrapper for the canary.
- `docs/db/runbooks/qeo234-daily-provenance-maintenance.md` — exact production preflight, digest, writer pause, index benchmark, capacity formula, physical rewrite, rollback, and restore-writer SQL.

### Modified files

- `modules/market/history/daily-provenance.ts` — remove pre-QEO-233 schema fallback and write compact fact rows only.
- `modules/market/history/ohlcv-store.ts` — remove provenance-sensitive direct legacy fallback.
- `modules/market/history/daily-integrity.ts` — remove provenance-sensitive direct legacy fallback.
- `modules/market/chart-data/service.ts` — remove provenance-sensitive direct legacy fallback.
- `modules/market/chart-data/maintenance.ts` — remove provenance-sensitive direct legacy fallback.
- `modules/market/history/daily-cold-history.ts` — remove provenance-sensitive direct legacy fallback while leaving OHLCV-only direct reads unchanged.
- `modules/shared/supabase/database.types.ts` — regenerate from final zero-to-latest schema through DB Drift workflow evidence.
- `supabase/migration-preproduction.json` — register bridge and cutover migrations as reviewed repo-ahead entries until production mapping is reconciled.

### Intentionally unchanged interfaces

- Callers keep constructing `PersistedDailyOhlcvRow` with logical `provider_detail` and `source_url`; the shared helper uses them only to resolve provenance identity.
- `qeo_market_ohlcv_recent(...)` keeps its logical return columns.
- `qeo_market_ohlcv_recent_grouped(...)` keeps width/order exactly unchanged.
- Direct OHLCV-only reads of `market_ohlcv_history` remain valid.

---

### Task 1: Lock the QEO-234 contract in RED

**Files:**
- Create: `tests/qeo-234-daily-provenance-cutover.cases.ts`
- Create: `.github/workflows/qeo-234.yml`

**Interfaces:**
- Consumes: QEO-232/QEO-233 migration contracts and the approved QEO-234 spec.
- Produces: one focused contract suite that must fail before bridge/cutover implementation exists.

- [ ] **Step 1: Add migration/source discovery helpers and RED bridge assertions.**

Create `tests/qeo-234-daily-provenance-cutover.cases.ts` with the following structure:

```ts
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function migration(pattern: RegExp) {
  const dir = new URL("../supabase/migrations/", import.meta.url)
  const name = readdirSync(dir).find((entry) => pattern.test(entry))
  assert.ok(name, `Missing migration matching ${pattern}`)
  return source(`supabase/migrations/${name}`)
}

const bridgePattern = /_qeo234_daily_provenance_bridge\.sql$/
const cutoverPattern = /_qeo234_daily_provenance_cutover\.sql$/

test("QEO-234 bridge makes long fields nullable and registry-canonical", () => {
  const sql = migration(bridgePattern)
  assert.match(sql, /alter\s+column\s+provider_detail\s+drop\s+not\s+null/i)
  assert.match(sql, /alter\s+column\s+source_url\s+drop\s+not\s+null/i)
  assert.match(sql, /market_ohlcv_history_compat/i)
  assert.match(sql, /registry\.provider_detail/i)
  assert.match(sql, /registry\.source_url/i)
  assert.match(sql, /history\.provider\s*=\s*registry\.provider/i)
})

test("QEO-234 bridge migrates all live SQL provenance consumers", () => {
  const sql = migration(bridgePattern)
  for (const fn of [
    "qeo_market_ohlcv_recent",
    "qeo_market_daily_integrity_report",
    "qeo_market_daily_integrity_report_scoped",
  ]) assert.match(sql, new RegExp(fn, "i"))
  assert.match(sql, /from\s+public\.market_ohlcv_history_compat/i)
})
```

- [ ] **Step 2: Add RED compact-writer, reader, canary, and final-cutover assertions.**

Append:

```ts
test("QEO-234 writer resolves logical provenance but persists a compact fact", () => {
  const helper = source("modules/market/history/daily-provenance.ts")
  assert.doesNotMatch(helper, /legacyUpsert|qeo233SchemaUnavailable/)
  assert.match(helper, /provenance_id/)
  assert.match(helper, /provider_detail/)
  assert.match(helper, /source_url/)
  assert.match(helper, /compactFacts|compactFact/)
})

test("QEO-234 provenance-sensitive readers have no direct long-field fallback", () => {
  for (const path of [
    "modules/market/history/ohlcv-store.ts",
    "modules/market/history/daily-integrity.ts",
    "modules/market/chart-data/service.ts",
    "modules/market/chart-data/maintenance.ts",
    "modules/market/history/daily-cold-history.ts",
  ]) {
    const text = source(path)
    assert.match(text, /market_ohlcv_history_compat/)
    assert.doesNotMatch(
      text,
      /from\(["']market_ohlcv_history["']\)[\s\S]{0,500}?select\(["'][^"']*(?:provider_detail|source_url)/,
      `${path} must not fall back to long provenance columns on the fact table`,
    )
  }
})

test("QEO-234 exposes a machine-only controlled writer canary", () => {
  const routePath = "app/api/qeoindex/daily-provenance-canary/route.ts"
  assert.equal(existsSync(new URL(`../${routePath}`, import.meta.url)), true)
  const route = source(routePath)
  const canary = source("modules/market/history/daily-provenance-canary.ts")
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /runDailyProvenanceCanary/)
  assert.doesNotMatch(route, /request\.json\(/)
  assert.match(canary, /persistDailyOhlcvRows/)
  assert.match(canary, /market_ohlcv_history_compat/)
})

test("QEO-234 final cutover drops only long inline provenance and retires backfill", () => {
  const sql = migration(cutoverPattern)
  assert.match(sql, /alter\s+column\s+provenance_id\s+set\s+not\s+null/i)
  assert.match(sql, /drop\s+column\s+provider_detail/i)
  assert.match(sql, /drop\s+column\s+source_url/i)
  assert.doesNotMatch(sql, /drop\s+column\s+provider\b/i)
  assert.doesNotMatch(sql, /drop\s+column\s+fetched_at\b/i)
  assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.qeo_market_ohlcv_provenance_backfill_batch/i)
  assert.match(sql, /foreign key[\s\S]*on delete restrict|market_ohlcv_history_provenance_id_fkey/i)
  assert.doesNotMatch(sql, /vacuum\s+full/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate(?:\s+table)?\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /chart_ohlcv_provenance_batches/i)
})

test("QEO-234 keeps grouped Daily tuple width/order and rollback reconstruction evidence", () => {
  const sql = `${migration(bridgePattern)}\n${migration(cutoverPattern)}`
  assert.match(sql, /jsonb_build_array\([\s\S]*?bar_time[\s\S]*?open[\s\S]*?high[\s\S]*?low[\s\S]*?close[\s\S]*?volume[\s\S]*?provider[\s\S]*?provider_detail[\s\S]*?source_url[\s\S]*?fetched_at/i)
  assert.match(source("modules/market/history/ohlcv-grouped.ts"), /COMPACT_DAILY_ROW_WIDTH\s*=\s*10/)
  const runbook = source("docs/db/runbooks/qeo234-daily-provenance-maintenance.md")
  assert.match(runbook, /ADD COLUMN provider_detail text/i)
  assert.match(runbook, /ADD COLUMN source_url text/i)
  assert.match(runbook, /market_ohlcv_provenance/i)
})
```

- [ ] **Step 3: Add focused GitHub Actions workflow.**

Create `.github/workflows/qeo-234.yml`:

```yaml
name: QEO-234

permissions:
  contents: read

on:
  pull_request:
    paths:
      - "docs/superpowers/specs/2026-09-15-qeo-234-compact-daily-provenance-cutover-design.md"
      - "docs/superpowers/plans/2026-09-15-qeo-234-compact-daily-provenance-cutover.md"
      - "docs/db/runbooks/qeo234-daily-provenance-maintenance.md"
      - "tests/qeo-234-daily-provenance-cutover.cases.ts"
      - "supabase/migrations/*_qeo234_daily_provenance_*.sql"
      - "supabase/migration-preproduction.json"
      - "modules/market/history/daily-provenance.ts"
      - "modules/market/history/daily-provenance-canary.ts"
      - "modules/market/history/ohlcv-store.ts"
      - "modules/market/history/daily-integrity.ts"
      - "modules/eod/no-trade-repair-step.ts"
      - "modules/market/chart-data/service.ts"
      - "modules/market/chart-data/maintenance.ts"
      - "modules/market/history/daily-cold-history.ts"
      - "modules/market/history/ohlcv-grouped.ts"
      - "app/api/qeoindex/daily-provenance-canary/route.ts"
      - "modules/shared/supabase/database.types.ts"
      - ".github/workflows/qeo-234.yml"
  push:
    branches: [main]
    paths:
      - "tests/qeo-234-daily-provenance-cutover.cases.ts"
      - "supabase/migrations/*_qeo234_daily_provenance_*.sql"
      - "modules/market/history/daily-provenance.ts"
      - ".github/workflows/qeo-234.yml"

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.28.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts tests/qeo-234-daily-provenance-cutover.cases.ts
```

- [ ] **Step 4: Push the RED-only change and capture expected failure from GitHub Actions.**

Expected failure must be missing QEO-234 migration/runbook/canary implementation, not syntax/workflow setup failure.

- [ ] **Step 5: Commit the RED contract.**

Commit message:

```text
test(QEO-234): define compact Daily provenance cutover contract
```

---

### Task 2: Add the non-destructive registry-canonical bridge migration

**Files:**
- Create: `supabase/migrations/20260915193000_qeo234_daily_provenance_bridge.sql`
- Test: `tests/qeo-234-daily-provenance-cutover.cases.ts`

**Interfaces:**
- Consumes: QEO-233 registry, `provenance_id`, compatibility view, grouped RPC.
- Produces: nullable legacy long fields; registry-canonical compatibility reads; registry-aware recent/integrity RPCs.

- [ ] **Step 1: Make only the two long legacy fields nullable.**

Start the migration with:

```sql
begin;

alter table public.market_ohlcv_history
  alter column provider_detail drop not null,
  alter column source_url drop not null;
```

Do not change `provider`, `fetched_at`, OHLCV constraints, PK, FK, RLS, or permissions.

- [ ] **Step 2: Harden the compatibility view around registry authority.**

Replace the view with this logical shape:

```sql
create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  history.ticker,
  history.timeframe,
  history.bar_time,
  history.open,
  history.high,
  history.low,
  history.close,
  history.volume,
  history.provider,
  case when history.provenance_id is null then history.provider_detail else registry.provider_detail end as provider_detail,
  case when history.provenance_id is null then history.source_url else registry.source_url end as source_url,
  history.fetched_at,
  history.provenance_id,
  (
    history.provenance_id is not null
    and registry.id is not null
    and history.provider = registry.provider
    and (history.provider_detail is null or history.provider_detail = registry.provider_detail)
    and (history.source_url is null or history.source_url = registry.source_url)
  ) as provenance_consistent
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id;

revoke all privileges on table public.market_ohlcv_history_compat from public, anon, authenticated;
grant select on table public.market_ohlcv_history_compat to service_role;
```

A null `provenance_id` is now inconsistent even though the physical column remains nullable until Stage 2.

- [ ] **Step 3: Recreate `qeo_market_ohlcv_recent` over the compatibility view without changing its return type.**

Its lateral source must be:

```sql
from public.market_ohlcv_history_compat source
where source.ticker = q.ticker
  and source.timeframe = '1D'
  and source.provenance_consistent is true
order by source.bar_time desc
limit greatest(1, least(coalesce(p_limit, 260), 1700))
```

Keep these logical output columns in the current order:

```text
ticker,timeframe,bar_time,open,high,low,close,volume,
provider,provider_detail,source_url,fetched_at
```

Retain the existing service-role-only execute grants.

- [ ] **Step 4: Recreate both Daily integrity RPCs over `market_ohlcv_history_compat`.**

In each function, the `daily` CTE must select the same logical fields as today but change the source to:

```sql
from public.market_ohlcv_history_compat h
join ...
where h.timeframe = '1D'
  and h.provenance_consistent is true
```

Keep the exact zero-volume authority predicate unchanged:

```sql
provider in ('VCI', 'DNSE')
or (
  provider = 'Fallback'
  and source_url = 'internal://stock_orderbook_snapshots'
  and provider_detail ilike 'Verified final market-close repair%'
)
```

Do not change result columns/status semantics.

- [ ] **Step 5: Leave grouped RPC width/order unchanged and keep QEO-233 backfill RPC present during bridge.**

The bridge is not the destructive cutover. Do not drop `qeo_market_ohlcv_provenance_backfill_batch` yet.

- [ ] **Step 6: Commit bridge migration.**

```text
feat(QEO-234): add registry-canonical Daily provenance bridge
```

---

### Task 3: Cut application writers/readers over and add a controlled production canary

**Files:**
- Modify: `modules/market/history/daily-provenance.ts`
- Modify: `modules/market/history/ohlcv-store.ts`
- Modify: `modules/market/history/daily-integrity.ts`
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/maintenance.ts`
- Modify: `modules/market/history/daily-cold-history.ts`
- Create: `modules/market/history/daily-provenance-canary.ts`
- Create: `app/api/qeoindex/daily-provenance-canary/route.ts`
- Test: `tests/qeo-234-daily-provenance-cutover.cases.ts`

**Interfaces:**
- `persistDailyOhlcvRows(supabase, rows)` still consumes complete logical provenance.
- It now persists a compact fact object that omits `provider_detail` and `source_url`.
- `runDailyProvenanceCanary(supabase, ticker)` rewrites one existing fact idempotently and returns verification evidence.

- [ ] **Step 1: Remove the pre-schema legacy writer fallback.**

Delete `qeo233SchemaUnavailable(...)`, `legacyUpsert(...)`, and the fallback branch in `persistDailyOhlcvRows`.

A registry resolve failure now always throws:

```ts
if (provenanceUpsert.error) {
  throw new Error(`Daily provenance resolve failed: ${provenanceUpsert.error.message}`)
}
```

- [ ] **Step 2: Persist compact fact objects only.**

Replace the current `facts = rows.map(...)` with:

```ts
const compactFacts = rows.map((row) => {
  const provenanceId = resolved.get(provenanceIdentityKey(row))
  if (!provenanceId) throw new Error(`Daily provenance id missing for ${row.ticker} at ${row.bar_time}`)
  const { provider_detail: _providerDetail, source_url: _sourceUrl, ...fact } = row
  return { ...fact, provenance_id: provenanceId }
})
```

Then batch `compactFacts`, not source `rows`, into the fact upsert.

The caller-facing `PersistedDailyOhlcvRow` interface stays unchanged because those long fields are still required to resolve exact provenance.

- [ ] **Step 3: Remove direct legacy long-field reader fallbacks.**

For each provenance-sensitive reader listed in the file map, remove branches that catch compatibility-view absence and then select `provider_detail`/`source_url` from `market_ohlcv_history`.

The canonical pattern becomes:

```ts
const { data, error } = await supabase
  .from("market_ohlcv_history_compat")
  .select("...")

if (error) throw new Error(`...: ${error.message}`)
assertDailyProvenanceConsistent((data || []) as Array<Record<string, unknown>>, "<context>")
```

Do not change direct fact reads that select only non-provenance fields such as `ticker`, `bar_time`, `close`, or `volume`.

- [ ] **Step 4: Implement the idempotent canary helper.**

Create `modules/market/history/daily-provenance-canary.ts` with this contract:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { persistDailyOhlcvRows } from "./daily-provenance"

export type DailyProvenanceCanaryResult = {
  passed: boolean
  ticker: string
  barTime: string
  provenanceId: number
  bridgeLegacyColumnsPresent: boolean
  bridgeLegacyColumnsNull: boolean | null
  logicalProvenancePreserved: boolean
}

export async function runDailyProvenanceCanary(
  supabase: SupabaseClient,
  ticker: string,
): Promise<DailyProvenanceCanaryResult> {
  // 1. Load one latest consistent logical row from market_ohlcv_history_compat.
  // 2. During bridge only, set provider_detail/source_url to NULL for exactly that PK.
  //    If PostgREST reports those columns no longer exist, treat that as final-schema mode.
  // 3. Call persistDailyOhlcvRows with the exact pre-canary logical OHLCV/provenance/fetched_at.
  // 4. Re-read compact fact fields and compat logical provenance.
  // 5. Require identical OHLCV, provider, fetched_at, logical provider_detail/source_url,
  //    a positive provenance_id, and provenance_consistent=true.
  // 6. Return evidence; never accept request-supplied OHLCV/provenance values.
}
```

Use an exact missing-column detector limited to `provider_detail` / `source_url`; any other update/select error throws.

For bridge mode, the direct nulling mutation must be constrained by all three fact-key fields:

```ts
.eq("ticker", row.ticker)
.eq("timeframe", "1D")
.eq("bar_time", row.bar_time)
```

The helper must never change OHLCV values.

- [ ] **Step 5: Add the machine-only canary route using the existing QEO-231 auth pattern.**

Create `app/api/qeoindex/daily-provenance-canary/route.ts` using the same two machine-auth paths as `chart-storage-audit`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { runDailyProvenanceCanary } from "@/modules/market/history/daily-provenance-canary"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
```

Authorize `CRON_SECRET` first, then bearer-token verification through `qeo_verify_eod_scheduler_secret`. Accept only a validated `ticker` query parameter (`^[A-Z0-9]{2,12}$`). Do not parse request JSON and do not accept caller-supplied OHLCV or provenance strings.

Return HTTP 200 when `result.passed`, 409 when the canary completed but verification failed, 401 unauthorized, 400 invalid ticker, 503 missing Supabase service client, and 500 on unexpected errors. Set `Cache-Control: private, no-store`.

- [ ] **Step 6: Run focused QEO-234 workflow and standard relevant source tests in GitHub Actions.**

Required focused command:

```bash
node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts tests/qeo-234-daily-provenance-cutover.cases.ts
```

Expected: GREEN after Tasks 2–3.

- [ ] **Step 7: Commit application cutover + canary.**

```text
refactor(QEO-234): cut Daily provenance runtime to compact references
```

---

### Task 4: Add the fail-closed final cutover migration

**Files:**
- Create: `supabase/migrations/20260915194500_qeo234_daily_provenance_cutover.sql`
- Test: `tests/qeo-234-daily-provenance-cutover.cases.ts`

**Interfaces:**
- Consumes: successful QEO-233 backfill and Stage-1 bridge semantics.
- Produces: final compact fact schema and retired historical backfill RPC.

- [ ] **Step 1: Add fail-closed pre-DDL assertions.**

Start inside a transaction:

```sql
begin;

do $$
declare
  v_pending bigint;
  v_orphan bigint;
  v_provider_mismatch bigint;
  v_legacy_mismatch bigint;
begin
  select count(*) into v_pending
  from public.market_ohlcv_history
  where provenance_id is null;

  select count(*) into v_orphan
  from public.market_ohlcv_history h
  left join public.market_ohlcv_provenance p on p.id = h.provenance_id
  where h.provenance_id is not null and p.id is null;

  select count(*) into v_provider_mismatch
  from public.market_ohlcv_history h
  join public.market_ohlcv_provenance p on p.id = h.provenance_id
  where h.provider is distinct from p.provider;

  select count(*) into v_legacy_mismatch
  from public.market_ohlcv_history h
  join public.market_ohlcv_provenance p on p.id = h.provenance_id
  where (h.provider_detail is not null and h.provider_detail is distinct from p.provider_detail)
     or (h.source_url is not null and h.source_url is distinct from p.source_url);

  if v_pending <> 0 or v_orphan <> 0 or v_provider_mismatch <> 0 or v_legacy_mismatch <> 0 then
    raise exception 'QEO-234 cutover gate failed pending=% orphan=% provider_mismatch=% legacy_mismatch=%',
      v_pending, v_orphan, v_provider_mismatch, v_legacy_mismatch;
  end if;
end;
$$;
```

- [ ] **Step 2: Replace the fact consistency guard before dropping columns.**

Drop/recreate the trigger so it references only `provenance_id` and `provider`:

```sql
drop trigger if exists qeo_market_ohlcv_provenance_consistency_guard
on public.market_ohlcv_history;

create or replace function public.qeo_market_ohlcv_provenance_consistency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registry_provider text;
begin
  if new.provenance_id is null then
    raise exception 'Daily OHLCV provenance_id is required';
  end if;

  select provider into registry_provider
  from public.market_ohlcv_provenance
  where id = new.provenance_id;

  if not found then
    raise exception 'Daily OHLCV provenance_id % does not exist', new.provenance_id;
  end if;

  if new.provider is distinct from registry_provider then
    raise exception 'Daily OHLCV provenance provider mismatch for %.% at %', new.ticker, new.timeframe, new.bar_time;
  end if;

  return new;
end;
$$;

create trigger qeo_market_ohlcv_provenance_consistency_guard
before insert or update of provenance_id, provider
on public.market_ohlcv_history
for each row
execute function public.qeo_market_ohlcv_provenance_consistency_guard();
```

Retain the existing function privilege restrictions.

- [ ] **Step 3: Redefine compatibility view to use registry-only long fields.**

Use:

```sql
create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  h.ticker, h.timeframe, h.bar_time,
  h.open, h.high, h.low, h.close, h.volume,
  h.provider,
  p.provider_detail,
  p.source_url,
  h.fetched_at,
  h.provenance_id,
  (p.id is not null and h.provider = p.provider) as provenance_consistent
from public.market_ohlcv_history h
left join public.market_ohlcv_provenance p on p.id = h.provenance_id;
```

This removes live view dependencies on the soon-to-be-dropped columns before the `ALTER TABLE` statement.

- [ ] **Step 4: Retire historical backfill RPC, enforce reference non-null, and drop only the two long fields.**

Execute in this order:

```sql
drop function if exists public.qeo_market_ohlcv_provenance_backfill_batch(integer, bigint);

alter table public.market_ohlcv_history
  alter column provenance_id set not null;

alter table public.market_ohlcv_history
  drop column provider_detail,
  drop column source_url;
```

Do not include `VACUUM`, `VACUUM FULL`, DELETE/TRUNCATE, fact-row UPDATE, shadow copy, or index removal in this migration.

- [ ] **Step 5: Re-assert final schema invariants before commit.**

Use a final `DO` block that raises unless:

```text
provider exists and is NOT NULL
fetched_at exists and is NOT NULL
provenance_id exists and is NOT NULL
provider_detail does not exist on market_ohlcv_history
source_url does not exist on market_ohlcv_history
market_ohlcv_history_provenance_id_fkey exists with ON DELETE RESTRICT
```

Then `commit;`.

- [ ] **Step 6: Commit final logical cutover migration.**

```text
feat(QEO-234): add compact Daily provenance final cutover
```

---

### Task 5: Add the deterministic maintenance and rollback runbook

**Files:**
- Create: `docs/db/runbooks/qeo234-daily-provenance-maintenance.md`
- Test: `tests/qeo-234-daily-provenance-cutover.cases.ts`

**Interfaces:**
- Produces exact SQL/evidence checklist used during bridge canary and separately authorized Stage-2 maintenance.
- Does not run automatically.

- [ ] **Step 1: Document the production authorization boundaries at the top.**

The runbook must state verbatim in substance:

```text
Applying the bridge migration requires explicit production authorization.
Merging/deploying the compact application requires explicit authorization.
Stage-2 writer pause / destructive cutover requires a new explicit authorization after bridge canary acceptance.
VACUUM FULL requires the same maintenance authorization plus both capacity gates.
```

- [ ] **Step 2: Add exact preflight state + deterministic logical digest SQL.**

Use `pgcrypto` and the compatibility view. The digest query must hash per-row canonical JSON in PK order, then hash the ordered list of row hashes:

```sql
with logical_rows as (
  select
    h.ticker,
    h.timeframe,
    h.bar_time,
    h.open,
    h.high,
    h.low,
    h.close,
    h.volume,
    h.provider,
    h.provider_detail,
    h.source_url,
    h.fetched_at
  from public.market_ohlcv_history_compat h
  where h.provenance_consistent is true
), row_hashes as (
  select
    ticker,
    timeframe,
    bar_time,
    encode(
      extensions.digest(
        jsonb_build_array(
          ticker,
          timeframe,
          to_char(bar_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          open,
          high,
          low,
          close,
          volume,
          provider,
          provider_detail,
          source_url,
          to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        )::text,
        'sha256'
      ),
      'hex'
    ) as row_hash
  from logical_rows
)
select
  count(*)::bigint as row_count,
  encode(
    extensions.digest(
      string_agg(row_hash, '' order by ticker, timeframe, bar_time),
      'sha256'
    ),
    'hex'
  ) as logical_sha256
from row_hashes;
```

If the installed `digest` function resolves in another schema in zero-to-latest CI, use the generated environment's canonical schema-qualified name consistently in both pre/post queries; do not fall back to nondeterministic serialization.

Also record:

```sql
select pg_database_size(current_database()) as database_bytes,
       pg_relation_size('public.market_ohlcv_history') as heap_bytes,
       pg_indexes_size('public.market_ohlcv_history') as index_bytes,
       pg_total_relation_size('public.market_ohlcv_history') as total_bytes;
```

- [ ] **Step 3: Add dependency-proof SQL.**

The runbook must query live view/function/trigger definitions and stop if any current runtime object still references `market_ohlcv_history.provider_detail` or `market_ohlcv_history.source_url` directly. Historical migration text is excluded from this database-object check.

- [ ] **Step 4: Add exact writer pause / restore SQL.**

Pause:

```sql
revoke insert, update on table public.market_ohlcv_history from service_role;
```

Restore only after all post-cutover checks pass:

```sql
grant insert, update on table public.market_ohlcv_history to service_role;
```

Document that reads remain available and that no writer permission is restored on a failed verification.

- [ ] **Step 5: Add lookup-index baseline and rollbackable experiment.**

Baseline representative query for at least `VCB`, `FPT`, `HPG`, `SSI`, `VNM`:

```sql
explain (analyze, buffers, format json)
select ticker, timeframe, bar_time, open, high, low, close, volume, provider, fetched_at, provenance_id
from public.market_ohlcv_history
where ticker = 'VCB' and timeframe = '1D'
order by bar_time desc
limit 260;
```

Experiment:

```sql
begin;
drop index public.market_ohlcv_history_lookup_idx;
-- repeat EXPLAIN (ANALYZE, BUFFERS) for the same ticker set
rollback;
```

Permanent index removal is allowed only when every representative query avoids sequential scan, execution time is no worse than `2x` its baseline, and absolute execution time is `<20 ms`.

- [ ] **Step 6: Add physical capacity formula and hard gate.**

The runbook computes:

```text
estimated_rewrite_temp_bytes = estimated_compact_live_tuple_bytes * 1.6 + remaining_index_bytes * 1.25
estimated_peak_database_bytes = current_database_bytes + estimated_rewrite_temp_bytes
```

It must say `VACUUM FULL` is prohibited unless:

```text
current_database_bytes <= 385000000
estimated_peak_database_bytes <= 470000000
```

- [ ] **Step 7: Add physical rewrite SQL as a separately authorized manual action.**

The runbook may contain, but no migration/workflow may invoke:

```sql
set statement_timeout = '8min';
vacuum full public.market_ohlcv_history;
analyze public.market_ohlcv_history;
```

If the SQL client does not permit `SET` + `VACUUM FULL` in one request because of transaction wrapping, execute the timeout/session setting and standalone `VACUUM FULL` using the supported production SQL interface without wrapping the vacuum in a transaction.

- [ ] **Step 8: Add exact lossless rollback reconstruction SQL.**

The rollback section must begin with writers paused and include:

```sql
alter table public.market_ohlcv_history
  add column provider_detail text,
  add column source_url text;

update public.market_ohlcv_history h
set provider_detail = p.provider_detail,
    source_url = p.source_url
from public.market_ohlcv_provenance p
where p.id = h.provenance_id;

-- hard gate before NOT NULL
select count(*) as unresolved
from public.market_ohlcv_history
where provider_detail is null or source_url is null;

alter table public.market_ohlcv_history
  alter column provider_detail set not null,
  alter column source_url set not null;
```

Then restore QEO-233-compatible view/trigger/RPC definitions from reviewed repository migration source, verify the same logical digest + width-10 ABI, deploy a legacy-compatible application build only after those checks, and finally restore writer permissions.

- [ ] **Step 9: Commit the runbook.**

```text
docs(QEO-234): add Daily provenance maintenance runbook
```

---

### Task 6: Register migrations and regenerate final schema types through DB Drift

**Files:**
- Modify: `supabase/migration-preproduction.json`
- Modify via generated DB artifact: `modules/shared/supabase/database.types.ts`
- Review: existing `.github/workflows/db-drift.yml`

**Interfaces:**
- Produces reviewed repo-ahead migration ledger entries and final compile-time schema types.

- [ ] **Step 1: Add both QEO-234 migration records to `migration-preproduction.json`.**

Append entries with these exact logical names and repository versions:

```json
{
  "logicalName": "qeo234_daily_provenance_bridge",
  "repositoryVersion": "20260915193000",
  "productionVersion": null,
  "state": "REPO_AHEAD",
  "evidence": "QEO-234 approved two-stage compact Daily provenance design and focused RED/GREEN contracts; production bridge promotion remains separately authorized",
  "rationale": "Makes legacy provider_detail/source_url nullable, moves live provenance consumers to registry-backed logical reads, and preserves backward compatibility before compact writer deployment. No legacy column drop or physical reclaim occurs in this migration."
},
{
  "logicalName": "qeo234_daily_provenance_cutover",
  "repositoryVersion": "20260915194500",
  "productionVersion": null,
  "state": "REPO_AHEAD",
  "evidence": "QEO-234 reviewed fail-closed compact cutover contract; production Stage-2 promotion requires bridge production canary and new maintenance authorization",
  "rationale": "After fail-closed provenance assertions, enforces provenance_id NOT NULL, removes only provider_detail/source_url, retires the obsolete QEO-233 historical backfill RPC, and preserves registry-backed logical APIs. VACUUM FULL and index removal are deliberately outside this migration."
}
```

- [ ] **Step 2: Let DB Drift replay zero-to-latest and generate the candidate types artifact.**

Do not run Supabase CLI locally under QeoIndex inline-only policy. Use the PR-triggered DB Drift workflow as the execution environment.

Required final generated type facts:

```text
market_ohlcv_history.Row has provider, fetched_at, provenance_id: number
market_ohlcv_history.Row has no provider_detail or source_url
market_ohlcv_history.provenance_id is non-null in Row/Insert contract as generated by final schema
market_ohlcv_history_compat still exposes provider_detail/source_url logical fields
qeo_market_ohlcv_recent still exposes provider_detail/source_url
qeo_market_ohlcv_provenance_backfill_batch no longer exists
```

- [ ] **Step 3: Commit the exact generated `modules/shared/supabase/database.types.ts` candidate produced by CI.**

Do not hand-edit generated types.

Commit:

```text
chore(QEO-234): refresh compact Daily provenance schema types
```

- [ ] **Step 4: Require DB Drift reconciliation GREEN on the exact head.**

Verify its successful steps include zero-to-latest migration replay, generated type verification/artifact, current DB contracts, TypeScript compile, and the repository's configured DB rehearsals.

---

### Task 7: Exact-head source verification and bridge-release gate

**Files:**
- Review all QEO-234 source/migration changes.
- No production mutation in this task without explicit approval.

**Interfaces:**
- Produces a merge/bridge-rollout candidate with exact-head evidence.

- [ ] **Step 1: Run focused QEO-234 workflow on final head.**

Require:

```bash
node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts tests/qeo-234-daily-provenance-cutover.cases.ts
```

Expected: zero failures.

- [ ] **Step 2: Require standard `Verify` GREEN on the same exact head.**

Require repository gates including secret scans, repo hygiene/current contracts, touched lint, TypeScript, Ops dashboard build, and production build.

- [ ] **Step 3: Require DB Drift GREEN on the same exact head.**

Do not infer migration safety from focused source tests alone.

- [ ] **Step 4: Review the final diff against destructive-safety rejects.**

Reject the source candidate if it contains any of the following outside the explicitly reviewed Stage-2 migration/runbook context:

```text
DROP provider
DROP fetched_at
Daily-history DELETE/TRUNCATE
OHLCV UPDATE/backfill
shadow copy/swap
intraday provenance reuse
automatic VACUUM FULL
automatic lookup-index drop
automatic production canary invocation
```

- [ ] **Step 5: Stop for explicit bridge production authorization before any production mutation.**

Because `main` deployment may happen automatically after merge, the safe rollout order is:

```text
exact-head PR green
→ explicit user authorization for Stage-1 bridge promotion
→ apply ONLY 20260915193000_qeo234_daily_provenance_bridge.sql to production
→ verify old QEO-233 application still reads/writes correctly on bridge schema
→ update production migration evidence/mapping as required
→ explicit user approval to merge
→ merge exact head / verify production deployment SHA
→ run production Daily provenance canary
```

Do not merge compact-writer application code before the production bridge schema is present unless deployment is explicitly held back.

---

### Task 8: Production Stage-1 bridge acceptance

**Files:**
- Operational evidence only; source changes only if acceptance reveals a real defect.
- Update Linear QEO-234 evidence.

**Authorization:** Requires explicit production bridge authorization. This task is not authorized merely by source-plan approval.

- [ ] **Step 1: Re-measure pre-bridge state.**

Record DB bytes, history heap/index/total bytes, row count, pending provenance rows, mismatch/orphan rows, registry count, and current logical digest.

Hard stop if pending/mismatch/orphan is non-zero.

- [ ] **Step 2: Apply only the bridge migration.**

Promote `qeo234_daily_provenance_bridge` through Supabase migration tooling. Do not apply the final cutover migration.

- [ ] **Step 3: Read back bridge schema/functions.**

Verify both long columns still exist but are nullable; compat view is registry-canonical; recent/integrity RPC definitions source the compat model; grouped width remains 10.

- [ ] **Step 4: Merge/deploy the exact-head compact application only after the bridge readback passes and merge/deploy approval is explicit.**

Verify production deployment commit SHA matches the merged reviewed head.

- [ ] **Step 5: Run machine-auth canary for at least `VCB` plus four representative tickers (`FPT`, `HPG`, `SSI`, `VNM`).**

For every ticker require HTTP 200 and:

```text
passed=true
positive provenanceId
bridgeLegacyColumnsPresent=true
bridgeLegacyColumnsNull=true
logicalProvenancePreserved=true
```

Then verify production counts still show zero mismatch/orphan/compat inconsistencies.

- [ ] **Step 6: Verify representative grouped/recent/integrity/chart Daily reads after canary.**

Do not proceed to Stage 2 on a partially accepted bridge.

- [ ] **Step 7: Record evidence in QEO-234 and stop for new Stage-2 maintenance authorization.**

The bridge canary acceptance does not itself authorize writer pause, column drops, index changes, or `VACUUM FULL`.

---

### Task 9: Separately authorized Stage-2 maintenance cutover and physical reclaim

**Files:**
- Execute from reviewed migration + runbook only.
- Update Linear QEO-234 with measured evidence.

**Authorization:** Requires explicit user approval immediately before the maintenance window.

- [ ] **Step 1: Execute runbook Preflight A exactly.**

Require bridge acceptance, pending=0, mismatch/orphan=0, dependency audit clean, row count + logical SHA-256 captured, DB/relation/index bytes captured, and representative index-query baselines captured.

- [ ] **Step 2: Pause Daily writers.**

Run only the reviewed `REVOKE INSERT, UPDATE ... FROM service_role` and verify a service-role compact write is rejected while reads remain available.

- [ ] **Step 3: Apply only the final QEO-234 cutover migration.**

On any assertion/DDL failure, treat the transaction as failed, verify schema remains bridge-compatible, and keep writers paused until state is understood.

- [ ] **Step 4: Verify logical cutover before any physical rewrite.**

Require:

```text
row count matches pre-pause baseline
provider_detail/source_url absent from fact schema
provenance_id NOT NULL
every row resolves registry
provider == registry.provider on every row
logical SHA-256 equals pre-cutover SHA-256
grouped width 10
recent RPC logical fields intact
integrity RPCs execute with unchanged zero-volume classification semantics
representative chart/Wyckoff Daily reads succeed
```

Digest mismatch is an absolute stop.

- [ ] **Step 5: Benchmark lookup-index removal transactionally.**

Use the runbook query set. Permanently drop `market_ohlcv_history_lookup_idx` only if every approved threshold passes. Index failure does not roll back the logical provenance cutover; retain the index and continue to the capacity decision.

- [ ] **Step 6: Run regular `VACUUM (ANALYZE)` and calculate the physical rewrite gate.**

Re-measure `current_database_bytes`, `estimated_compact_live_tuple_bytes`, and `remaining_index_bytes`, then calculate the approved conservative peak.

If either threshold fails, skip `VACUUM FULL`, document capacity-based defer, and continue to post-cutover verification/restore writers.

- [ ] **Step 7: Run `VACUUM FULL` only when both approved thresholds pass.**

Use the runbook's standalone maintenance command with approximately 8-minute timeout. Do not automatically retry on timeout/disk/lock error.

- [ ] **Step 8: Repeat the full post-reclaim verification.**

Recalculate logical digest, row count, DB/heap/index/total bytes, grouped width, integrity RPCs, and representative read latency. Record actual physical delta; do not substitute the ~50 MB target for measured result.

- [ ] **Step 9: Restore writer permissions only after all applicable verification passes.**

Run the reviewed `GRANT INSERT, UPDATE ... TO service_role`.

- [ ] **Step 10: Run post-cutover compact-writer canary.**

The canary must succeed in final-schema mode (`bridgeLegacyColumnsPresent=false`) and preserve exact registry-backed logical provenance.

- [ ] **Step 11: Mark QEO-234 Done only after acceptance evidence is complete.**

If physical rewrite is capacity-deferred, keep physical-reclaim acceptance explicitly open unless the issue records an accepted defer outcome per the approved spec.

---

### Task 10: Production migration-ledger reconciliation after actual promotion

**Files:**
- Modify after production promotion: `supabase/migration-preproduction.json`
- Create/modify current reviewed production ledger under `docs/db/evidence/production-migration-ledger-YYYY-MM-DD.json` as required by DB Drift.

**Interfaces:**
- Produces exact repositoryVersion → productionVersion mappings for both QEO-234 migrations after they are actually promoted.

- [ ] **Step 1: Read live Supabase migration versions; never guess assigned production versions.**

- [ ] **Step 2: Change only promoted QEO-234 entries from `REPO_AHEAD` to `MAPPED`.**

Record exact bridge and cutover production versions independently because Stage 1 and Stage 2 are promoted at different checkpoints.

- [ ] **Step 3: Add reviewed production-ledger rows required by `scripts/db/verify-migration-drift.mjs`.**

Carry forward the prior reviewed subset and add only QEO-234 migrations whose production promotion has been verified. Unrelated production rows remain outside this issue-owned reviewed subset.

- [ ] **Step 4: Open a focused ledger-only PR and require Verify + DB Drift GREEN on its exact head.**

Do not mix new DDL/runtime behavior into reconciliation.

- [ ] **Step 5: Merge ledger reconciliation only with user approval.**

---

## Completion Checklist

QEO-234 implementation is source-complete only when:

- focused RED/GREEN contract exists;
- bridge migration is non-destructive and registry-canonical;
- compact writer no longer persists long inline provenance;
- all provenance-sensitive readers have no direct long-field fallback;
- machine-auth canary accepts no arbitrary fact/provenance payload;
- final migration fails closed on null/orphan/provider/legacy mismatch;
- final schema removes only `provider_detail` / `source_url` and makes `provenance_id` non-null;
- grouped width-10 and ungrouped logical APIs remain stable;
- historical QEO-233 backfill RPC is retired only in final cutover;
- deterministic maintenance/rollback runbook exists with exact thresholds;
- generated DB types match final schema;
- focused QEO-234, standard Verify, and DB Drift are GREEN on the same exact source head;
- no production action has been inferred from source approval.

Production QEO-234 is complete only after the separately authorized bridge + maintenance acceptance sequence records the measured final outcome.
