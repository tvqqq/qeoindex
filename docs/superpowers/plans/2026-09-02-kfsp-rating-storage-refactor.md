# KFSP Rating Storage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contract `insights_stock_ratings` to canonical KFSP fields, move raw provider payload into bounded private evidence storage, and reclaim obsolete physical/index footprint without changing canonical Top-200 membership semantics.

**Architecture:** `market_universe_memberships` stays unchanged as versioned selection evidence. The application is made compatible with the contracted rating schema and deployed first; only after Vercel production is READY is the destructive Supabase migration applied. The publisher then persists 30-day raw evidence transactionally and publishes only canonical KFSP rating fields.

**Tech Stack:** Next.js 16.3, TypeScript 5.7, Supabase/PostgreSQL, Supabase Edge Functions, Node test runner, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-02-kfsp-rating-storage-refactor-design.md`

## Global Constraints

- Keep `market_universe_memberships` schema and canonical Top-200 semantics unchanged.
- Deploy new application readers before dropping any rating columns.
- Drop only these hot-row columns: `composite_score`, `score_4m`, `canslim_score`, `stock_rs_score`, `sector_rs_score`, `stock_rrg_state`, `sector_rrg_state`, `industry_group`, `raw_payload`.
- Preserve `kfsp_metrics` in `insights_stock_ratings`.
- Retain raw provider evidence for exactly 30 days in private `kfsp_rating_raw_evidence`.
- Do not add object-storage/archive dependencies in QEO-27.
- Preserve Rating/TTAI cron cadence at 07:00/07:10 ICT and do not add temporary cron jobs.
- Do not drop an index solely because of short-window low scan counts.
- Do not use `VACUUM FULL` unless a later measured requirement is explicitly approved.
- Production acceptance requires exactly 200 canonical published rating tickers and 0 noncanonical tickers.

---

### Task 1: Add RED schema/runtime regression contract

**Files:**
- Create: `tests/kfsp-rating-storage-refactor.test.ts`
- Modify: `.github/workflows/security.yml`

**Interfaces:**
- Consumes: current `lib/insights-data.ts`, the planned migration path, and current CI Verify workflow.
- Produces: a focused regression suite named `tests/kfsp-rating-storage-refactor.test.ts` that gates runtime compatibility and the migration contract.

- [ ] **Step 1: Write the failing regression test**

Create `tests/kfsp-rating-storage-refactor.test.ts` using `node:test`, `node:assert/strict`, and `node:fs`.

The test must read:

```ts
const insightsSource = readFileSync("lib/insights-data.ts", "utf8")
const migrationPath = "supabase/migrations/20260902090000_kfsp_rating_storage_refactor.sql"
```

Add these assertions:

```ts
test("Insights runtime no longer reads duplicate industry_group", () => {
  assert.doesNotMatch(insightsSource, /industry_group/)
})

test("rating contraction migration creates bounded private raw evidence", () => {
  const sql = readFileSync(migrationPath, "utf8")
  assert.match(sql, /create table public\.kfsp_rating_raw_evidence/i)
  assert.match(sql, /primary key\s*\(sync_run_id,\s*ticker\)/i)
  assert.match(sql, /raw_payload\s+jsonb\s+not null/i)
  assert.match(sql, /interval\s+'30 days'/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on public\.kfsp_rating_raw_evidence from anon, authenticated/i)
})

test("publisher persists raw evidence but published ratings are canonical-only", () => {
  const sql = readFileSync(migrationPath, "utf8")
  assert.match(sql, /insert into public\.kfsp_rating_raw_evidence/i)
  assert.match(sql, /from public\.kfsp_rating_staging/i)
  assert.match(sql, /insert into public\.insights_stock_ratings/i)
  assert.doesNotMatch(sql.match(/insert into public\.insights_stock_ratings[\s\S]*?from public\.kfsp_rating_staging/i)?.[0] ?? "", /\braw_payload\b/i)
})

test("migration removes duplicate rating aliases and uses KFSP score indexes", () => {
  const sql = readFileSync(migrationPath, "utf8")
  for (const column of [
    "composite_score",
    "score_4m",
    "canslim_score",
    "stock_rs_score",
    "sector_rs_score",
    "stock_rrg_state",
    "sector_rrg_state",
    "industry_group",
    "raw_payload",
  ]) {
    assert.match(sql, new RegExp(`drop column if exists ${column}`, "i"))
  }
  assert.match(sql, /insights_stock_ratings_date_score_idx[\s\S]*kfsp_composite_score/i)
  assert.match(sql, /insights_stock_ratings_published_date_score_idx[\s\S]*kfsp_composite_score/i)
})
```

Also scan active runtime files only, not historical migrations, to ensure generic aliases are not reintroduced as rating reads:

```ts
const runtimeRatingReaders = [
  "lib/insights-data.ts",
  "lib/ai-council-data.ts",
  "lib/ai-council-llm-evidence.ts",
  "lib/qeoindex-eod-archive-legacy.ts",
]

