# QEO-234 Compact Daily Provenance Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `market_ohlcv_history` over to compact registry-backed Daily provenance, prove compact writes in production, remove repeated inline `provider_detail` / `source_url`, and reclaim physical storage only when measured capacity gates permit it.

**Architecture:** Ship a non-destructive bridge first: make the long legacy fields nullable, make the registry authoritative for logical provenance, relax the fact consistency trigger only enough to allow null legacy long fields, migrate SQL/application consumers, and make the shared writer persist compact facts. After a production writer canary proves the bridge, a separately authorized maintenance migration enforces `provenance_id NOT NULL`, removes only the two long columns, and retires the historical backfill RPC. Physical reclaim is a separate maintenance action guarded by lookup-index benchmarks and the approved database-capacity thresholds.

**Tech Stack:** TypeScript, Next.js route handlers, Supabase/PostgreSQL migrations, `@supabase/supabase-js`, PostgreSQL `pgcrypto`, Node.js 24, pnpm 10.28.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-qeo-234-compact-daily-provenance-cutover-design.md`

## Global Constraints

- Canonical fact key remains `(ticker,timeframe,bar_time)` in `market_ohlcv_history`.
- Version-1 provenance identity remains exact byte equality of `(identity_version,provider,provider_detail,source_url)`; never normalize strings.
- Final fact keeps `provider`, `fetched_at`, `provenance_id`; remove only `provider_detail`, `source_url`.
- Final `provenance_id` is `NOT NULL`; FK remains `ON DELETE RESTRICT`.
- Grouped Daily ABI remains width 10: `[bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at]`.
- Preserve exact zero-volume authority semantics, Daily OHLCV values, provider precedence, RAW/ADJUSTED basis, and historical Daily retention.
- Do not reuse intraday provenance contracts.
- Do not shadow-copy the Daily table under current headroom unless a later explicit capacity review supersedes the design.
- Do not drop `market_ohlcv_history_lookup_idx` without the approved benchmark.
- Never put `VACUUM FULL` in a migration/workflow. It requires separate production authorization.
- `VACUUM FULL` gate: current DB `<=385000000` bytes AND estimated peak `<=470000000` bytes.
- QeoIndex inline-only policy applies: source changes via GitHub; runtime verification via GitHub Actions; no shell/remote execution unless explicitly authorized.
- Source-plan approval does not authorize bridge production promotion, merge/deploy, Stage-2 cutover, index drop, or `VACUUM FULL`.

---

## File Map

**Create**
- `tests/qeo-234-daily-provenance-cutover.cases.ts`
- `.github/workflows/qeo-234.yml`
- `supabase/migrations/20260915193000_qeo234_daily_provenance_bridge.sql`
- `supabase/migrations/20260915194500_qeo234_daily_provenance_cutover.sql`
- `modules/market/history/daily-provenance-canary.ts`
- `app/api/qeoindex/daily-provenance-canary/route.ts`
- `docs/db/runbooks/qeo234-daily-provenance-maintenance.md`

**Modify**
- `modules/market/history/daily-provenance.ts`
- `modules/market/history/ohlcv-store.ts`
- `modules/market/history/daily-integrity.ts`
- `modules/market/chart-data/service.ts`
- `modules/market/chart-data/maintenance.ts`
- `modules/market/history/daily-cold-history.ts`
- `modules/shared/supabase/database.types.ts` (generated candidate only)
- `supabase/migration-preproduction.json`

**Keep stable**
- Caller-facing `PersistedDailyOhlcvRow` still carries logical `provider_detail` / `source_url` so the helper can resolve exact registry identity.
- `qeo_market_ohlcv_recent` logical columns stay unchanged.
- `qeo_market_ohlcv_recent_grouped` stays width 10; its current QEO-233 implementation already reads `market_ohlcv_history_compat`, so QEO-234 does not need to redefine it unless verification proves otherwise.
- OHLCV-only direct reads may remain on `market_ohlcv_history`.

---

### Task 1: Add focused RED contracts and workflow

**Files:**
- Create: `tests/qeo-234-daily-provenance-cutover.cases.ts`
- Create: `.github/workflows/qeo-234.yml`

**Interfaces:**
- Consumes the QEO-232/QEO-233 contracts and approved QEO-234 spec.
- Produces a focused source/schema guard that fails before implementation exists.

- [ ] **Step 1: Add migration/source helpers and bridge/final-schema RED assertions.**

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

test("QEO-234 bridge is nullable-long-field and registry-canonical", () => {
  const sql = migration(bridgePattern)
  assert.match(sql, /alter\s+column\s+provider_detail\s+drop\s+not\s+null/i)
  assert.match(sql, /alter\s+column\s+source_url\s+drop\s+not\s+null/i)
  assert.match(sql, /qeo_market_ohlcv_provenance_consistency_guard/i)
  assert.match(sql, /new\.provider_detail\s+is\s+not\s+null/i)
  assert.match(sql, /new\.source_url\s+is\s+not\s+null/i)
  assert.match(sql, /market_ohlcv_history_compat/i)
  assert.match(sql, /registry\.provider_detail/i)
  assert.match(sql, /registry\.source_url/i)
})

test("QEO-234 bridge migrates live SQL provenance consumers", () => {
  const sql = migration(bridgePattern)
  for (const fn of [
    "qeo_market_ohlcv_recent",
    "qeo_market_daily_integrity_report",
    "qeo_market_daily_integrity_report_scoped",
  ]) assert.match(sql, new RegExp(fn, "i"))
  assert.match(sql, /from\s+public\.market_ohlcv_history_compat/i)
})

test("QEO-234 final cutover removes only the long inline fields", () => {
  const sql = migration(cutoverPattern)
  assert.match(sql, /alter\s+column\s+provenance_id\s+set\s+not\s+null/i)
  assert.match(sql, /drop\s+column\s+provider_detail/i)
  assert.match(sql, /drop\s+column\s+source_url/i)
  assert.doesNotMatch(sql, /drop\s+column\s+provider\b/i)
  assert.doesNotMatch(sql, /drop\s+column\s+fetched_at\b/i)
  assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.qeo_market_ohlcv_provenance_backfill_batch/i)
  assert.doesNotMatch(sql, /vacuum\s+full/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate(?:\s+table)?\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /chart_ohlcv_provenance_batches/i)
})
```

- [ ] **Step 2: Add RED runtime dependency/writer/canary/runbook assertions.**

```ts
test("QEO-234 writer persists compact facts only", () => {
  const helper = source("modules/market/history/daily-provenance.ts")
  assert.doesNotMatch(helper, /legacyUpsert|qeo233SchemaUnavailable/)
  assert.match(helper, /compactFacts|compactFact/)
  assert.match(helper, /provider_detail:\s*_providerDetail|provider_detail\s*:\s*_/)
  assert.match(helper, /source_url:\s*_sourceUrl|source_url\s*:\s*_/)
})

test("QEO-234 provenance-sensitive readers have no long-field fact fallback", () => {
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
    )
  }
})

test("QEO-234 canary is machine-only and cannot accept arbitrary fact payload", () => {
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

test("QEO-234 preserves the existing grouped width-10 ABI", () => {
  const qeo233 = source("supabase/migrations/20260915083500_qeo233_daily_ohlcv_provenance_compat.sql")
  assert.match(qeo233, /jsonb_build_array\([\s\S]*?h\.bar_time[\s\S]*?h\.fetched_at/)
  assert.match(source("modules/market/history/ohlcv-grouped.ts"), /COMPACT_DAILY_ROW_WIDTH\s*=\s*10/)
})

test("QEO-234 runbook contains capacity gates and exact rollback reconstruction", () => {
  const runbook = source("docs/db/runbooks/qeo234-daily-provenance-maintenance.md")
  assert.match(runbook, /385000000/)
  assert.match(runbook, /470000000/)
  assert.match(runbook, /ADD COLUMN provider_detail text/i)
  assert.match(runbook, /ADD COLUMN source_url text/i)
  assert.match(runbook, /market_ohlcv_provenance/i)
})
```

- [ ] **Step 3: Add `.github/workflows/qeo-234.yml`.**