for (const file of runtimeRatingReaders) {
  const source = readFileSync(file, "utf8")
  for (const alias of [
    "composite_score",
    "score_4m",
    "canslim_score",
    "stock_rs_score",
    "sector_rs_score",
    "stock_rrg_state",
    "sector_rrg_state",
  ]) {
    const genericOnly = new RegExp(`(?<!kfsp_)\\b${alias}\\b`)
    assert.doesNotMatch(source, genericOnly, `${file} must use KFSP canonical ${alias}`)
  }
}
```

- [ ] **Step 2: Add the focused suite to Verify**

In `.github/workflows/security.yml`, after `KFSP canonical universe regression`, add:

```yaml
      - name: KFSP rating storage refactor regression
        run: node --test tests/kfsp-rating-storage-refactor.test.ts
```

Keep the existing QEO-14 lifecycle and canonical-200 UI steps unchanged.

- [ ] **Step 3: Run RED test and prove the failure is expected**

Run:

```bash
node --test tests/kfsp-rating-storage-refactor.test.ts
```

Expected failures:
- `industry_group` is still present in `lib/insights-data.ts`;
- migration file `20260902090000_kfsp_rating_storage_refactor.sql` does not yet exist.

Do not proceed if the test fails for unrelated syntax/import reasons.

- [ ] **Step 4: Commit the RED contract**

```bash
git add tests/kfsp-rating-storage-refactor.test.ts .github/workflows/security.yml
git commit -m "test: define KFSP rating storage contraction"
```

---

### Task 2: Make application readers compatible with contracted schema

**Files:**
- Modify: `lib/insights-data.ts`
- Test: `tests/kfsp-rating-storage-refactor.test.ts`

**Interfaces:**
- Consumes: existing `InsightsRatingRow.industryGroup` UI-facing property.
- Produces: identical UI-facing shape, but derives `industryGroup` from `sector` and no longer selects `industry_group` from the database.

- [ ] **Step 1: Remove the database-only `industry_group` dependency**

In `RatingDatabaseRow`, delete:

```ts
industry_group: string | null
```

Change the main ratings selection from:

```ts
"ticker,company_name,sector,industry_group,exchange,..."
```

to:

```ts
"ticker,company_name,sector,exchange,price,price_change_pct,average_volume_50_sessions,market_cap_billion,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,kfsp_stock_rrg_state,kfsp_sector_rrg_state,rs_short,rs_medium,rsi_14,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics,as_of_date,source"
```

Change UI mapping from:

```ts
industryGroup: row.industry_group || row.sector || "Chưa phân ngành",
```

to:

```ts
industryGroup: row.sector || "Chưa phân ngành",
```

Do not rename the UI property in QEO-27; this avoids unrelated component churn.

- [ ] **Step 2: Run focused GREEN test**

```bash
node --test tests/kfsp-rating-storage-refactor.test.ts
```

Expected: the runtime compatibility assertion passes; migration assertions remain RED because Task 3 is not implemented yet.

- [ ] **Step 3: Run rating/Insights regressions**

```bash
node --test tests/insights-schema.test.ts tests/insights-rating-model.test.ts tests/insights-metric-semantics.test.ts tests/ai-council-prompt-evidence.test.ts tests/kfsp-canonical-universe-sync.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit reader compatibility**

```bash
git add lib/insights-data.ts
git commit -m "refactor: use sector as canonical rating taxonomy"
```

---

### Task 3: Add canonical rating contraction migration

**Files:**
- Create: `supabase/migrations/20260902090000_kfsp_rating_storage_refactor.sql`
- Test: `tests/kfsp-rating-storage-refactor.test.ts`

**Interfaces:**
- Consumes: `public.kfsp_rating_staging`, `public.kfsp_rating_sync_runs`, existing `publish_kfsp_rating_snapshot(uuid, integer)` contract.
- Produces: private `public.kfsp_rating_raw_evidence` and a rewritten `publish_kfsp_rating_snapshot(...)` with the same signature/return value.

- [ ] **Step 1: Create private raw evidence table and retention index**

Start the migration with:

```sql
create table if not exists public.kfsp_rating_raw_evidence (
  sync_run_id uuid not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  fetched_at timestamptz not null,
  expires_at timestamptz not null check (expires_at >= fetched_at),
  created_at timestamptz not null default now(),
  primary key (sync_run_id, ticker)
);

create index if not exists kfsp_rating_raw_evidence_expires_idx
  on public.kfsp_rating_raw_evidence(expires_at);

alter table public.kfsp_rating_raw_evidence enable row level security;
revoke all on public.kfsp_rating_raw_evidence from public, anon, authenticated;
grant select, insert, update, delete on public.kfsp_rating_raw_evidence to service_role;
```

Do not add a foreign key to `kfsp_rating_sync_runs`; raw evidence must not be shortened by a future telemetry TTL/cascade.

- [ ] **Step 2: Backfill current published raw evidence before dropping `raw_payload`**

Use the current published rows whose `sync_run_id` is known:

```sql
insert into public.kfsp_rating_raw_evidence (
  sync_run_id, ticker, as_of_date, raw_payload, fetched_at, expires_at
)
select
  sync_run_id,
  ticker,
  as_of_date,
  raw_payload,
  fetched_at,
  fetched_at + interval '30 days'
from public.insights_stock_ratings
where source = 'kfsp'
  and is_published
  and sync_run_id is not null
  and raw_payload <> '{}'::jsonb
on conflict (sync_run_id, ticker) do update
set raw_payload = excluded.raw_payload,
    as_of_date = excluded.as_of_date,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
```

- [ ] **Step 3: Rewrite `publish_kfsp_rating_snapshot` transactionally**

Preserve the function signature:

```sql
public.publish_kfsp_rating_snapshot(p_sync_run_id uuid, p_minimum_rows integer default 50)
returns integer
```

Preserve current run validation, row-count validation, score validation, sync-run completion, staging cleanup, and return semantics.

Before replacing published ratings, persist staging raw evidence:

```sql
insert into public.kfsp_rating_raw_evidence (
  sync_run_id, ticker, as_of_date, raw_payload, fetched_at, expires_at
)
select
  sync_run_id,
  ticker,
  as_of_date,
  raw_payload,
  fetched_at,
  fetched_at + interval '30 days'
from public.kfsp_rating_staging
where sync_run_id = p_sync_run_id
on conflict (sync_run_id, ticker) do update
set raw_payload = excluded.raw_payload,
    as_of_date = excluded.as_of_date,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
```

The `insert into public.insights_stock_ratings (...)` column list must contain only canonical columns:

```sql
as_of_date, ticker, company_name, sector, exchange,
price, price_change_pct,
average_volume_50_sessions, market_cap_billion,
kfsp_composite_score, kfsp_score_4m, kfsp_canslim_score, kfsp_price_potential,
kfsp_stock_rs_score, kfsp_sector_rs_score, kfsp_stock_rrg_state, kfsp_sector_rrg_state,
rs_short, rs_medium, rsi_14, weekly_change_pct, monthly_change_pct, beta, pe_ttm, pb_ttm,
kfsp_metrics, kfsp_contract_version, sync_run_id,
source, source_url, fetched_at, is_published
```

Do not include `industry_group`, generic score/RRG aliases, or `raw_payload`.

Before returning, prune expired evidence:

```sql
delete from public.kfsp_rating_raw_evidence
where expires_at < now();
```

Keep pruning inside the successful publisher transaction so the run does not claim completion when retention maintenance fails.

- [ ] **Step 4: Replace score indexes with canonical columns**

Before dropping `composite_score`:

```sql
drop index if exists public.insights_stock_ratings_date_score_idx;
drop index if exists public.insights_stock_ratings_published_date_score_idx;

create index insights_stock_ratings_date_score_idx
  on public.insights_stock_ratings(as_of_date desc, kfsp_composite_score desc, ticker);

create index insights_stock_ratings_published_date_score_idx
  on public.insights_stock_ratings(as_of_date desc, kfsp_composite_score desc, ticker)
  where is_published;
```

Keep the unique natural-key, ticker/date, PK, and published sector/KFSP-score indexes unchanged.

- [ ] **Step 5: Drop obsolete hot-row columns**

After publisher/index replacement:

```sql
alter table public.insights_stock_ratings
  drop column if exists composite_score,
  drop column if exists score_4m,
  drop column if exists canslim_score,
  drop column if exists stock_rs_score,
  drop column if exists sector_rs_score,
  drop column if exists stock_rrg_state,
  drop column if exists sector_rrg_state,
  drop column if exists industry_group,
  drop column if exists raw_payload;
```

Do not drop any canonical `kfsp_*` field or `kfsp_metrics`.