Use Node 24 + pnpm 10.28.0 and run:

```bash
node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts tests/qeo-234-daily-provenance-cutover.cases.ts
```

Trigger on the QEO-234 spec/plan/runbook/test/migrations, the provenance helper/readers/canary route, `database.types.ts`, migration manifest, and the workflow itself.

- [ ] **Step 4: Push RED and capture GitHub Actions failure.**

Expected RED cause: missing QEO-234 migrations/canary/runbook or still-present legacy writer/reader behavior, not workflow syntax failure.

- [ ] **Step 5: Commit.**

```text
test(QEO-234): define compact Daily provenance cutover contract
```

---

### Task 2: Implement Stage-1 registry-canonical bridge migration

**Files:**
- Create: `supabase/migrations/20260915193000_qeo234_daily_provenance_bridge.sql`
- Test: `tests/qeo-234-daily-provenance-cutover.cases.ts`

**Interfaces:**
- Produces nullable legacy long fields, a trigger that accepts null long fields only when registry identity/provider is valid, registry-canonical compatibility reads, and registry-aware recent/integrity RPCs.

- [ ] **Step 1: Make only the two long fields nullable.**

```sql
begin;

alter table public.market_ohlcv_history
  alter column provider_detail drop not null,
  alter column source_url drop not null;
```

- [ ] **Step 2: Replace QEO-233 fact consistency guard so compact writes can succeed during bridge.**

This step is required before the app stops writing the long columns. Replace the function body with:

```sql
create or replace function public.qeo_market_ohlcv_provenance_consistency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registry_row public.market_ohlcv_provenance%rowtype;
begin
  if new.provenance_id is null then
    return new;
  end if;

  select * into registry_row
  from public.market_ohlcv_provenance
  where id = new.provenance_id;

  if not found then
    raise exception 'Daily OHLCV provenance_id % does not exist', new.provenance_id;
  end if;

  if new.provider is distinct from registry_row.provider
    or (new.provider_detail is not null and new.provider_detail is distinct from registry_row.provider_detail)
    or (new.source_url is not null and new.source_url is distinct from registry_row.source_url)
  then
    raise exception 'Daily OHLCV provenance mismatch for %.% at %', new.ticker, new.timeframe, new.bar_time;
  end if;

  return new;
end;
$$;
```

Keep the existing trigger event list during bridge (`provenance_id,provider,provider_detail,source_url`) so non-null legacy values are still validated exactly.

- [ ] **Step 3: Redefine `market_ohlcv_history_compat`.**

```sql
create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  history.ticker, history.timeframe, history.bar_time,
  history.open, history.high, history.low, history.close, history.volume,
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
left join public.market_ohlcv_provenance registry on registry.id = history.provenance_id;

revoke all privileges on table public.market_ohlcv_history_compat from public, anon, authenticated;
grant select on table public.market_ohlcv_history_compat to service_role;
```

A null `provenance_id` is now inconsistent; production QEO-233 acceptance already requires pending=0.

- [ ] **Step 4: Recreate `qeo_market_ohlcv_recent` over the compatibility view without changing return shape.**

Its lateral source must use:

```sql
from public.market_ohlcv_history_compat source
where source.ticker = q.ticker
  and source.timeframe = '1D'
  and source.provenance_consistent is true
order by source.bar_time desc
limit greatest(1, least(coalesce(p_limit, 260), 1700))
```

Keep logical columns/order `ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at` and current service-role execute grants.

- [ ] **Step 5: Recreate full/scoped Daily integrity RPCs over `market_ohlcv_history_compat`.**

Change their Daily source to compatibility rows with `provenance_consistent is true`. Preserve the exact authority predicate:

```sql
provider in ('VCI', 'DNSE')
or (
  provider = 'Fallback'
  and source_url = 'internal://stock_orderbook_snapshots'
  and provider_detail ilike 'Verified final market-close repair%'
)
```

Keep result columns/status semantics unchanged.

- [ ] **Step 6: Keep grouped RPC and historical backfill RPC unchanged during bridge.**

Grouped RPC already reads the compatibility view. The historical QEO-233 backfill RPC is retired only in Stage 2.