- [ ] **Step 6: Reassert the authenticated read contract**

Revoke broad table access and grant only current published read columns to `authenticated`, matching the existing principle of column-scoped access:

```sql
revoke all on public.insights_stock_ratings from anon;
revoke all on public.insights_stock_ratings from authenticated;

grant select (
  as_of_date, ticker, company_name, sector, exchange,
  price, price_change_pct, average_volume_50_sessions, market_cap_billion,
  kfsp_composite_score, kfsp_score_4m, kfsp_canslim_score, kfsp_price_potential,
  kfsp_stock_rs_score, kfsp_sector_rs_score, kfsp_stock_rrg_state, kfsp_sector_rrg_state,
  rs_short, rs_medium, rsi_14, weekly_change_pct, monthly_change_pct,
  beta, pe_ttm, pb_ttm, kfsp_metrics, kfsp_contract_version,
  fetched_at, is_published, source
) on public.insights_stock_ratings to authenticated;
```

Do not expose `sync_run_id`, `source_url`, internal IDs, or raw evidence to authenticated clients unless they were already intentionally public; QEO-27 keeps them server/service-role only.

- [ ] **Step 7: Run focused GREEN tests**

```bash
node --test tests/kfsp-rating-storage-refactor.test.ts tests/kfsp-canonical-universe-sync.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit migration**

```bash
git add supabase/migrations/20260902090000_kfsp_rating_storage_refactor.sql tests/kfsp-rating-storage-refactor.test.ts
git commit -m "refactor: contract KFSP rating storage"
```

---

### Task 4: Verify branch and prepare application-first production rollout

**Files:**
- Modify only if required by test failures: `.github/workflows/security.yml`, `lib/insights-data.ts`, migration/test files from Tasks 1–3.

**Interfaces:**
- Consumes: completed branch implementation.
- Produces: a green PR whose app code is safe against both old and contracted DB schemas.

- [ ] **Step 1: Run full local verification**

```bash
pnpm test:core
node --test tests/kfsp-canonical-universe-sync.test.ts
node --test tests/kfsp-manual-recovery-lifecycle.test.ts
node --test tests/kfsp-rating-storage-refactor.test.ts
node --test tests/canonical-200-ui.test.ts
pnpm lint:touched
pnpm typecheck
pnpm build
```

Expected: all commands PASS; lint may contain existing warnings but 0 errors.

- [ ] **Step 2: Open PR against `main`**

PR title:

```text
refactor: contract KFSP rating storage
```

PR body must explicitly state:
- DB migration is committed but **must not be applied before app production is READY**;
- no Edge function deployment is required because staging payload shape remains compatible;
- canonical universe table is untouched;
- raw evidence is 30-day private storage.

- [ ] **Step 3: Require GitHub Verify success on exact head SHA**

Verify these steps are green:
- core regression suite;
- KFSP canonical universe regression;
- KFSP rating storage refactor regression;
- KFSP manual recovery lifecycle regression;
- canonical-200 UI regression;
- lint;
- TypeScript;
- production build.

- [ ] **Step 4: Squash-merge only the verified head**

Use the PR head SHA as the expected-head guard. Record the resulting merge SHA.

- [ ] **Step 5: Wait for Vercel production deployment of the merge SHA**

Require:
- target `production`;
- Vercel Git metadata commit SHA equals the merge SHA;
- state/readyState `READY`;
- `qeoindex.qeoqeo.com` attached;
- `aliasError = null`;
- production `/insights` and `/admin/jobs` return HTTP 200/auth shell as appropriate.

**Stop here if Vercel is not READY. Do not apply the destructive DB migration.**

---

### Task 5: Apply DB contraction and run production data acceptance

**Files:**
- Production migration source: `supabase/migrations/20260902090000_kfsp_rating_storage_refactor.sql`

**Interfaces:**
- Consumes: Vercel production already running reader-compatible merge SHA.
- Produces: contracted production schema and transactional raw evidence publisher.

- [ ] **Step 1: Capture pre-migration baseline**

Read-only SQL must record:

```sql
select
  pg_relation_size('public.insights_stock_ratings') as heap_bytes,
  pg_indexes_size('public.insights_stock_ratings') as index_bytes,
  pg_total_relation_size('public.insights_stock_ratings') as total_bytes;

select count(*) as rows, count(distinct ticker) as tickers
from public.insights_stock_ratings
where source='kfsp' and is_published;