- [ ] **Step 7: Commit.**

```text
feat(QEO-234): add registry-canonical Daily provenance bridge
```

---

### Task 3: Cut application writes/reads to compact references and add controlled canary

**Files:**
- Modify: `modules/market/history/daily-provenance.ts`
- Modify: `modules/market/history/ohlcv-store.ts`
- Modify: `modules/market/history/daily-integrity.ts`
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/maintenance.ts`
- Modify: `modules/market/history/daily-cold-history.ts`
- Create: `modules/market/history/daily-provenance-canary.ts`
- Create: `app/api/qeoindex/daily-provenance-canary/route.ts`

**Interfaces:**
- `persistDailyOhlcvRows` still accepts full logical provenance, but fact upsert omits the two long fields.
- `runDailyProvenanceCanary(supabase,ticker)` accepts only a canonical symbol and uses an existing fact as its entire source payload.

- [ ] **Step 1: Remove writer schema fallback.**

Delete `qeo233SchemaUnavailable`, `legacyUpsert`, and the fallback branch. Registry errors now fail closed:

```ts
if (provenanceUpsert.error) {
  throw new Error(`Daily provenance resolve failed: ${provenanceUpsert.error.message}`)
}
```

- [ ] **Step 2: Map resolved rows to compact fact objects.**

```ts
const compactFacts = rows.map((row) => {
  const provenanceId = resolved.get(provenanceIdentityKey(row))
  if (!provenanceId) throw new Error(`Daily provenance id missing for ${row.ticker} at ${row.bar_time}`)
  const { provider_detail: _providerDetail, source_url: _sourceUrl, ...fact } = row
  return { ...fact, provenance_id: provenanceId }
})
```

Batch/upsert `compactFacts`; do not modify the caller-facing logical input type.

- [ ] **Step 3: Remove provenance-sensitive fact-table fallback reads.**

For each reader in the file map, remove only fallback branches that select `provider_detail`/`source_url` directly from `market_ohlcv_history`. Canonical pattern:

```ts
const { data, error } = await supabase
  .from("market_ohlcv_history_compat")
  .select("...")
if (error) throw new Error(`Daily provenance read failed: ${error.message}`)
assertDailyProvenanceConsistent((data || []) as Array<Record<string, unknown>>, "<context>")
```

Keep OHLCV-only direct fact reads.

- [ ] **Step 4: Implement bridge/final-schema canary helper.**

`modules/market/history/daily-provenance-canary.ts` exports:

```ts
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
): Promise<DailyProvenanceCanaryResult>
```

Algorithm:
1. Load latest `provenance_consistent=true` row from `market_ohlcv_history_compat`; keep exact OHLCV + logical provenance + `fetched_at`.
2. Attempt a PK-constrained direct update setting `provider_detail=null, source_url=null`. In bridge schema it must succeed. If and only if PostgREST reports those exact columns absent, mark final-schema mode and skip legacy nulling.
3. Call `persistDailyOhlcvRows` with the exact pre-canary logical row; no OHLCV/fetched_at change.
4. Read compact fact fields (`ticker,timeframe,bar_time,OHLCV,provider,fetched_at,provenance_id`) and logical compat fields.
5. Require exact fact/logical equality, positive provenance ID, `provenance_consistent=true`; in bridge mode require both legacy long columns remain null after compact upsert.
6. Return evidence. Never accept caller-provided OHLCV/provenance values.

Bridge nulling must match all PK fields:

```ts
.eq("ticker", row.ticker)
.eq("timeframe", "1D")
.eq("bar_time", row.bar_time)
```

- [ ] **Step 5: Add machine-only POST route using the proven QEO-231 auth pattern.**

Create `app/api/qeoindex/daily-provenance-canary/route.ts` importing:

```ts
import { NextRequest, NextResponse } from "next/server"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { runDailyProvenanceCanary } from "@/modules/market/history/daily-provenance-canary"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
```

Use `CRON_SECRET` machine auth, then bearer fallback through `qeo_verify_eod_scheduler_secret`. Accept only `ticker` query param matching `^[A-Z0-9]{2,12}$`; never call `request.json()`. Return 200 pass, 409 verified failure, 401 unauthorized, 400 invalid ticker, 503 missing service client, 500 unexpected error. Add `Cache-Control: private, no-store`.

- [ ] **Step 6: Run focused workflow in GitHub Actions and require GREEN.**

- [ ] **Step 7: Commit.**

```text
refactor(QEO-234): cut Daily provenance runtime to compact references
```

---

### Task 4: Add fail-closed Stage-2 cutover migration

**Files:**
- Create: `supabase/migrations/20260915194500_qeo234_daily_provenance_cutover.sql`

**Interfaces:**
- Consumes bridge schema + QEO-233 completed reference backfill.
- Produces final compact fact schema; no physical rewrite.

- [ ] **Step 1: Add pre-DDL assertions inside one transaction.**

```sql
begin;

do $$
declare
  v_pending bigint;
  v_orphan bigint;
  v_provider_mismatch bigint;
  v_legacy_mismatch bigint;
begin
  select count(*) into v_pending from public.market_ohlcv_history where provenance_id is null;

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

- [ ] **Step 2: Replace consistency trigger/function so they no longer reference soon-to-be-dropped columns.**

```sql
drop trigger if exists qeo_market_ohlcv_provenance_consistency_guard on public.market_ohlcv_history;

create or replace function public.qeo_market_ohlcv_provenance_consistency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare registry_provider text;
begin
  if new.provenance_id is null then
    raise exception 'Daily OHLCV provenance_id is required';
  end if;
  select provider into registry_provider from public.market_ohlcv_provenance where id = new.provenance_id;
  if not found then raise exception 'Daily OHLCV provenance_id % does not exist', new.provenance_id; end if;
  if new.provider is distinct from registry_provider then
    raise exception 'Daily OHLCV provenance provider mismatch for %.% at %', new.ticker, new.timeframe, new.bar_time;
  end if;
  return new;
end;
$$;

create trigger qeo_market_ohlcv_provenance_consistency_guard
before insert or update of provenance_id, provider
on public.market_ohlcv_history
for each row execute function public.qeo_market_ohlcv_provenance_consistency_guard();
```

Keep function privilege restrictions.

- [ ] **Step 3: Redefine compatibility view using registry-only long fields before column drop.**

```sql
create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  h.ticker, h.timeframe, h.bar_time,
  h.open, h.high, h.low, h.close, h.volume,
  h.provider, p.provider_detail, p.source_url,
  h.fetched_at, h.provenance_id,
  (p.id is not null and h.provider = p.provider) as provenance_consistent
from public.market_ohlcv_history h
left join public.market_ohlcv_provenance p on p.id = h.provenance_id;
```

- [ ] **Step 4: Retire backfill, enforce non-null reference, drop only long columns.**

```sql
drop function if exists public.qeo_market_ohlcv_provenance_backfill_batch(integer, bigint);

alter table public.market_ohlcv_history
  alter column provenance_id set not null;

alter table public.market_ohlcv_history
  drop column provider_detail,
  drop column source_url;
```

- [ ] **Step 5: Assert final schema before commit.**

A final `DO` block must raise unless `provider` and `fetched_at` exist/non-null, `provenance_id` exists/non-null, long columns are absent, and `market_ohlcv_history_provenance_id_fkey` is still restrictive. Then `commit;`.

No `VACUUM`, `VACUUM FULL`, DELETE/TRUNCATE, fact UPDATE, shadow copy, or index drop belongs here.

- [ ] **Step 6: Commit.**

```text
feat(QEO-234): add compact Daily provenance final cutover
```

---

### Task 5: Add deterministic maintenance + rollback runbook

**Files:**
- Create: `docs/db/runbooks/qeo234-daily-provenance-maintenance.md`

**Interfaces:**
- Produces exact production queries and hard stop gates; nothing in the runbook runs automatically.

- [ ] **Step 1: State authorization boundaries.**

Document separate approvals for bridge promotion, merge/deploy, Stage-2 writer pause/destructive DDL, and physical rewrite/index drop.

- [ ] **Step 2: Add exact baseline + digest query.**