select count(*) as membership_rows, count(distinct ticker) as membership_tickers
from public.market_universe_memberships
where run_id = (
  select id from public.market_universe_runs
  where universe_key='vn_top_stocks' and status='published'
  order by created_at desc limit 1
);
```

Record the values in QEO-27 before DDL.

- [ ] **Step 2: Apply the ordered migration with Supabase migration tooling**

Apply exactly `20260902090000_kfsp_rating_storage_refactor.sql`. Do not use ad-hoc raw DDL outside migration tooling.

- [ ] **Step 3: Verify contracted schema immediately**

Require the dropped-column count to be zero:

```sql
select count(*)
from information_schema.columns
where table_schema='public'
  and table_name='insights_stock_ratings'
  and column_name in (
    'composite_score','score_4m','canslim_score','stock_rs_score','sector_rs_score',
    'stock_rrg_state','sector_rrg_state','industry_group','raw_payload'
  );
```

Expected: `0`.

Require evidence table and current backfill:

```sql
select count(*) as evidence_rows,
       count(distinct ticker) as evidence_tickers,
       min(expires_at - fetched_at) as min_retention,
       max(expires_at - fetched_at) as max_retention
from public.kfsp_rating_raw_evidence;
```

Expected current snapshot: 200 tickers where existing `sync_run_id/raw_payload` coverage is complete; retention interval is exactly 30 days.

- [ ] **Step 4: Run one Rating recovery smoke through QEO-14 dispatcher**

Use a new UUID `request_id`, job key `kfsp.rating_daily`, and a reason identifying QEO-27 production acceptance. Do not create a cron.

Require QEO-14 telemetry to reach actual provider terminal `succeeded`.

- [ ] **Step 5: Verify canonical 200 after provider publish**

Require:

```text
rating rows = 200
rating distinct tickers = 200
latest canonical universe tickers = 200
rating ∩ universe = 200
rating-only tickers = 0
universe-only tickers = 0
```

Require the smoke `sync_run_id` to have exactly 200 `kfsp_rating_raw_evidence` rows with `expires_at - fetched_at = interval '30 days'`.

- [ ] **Step 6: Verify scheduler invariants**

Require:
- Rating cron still 07:00 ICT;
- TTAI cron still 07:10 ICT;
- no temporary/manual/rebuild cron exists.

---

### Task 6: Reclaim physical index footprint and close QEO-27

**Files:**
- No source changes unless measured evidence requires a follow-up migration.
- Linear: QEO-27 acceptance comment/status.

**Interfaces:**
- Consumes: contracted production schema with successful Rating smoke.
- Produces: measured post-refactor storage and completed Linear audit trail.

- [ ] **Step 1: Measure post-migration physical size before maintenance**

Run the same heap/index/total-size query from Task 5 and record values.

- [ ] **Step 2: Identify residual index bloat**

Read index sizes and usage:

```sql
select
  indexrelname,
  pg_relation_size(indexrelid) as bytes,
  idx_scan
from pg_stat_user_indexes
where schemaname='public'
  and relname='insights_stock_ratings'
order by bytes desc;
```

The two score indexes recreated by the migration should already be compact. If the remaining old PK/natural-key/ticker-date/sector indexes still account for more than 1 MB total with only 200 live rows, schedule one production-safe reindex maintenance operation after the provider smoke.

- [ ] **Step 3: Reindex only residual bloated indexes through migration tooling**

If Step 2 threshold is met, create/apply a separate maintenance migration that reindexes these existing indexes one by one:

```sql
reindex index public.insights_stock_ratings_pkey;
reindex index public.insights_stock_ratings_as_of_date_ticker_source_key;
reindex index public.insights_stock_ratings_ticker_date_idx;
reindex index public.insights_stock_ratings_published_sector_score_idx;
```

Do not recreate/drop the low-scan `insights_stock_ratings_date_score_idx`; it remains part of the current query contract until a separate EXPLAIN-based issue proves removal is safe.

Do not run `VACUUM FULL`.

- [ ] **Step 4: Measure final storage**

Record:
- heap bytes;
- TOAST bytes;
- index bytes;
- total bytes;
- 200/200 rating integrity;
- 200/200 universe integrity.

Compare against the pre-refactor baseline captured in Task 5.

- [ ] **Step 5: Update documentation and Linear acceptance evidence**

Update QEO-27 with:
- PR and merge SHA;
- Verify run ID/head SHA;
- Vercel deployment ID and READY evidence;
- migration success;
- Rating smoke request/sync run IDs;
- 200/200 canonical integrity;
- raw evidence row/retention proof;
- cron invariant proof;
- storage before/after;
- whether residual reindex maintenance ran.

Move QEO-27 to `Done` only after every production acceptance item above passes.