Production has `pgcrypto` in schema `extensions`; use that schema explicitly:

```sql
with logical_rows as (
  select ticker,timeframe,bar_time,open,high,low,close,volume,
         provider,provider_detail,source_url,fetched_at
  from public.market_ohlcv_history_compat
  where provenance_consistent is true
), row_hashes as (
  select ticker,timeframe,bar_time,
    encode(extensions.digest(
      jsonb_build_array(
        ticker,
        timeframe,
        to_char(bar_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        open,high,low,close,volume,provider,provider_detail,source_url,
        to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'sha256'
    ), 'hex') as row_hash
  from logical_rows
)
select count(*)::bigint as row_count,
       encode(extensions.digest(string_agg(row_hash, '' order by ticker,timeframe,bar_time), 'sha256'), 'hex') as logical_sha256
from row_hashes;
```

Also capture:

```sql
select pg_database_size(current_database()) as database_bytes,
       pg_relation_size('public.market_ohlcv_history') as heap_bytes,
       pg_indexes_size('public.market_ohlcv_history') as index_bytes,
       pg_total_relation_size('public.market_ohlcv_history') as total_bytes;
```

- [ ] **Step 3: Add dependency-proof queries.**

Inventory current views/functions/triggers and stop if any live runtime definition still references the fact-table long columns. Exclude historical migration/spec text from this live DB check.

- [ ] **Step 4: Add writer pause/restore commands.**

```sql
revoke insert, update on table public.market_ohlcv_history from service_role;
```

Restore only after verification:

```sql
grant insert, update on table public.market_ohlcv_history to service_role;
```

- [ ] **Step 5: Add lookup-index baseline/transactional experiment.**

For at least VCB/FPT/HPG/SSI/VNM:

```sql
explain (analyze, buffers, format json)
select ticker,timeframe,bar_time,open,high,low,close,volume,provider,fetched_at,provenance_id
from public.market_ohlcv_history
where ticker='VCB' and timeframe='1D'
order by bar_time desc
limit 260;
```

Experiment:

```sql
begin;
drop index public.market_ohlcv_history_lookup_idx;
-- repeat the exact same representative EXPLAIN statements
rollback;
```

Permanent drop only if every query avoids sequential scan, execution time is `<=2x` baseline, and absolute execution time is `<20 ms`.

- [ ] **Step 6: Add physical capacity gate.**

```text
estimated_rewrite_temp_bytes = estimated_compact_live_tuple_bytes * 1.6 + remaining_index_bytes * 1.25
estimated_peak_database_bytes = current_database_bytes + estimated_rewrite_temp_bytes
```

Prohibit `VACUUM FULL` unless current DB `<=385000000` and estimated peak `<=470000000` bytes.

- [ ] **Step 7: Add separately authorized rewrite commands.**

```sql
set statement_timeout = '8min';
vacuum full public.market_ohlcv_history;
analyze public.market_ohlcv_history;
```

Document that `VACUUM FULL` must be issued as a standalone non-transactional maintenance statement if the SQL interface wraps multi-statement requests.

- [ ] **Step 8: Add lossless rollback reconstruction.**

With writers paused:

```sql
alter table public.market_ohlcv_history
  add column provider_detail text,
  add column source_url text;

update public.market_ohlcv_history h
set provider_detail = p.provider_detail,
    source_url = p.source_url
from public.market_ohlcv_provenance p
where p.id = h.provenance_id;

select count(*) as unresolved
from public.market_ohlcv_history
where provider_detail is null or source_url is null;

alter table public.market_ohlcv_history
  alter column provider_detail set not null,
  alter column source_url set not null;
```

Then restore reviewed QEO-233-compatible view/trigger/RPC definitions from repository migration source, verify the same logical digest + width-10 ABI, deploy a legacy-compatible build only after verification, then restore writer permissions.

- [ ] **Step 9: Commit.**

```text
docs(QEO-234): add Daily provenance maintenance runbook
```

---

### Task 6: Register migrations and regenerate final schema types via DB Drift

**Files:**
- Modify: `supabase/migration-preproduction.json`
- Modify only from CI-generated candidate: `modules/shared/supabase/database.types.ts`

- [ ] **Step 1: Add repo-ahead manifest entries.**

```json
{
  "logicalName": "qeo234_daily_provenance_bridge",
  "repositoryVersion": "20260915193000",
  "productionVersion": null,
  "state": "REPO_AHEAD",
  "evidence": "QEO-234 approved two-stage compact Daily provenance design and focused RED/GREEN contracts; production bridge promotion remains separately authorized",
  "rationale": "Makes legacy provider_detail/source_url nullable, permits compact writes only when exact registry identity/provider remains valid, moves live provenance consumers to registry-backed logical reads, and performs no destructive column drop or physical reclaim."
},
{
  "logicalName": "qeo234_daily_provenance_cutover",
  "repositoryVersion": "20260915194500",
  "productionVersion": null,
  "state": "REPO_AHEAD",
  "evidence": "QEO-234 reviewed fail-closed compact cutover contract; production Stage-2 promotion requires bridge canary and new maintenance authorization",
  "rationale": "After fail-closed provenance assertions, enforces provenance_id NOT NULL, removes only provider_detail/source_url, retires the obsolete QEO-233 historical backfill RPC, and preserves registry-backed logical APIs. Physical rewrite remains outside migration."
}
```

- [ ] **Step 2: Let PR-triggered DB Drift replay zero-to-latest and generate candidate types.**

Do not run Supabase CLI locally. Final generated facts must show: fact row has no long columns; fact `provenance_id` is non-null; compat view still exposes logical long fields; recent RPC still exposes logical long fields; backfill RPC is absent.

- [ ] **Step 3: Commit the exact CI-generated `database.types.ts`; do not hand-edit.**

```text
chore(QEO-234): refresh compact Daily provenance schema types
```

- [ ] **Step 4: Require DB Drift GREEN on exact final head.**

---

### Task 7: Exact-head verification and Stage-1 rollout gate

**Files:** Review all QEO-234 changes. No production mutation without explicit authorization.

- [ ] **Step 1: Require focused QEO-234 GREEN on exact head.**
- [ ] **Step 2: Require standard Verify GREEN on the same exact head, including TypeScript and production build.**
- [ ] **Step 3: Require DB Drift GREEN on the same exact head, including zero-to-latest migration replay and generated-type verification.**
- [ ] **Step 4: Diff-review and reject accidental provider/fetched_at drop, Daily DELETE/TRUNCATE/OHLCV rewrite, shadow copy, intraday provenance reuse, automatic vacuum/index drop, or automatic canary invocation.**
- [ ] **Step 5: Stop for explicit Stage-1 production authorization.**

Because `main` may auto-deploy immediately after merge, safe order is:

```text
exact-head PR green
→ explicit bridge-production authorization
→ apply ONLY bridge migration while old QEO-233 app is still deployed
→ verify old app compatibility
→ reconcile bridge mapping/evidence as required
→ explicit merge approval
→ merge / verify production deployment exact SHA
→ run production compact-writer canary
```

Do not merge compact-writer code before bridge schema exists unless deployment is explicitly held.

---

### Task 8: Production Stage-1 bridge acceptance

**Authorization:** Requires explicit bridge-production authorization; source-plan approval is insufficient.

- [ ] **Step 1:** Re-measure DB bytes, history heap/index/total, row count, pending, mismatch/orphan, registry count, and logical digest. Stop if any provenance gate fails.
- [ ] **Step 2:** Apply only `qeo234_daily_provenance_bridge`; do not apply final cutover.
- [ ] **Step 3:** Read back nullable long columns, bridge guard definition, compat view, recent/integrity RPCs, grouped width 10.
- [ ] **Step 4:** Merge/deploy exact-head app only with explicit merge/deploy approval; verify production deployment SHA.
- [ ] **Step 5:** Run machine canary for `VCB,FPT,HPG,SSI,VNM`; require HTTP 200, positive provenance ID, `bridgeLegacyColumnsPresent=true`, `bridgeLegacyColumnsNull=true`, logical provenance preserved.
- [ ] **Step 6:** Recheck zero mismatch/orphan/compat inconsistencies and representative grouped/recent/integrity/chart Daily reads.
- [ ] **Step 7:** Record evidence in QEO-234 and stop for new Stage-2 maintenance authorization.

---

### Task 9: Separately authorized Stage-2 cutover + physical reclaim

**Authorization:** Requires explicit user approval immediately before writer pause/destructive DDL.

- [ ] **Step 1:** Execute runbook preflight: bridge accepted; pending/mismatch/orphan zero; dependency audit clean; row count + logical SHA-256 + DB/relation/index bytes + query baselines captured.
- [ ] **Step 2:** Revoke service-role INSERT/UPDATE and prove writes fail while reads remain available.
- [ ] **Step 3:** Apply only final QEO-234 cutover migration. On failure, verify bridge schema and keep writers paused until understood.
- [ ] **Step 4:** Before physical rewrite require unchanged row count/digest, absent long fact columns, non-null reference, provider/registry equality, grouped width 10, recent/integrity/chart/Wyckoff reads healthy.
- [ ] **Step 5:** Benchmark lookup-index drop transactionally. Permanent drop only if every threshold passes; otherwise retain index.
- [ ] **Step 6:** Regular `VACUUM (ANALYZE)`, remeasure sizes, calculate capacity formula. If either gate fails, skip/defer `VACUUM FULL`.
- [ ] **Step 7:** If both gates pass, run standalone `VACUUM FULL` with ~8-minute timeout. Never auto-retry timeout/disk/lock failure.
- [ ] **Step 8:** Repeat digest/row count/RPC/read verification and measure actual physical delta.
- [ ] **Step 9:** Restore service-role INSERT/UPDATE only after applicable checks pass.
- [ ] **Step 10:** Run canary again; final-schema mode must report `bridgeLegacyColumnsPresent=false` with exact logical provenance preserved.
- [ ] **Step 11:** Close QEO-234 only when accepted measured physical outcome (or explicitly accepted capacity defer) is recorded.

---

### Task 10: Reconcile production migration ledger after actual promotions

**Files:**
- Modify: `supabase/migration-preproduction.json`
- Create/update reviewed `docs/db/evidence/production-migration-ledger-YYYY-MM-DD.json`

- [ ] **Step 1:** Read live Supabase migration versions; never infer assigned production versions.
- [ ] **Step 2:** Map bridge and cutover independently from `REPO_AHEAD` to `MAPPED` only after each actual promotion.
- [ ] **Step 3:** Carry forward prior reviewed ledger subset and add only verified QEO-234 production rows.
- [ ] **Step 4:** Open ledger-only PR and require Verify + DB Drift GREEN on exact head.
- [ ] **Step 5:** Merge reconciliation only with user approval.

---

## Self-Review Results

- **Spec coverage:** bridge trigger nullability, registry-canonical SQL/application reads, compact writer, machine canary, destructive cutover, backfill retirement, digest, rollback, index benchmark, capacity gate, physical reclaim, authorization boundaries, and migration-ledger reconciliation all map to explicit tasks.
- **Critical correction found during review:** compact bridge writes would fail under the QEO-233 trigger if the trigger still required non-null long fields. Task 2 now explicitly replaces the bridge consistency guard so null long fields are allowed only when `provenance_id` exists and provider matches, while any non-null legacy long value must still exactly match the registry.
- **False contract avoided:** QEO-234 does not unnecessarily recreate `qeo_market_ohlcv_recent_grouped`; the contract verifies the existing QEO-233 width-10 implementation plus decoder instead.
- **Digest dependency verified:** production has `pgcrypto` installed in schema `extensions`; the runbook uses `extensions.digest` explicitly.
- **Placeholder scan:** no TBD/TODO/“implement later” steps remain.
- **Type/interface consistency:** caller logical provenance remains unchanged; only persisted fact shape changes; canary operates in both bridge and final schema modes.

## Completion Gates

Source implementation is complete only when focused QEO-234, standard Verify, and DB Drift are GREEN on the same exact head and generated types match final schema. Production completion remains a separate, explicitly authorized bridge → canary → maintenance → measured-reclaim sequence.
