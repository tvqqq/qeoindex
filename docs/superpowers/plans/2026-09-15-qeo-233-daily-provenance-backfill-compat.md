# QEO-233 Daily OHLCV Provenance Backfill + Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Daily provenance registry/reference schema, migrate all known Daily writers and provenance-sensitive readers through a compatibility window, and provide a bounded capacity-gated backfill path without changing OHLCV facts or dropping legacy provenance columns.

**Architecture:** Add an additive Daily-only provenance registry plus nullable `market_ohlcv_history.provenance_id`, a restrictive consistency guard, and a compatibility view that exposes the legacy logical provenance shape while reporting row/registry consistency. Writers resolve exact version-1 provenance tuples through one shared helper and continue writing all legacy provenance fields. Backfill is an explicit bounded RPC that seeds exact registry identities and fills only `provenance_id`; it is never executed automatically by the migration. Production execution is deferred until QEO-228/QEO-230 acceptance provides measured headroom.

**Tech Stack:** TypeScript, Supabase/PostgreSQL migrations, `@supabase/supabase-js`, Node.js 24 test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-qeo-232-daily-ohlcv-provenance-design.md`

## Global Constraints

- `market_ohlcv_history` remains the canonical completed-Daily fact store keyed by `(ticker,timeframe,bar_time)`.
- Version-1 identity is exact byte-for-byte `(provider, provider_detail, source_url)`; no trimming, URL normalization, case folding, or parsing.
- Keep `provider`, `provider_detail`, `source_url`, and `fetched_at` inline throughout QEO-233.
- `provenance_id` remains nullable throughout QEO-233.
- Foreign-key delete behavior is `ON DELETE RESTRICT`; no cascading fact deletion.
- Do not reuse `chart_ohlcv_provenance_batches` or other intraday provenance contracts.
- Preserve grouped RPC width/order exactly: `[bar_time, open, high, low, close, volume, provider, provider_detail, source_url, fetched_at]`.
- Backfill updates only `provenance_id`; it must not update OHLCV or legacy provenance values.
- No `VACUUM FULL`, table copy/swap, legacy-column drop, historical-Daily prune, or other physical reclamation belongs to QEO-233.
- Production backfill is not executed until QEO-228/QEO-230 acceptance and measured database headroom are reviewed.
- Under QeoIndex inline-only policy, verification is performed through GitHub Actions, not local shell execution.

---

### Task 1: Add failing QEO-233 runtime/schema contract tests

**Files:**
- Create: `tests/qeo-233-daily-provenance-runtime.cases.ts`
- Create: `.github/workflows/qeo-233.yml`

**Interfaces:**
- Reuses `assertQeo232DailyProvenanceSchema(sql)` from `tests/helpers/qeo-232-daily-provenance-schema-contract.ts`.
- Future migration files must match `*_qeo233_daily_ohlcv_provenance*.sql`, so the QEO-232 guard automatically validates their combined source.

- [ ] **Step 1: Write RED tests that require the additive schema, compatibility model, consistency guard, bounded backfill RPC, and shared writer helper.**

The test must assert all of the following:

```text
migration source contains:
- public.market_ohlcv_provenance
- nullable public.market_ohlcv_history.provenance_id
- ON DELETE RESTRICT FK
- public.market_ohlcv_history_compat
- provenance_consistent boolean derived from exact tuple equality
- qeo_market_ohlcv_provenance_backfill_batch(...)
- bounded candidate LIMIT
- UPDATE changes provenance_id only
- no DROP COLUMN / DELETE history / VACUUM FULL / intraday provenance reuse
- qeo_market_ohlcv_recent_grouped remains width 10

application source contains:
- one shared persistDailyOhlcvRows(...) helper
- exact identity key helper
- all three approved writers import/use the shared helper
- provenance-sensitive direct readers query market_ohlcv_history_compat where applicable
```

The initial RED state intentionally references migration/helper files that do not exist yet.

- [ ] **Step 2: Add focused GitHub Actions workflow.**

Use Node 24 + pnpm 10.28.0 and run:

```bash
node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts
```

- [ ] **Step 3: Commit/push RED and open draft PR.**

Commit:

```text
test(QEO-233): define Daily provenance compatibility contract
```

- [ ] **Step 4: Capture expected RED evidence from GitHub Actions before implementation.**

Expected failure: missing QEO-233 migration/shared helper, not syntax or workflow setup failure.

---

### Task 2: Add additive provenance schema, compatibility model, and bounded backfill RPC

**Files:**
- Create: `supabase/migrations/20260915083000_qeo233_daily_ohlcv_provenance_schema.sql`
- Create: `supabase/migrations/20260915083500_qeo233_daily_ohlcv_provenance_compat.sql`

**Interfaces:**
- Produces `public.market_ohlcv_provenance`.
- Adds nullable `public.market_ohlcv_history.provenance_id bigint`.
- Produces `public.market_ohlcv_history_compat` exposing all legacy columns plus `provenance_id` and `provenance_consistent`.
- Produces `public.qeo_market_ohlcv_provenance_backfill_batch(p_limit integer, p_max_database_bytes bigint)` returning batch metrics.
- Replaces `public.qeo_market_ohlcv_recent_grouped(text[], integer)` without changing return shape.

- [ ] **Step 1: Create registry + nullable reference.**

Use the approved schema exactly:

```sql
create table public.market_ohlcv_provenance (
  id bigint generated by default as identity primary key,
  identity_version smallint not null default 1,
  provider text not null,
  provider_detail text not null,
  source_url text not null,
  created_at timestamptz not null default now(),
  unique (identity_version, provider, provider_detail, source_url),
  check (identity_version = 1)
);

alter table public.market_ohlcv_history
  add column provenance_id bigint null;

alter table public.market_ohlcv_history
  add constraint market_ohlcv_history_provenance_id_fkey
  foreign key (provenance_id)
  references public.market_ohlcv_provenance(id)
  on delete restrict;
```

Do not add a large referencing-column index in QEO-233 unless a measured query plan proves it necessary.

- [ ] **Step 2: Add exact consistency guard.**

Create a trigger function that, only when `NEW.provenance_id is not null`, loads the registry row and raises if any of `provider`, `provider_detail`, or `source_url` differs exactly. The trigger runs before insert or update of `provenance_id, provider, provider_detail, source_url`.

- [ ] **Step 3: Add compatibility view.**

`market_ohlcv_history_compat` must expose the full legacy row plus:

```sql
provenance_id,
(
  provenance_id is null
  or (
    registry.id is not null
    and history.provider = registry.provider
    and history.provider_detail = registry.provider_detail
    and history.source_url = registry.source_url
  )
) as provenance_consistent
```

For non-null `provenance_id`, logical `provider_detail` and `source_url` come from the registry; for null references they remain the legacy inline values. Keep inline `provider` and `fetched_at` visible.

- [ ] **Step 4: Add bounded explicit backfill RPC.**

The RPC must:

```text
1. reject p_limit outside a conservative bounded range (1..5000);
2. read pg_database_size(current_database()) before work;
3. if p_max_database_bytes is non-null and current size >= limit, return paused=true without updates;
4. choose at most p_limit rows where provenance_id is null ordered by primary-key fields;
5. insert distinct exact version-1 provenance identities for only those candidates, ON CONFLICT DO NOTHING;
6. update only candidate rows' provenance_id by exact tuple join;
7. return updated_rows, remaining_rows, mismatch_rows, database_bytes_before, database_bytes_after, table_bytes_after, dead_tuples_after, paused;
8. never update OHLCV/provider/provider_detail/source_url/fetched_at.
```

The migration creates the RPC but does not invoke it.

- [ ] **Step 5: Replace grouped RPC through compatibility model while preserving width 10.**

The RPC uses `market_ohlcv_history_compat` and fails closed if requested rows contain `provenance_consistent = false`. The emitted array order remains unchanged.

- [ ] **Step 6: Lock down privileges.**

Registry/view/backfill functions remain service-role only, matching existing market-table conventions.

- [ ] **Step 7: Commit migration implementation.**

```text
feat(QEO-233): add Daily provenance registry compatibility schema
```

---

### Task 3: Centralize Daily writer dual-write behavior

**Files:**
- Create: `modules/market/history/daily-provenance.ts`
- Modify: `modules/market/history/ohlcv-store.ts`
- Modify: `modules/market/history/daily-integrity.ts`
- Modify: `modules/eod/no-trade-repair-step.ts`
- Test: `tests/qeo-233-daily-provenance-runtime.cases.ts`

**Interfaces:**

```ts
export interface PersistedDailyOhlcvRow {
  ticker: string
  timeframe: "1D"
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
}

export async function persistDailyOhlcvRows(
  supabase: SupabaseClient,
  rows: PersistedDailyOhlcvRow[],
): Promise<void>
```

- [ ] **Step 1: Implement exact tuple keying without normalization.**

Use a collision-safe structural key such as JSON serialization of `[1, provider, provider_detail, source_url]`; do not trim or case-fold values.

- [ ] **Step 2: Resolve distinct provenance identities in one bounded upsert per writer batch.**

Upsert distinct registry rows on conflict key `identity_version,provider,provider_detail,source_url`, select returned IDs, and require every source tuple to resolve exactly.

- [ ] **Step 3: Upsert facts with `provenance_id` plus all legacy provenance fields unchanged.**

Fact conflict key remains `ticker,timeframe,bar_time`.

- [ ] **Step 4: Replace the three known direct Daily writer upserts with the shared helper.**

Do not change their provider choice, OHLCV values, repair logic, or fetched timestamps.

- [ ] **Step 5: Commit writer migration.**

```text
refactor(QEO-233): dual-write Daily provenance references
```

---

### Task 4: Move provenance-sensitive direct readers to compatibility reads

**Files:**
- Modify: `modules/market/history/daily-integrity.ts`
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/maintenance.ts`
- Modify: `modules/market/history/daily-cold-history.ts`
- Review: `modules/market/history/ohlcv-store.ts`
- Review: `modules/market/history/ohlcv-grouped.ts`
- Review: `modules/wyckoff/eod-ingest.ts`
- Test: `tests/qeo-233-daily-provenance-runtime.cases.ts`

**Interfaces:**
- Provenance-sensitive direct reads use `market_ohlcv_history_compat`.
- Every reader that consumes provenance must include/check `provenance_consistent` and fail closed on `false`.
- OHLCV-only direct reads may remain on `market_ohlcv_history`.

- [ ] **Step 1: Change provenance-sensitive `.from("market_ohlcv_history")` reads to `.from("market_ohlcv_history_compat")`.**

- [ ] **Step 2: Include `provenance_consistent` in selects and reject inconsistent rows before authority/fingerprint/archive logic uses provenance.**

- [ ] **Step 3: Leave grouped TypeScript decoder width/order unchanged; SQL compatibility is provided by Task 2.**

- [ ] **Step 4: Confirm Wyckoff/EOD chart-series models still receive identical logical provider metadata.**

- [ ] **Step 5: Commit reader migration.**

```text
refactor(QEO-233): route Daily provenance reads through compatibility view
```

---

### Task 5: Exact-head verification and production handoff gate

**Files:**
- Review all QEO-233 changes.
- No production mutation in this source-level phase.

- [ ] **Step 1: Focused QEO-232 + QEO-233 workflows GREEN on exact final head.**

Required focused command in GitHub Actions:

```bash
node --test tests/qeo-232-daily-provenance-contract.cases.ts tests/qeo-233-daily-provenance-runtime.cases.ts
```

- [ ] **Step 2: Standard Verify GREEN on same exact head.**

Require repository Verify gates including secrets, contract manifest/hygiene, lint, TypeScript, Ops build, and production build.

- [ ] **Step 3: Require migration replay/DB drift rehearsal GREEN.**

Because QEO-233 adds migrations, zero-to-latest migration replay must pass before merge-ready.

- [ ] **Step 4: Review diff for safety.**

Reject any QEO-233 diff that contains:

```text
DROP COLUMN provider_detail/source_url
ALTER provenance_id SET NOT NULL
DELETE/TRUNCATE market_ohlcv_history
VACUUM FULL
shadow copy of market_ohlcv_history
intraday provenance-table reuse
automatic invocation of the backfill RPC
```

- [ ] **Step 5: Merge only after user approval.**

After merge, production rollout sequence is:

```text
1. wait for QEO-228/QEO-230 acceptance and re-measure DB headroom;
2. apply QEO-233 additive migrations first;
3. verify registry/view/RPC schema and old application behavior;
4. deploy QEO-233 application code;
5. verify all new writes dual-write exact provenance;
6. run backfill RPC in bounded batches with p_max_database_bytes set from measured headroom;
7. re-measure DB/table/dead tuples after every batch;
8. pause immediately if capacity gate triggers or mismatch_rows > 0;
9. close QEO-233 only after pending rows = 0 and mismatch rows = 0;
10. only then unblock QEO-234.
```

## Completion Criteria

QEO-233 source implementation is merge-ready only when:

- additive registry/reference schema passes the merged QEO-232 guardrail;
- writer dual-write is centralized across all three known writer paths;
- provenance-sensitive direct readers use the compatibility model and fail closed on mismatches;
- grouped RPC stays width 10 and ABI-compatible;
- backfill is bounded, restartable, capacity-gated, and updates only `provenance_id`;
- focused CI, standard Verify, and DB migration replay are green on the exact head;
- no production backfill/reclaim has been executed before QEO-228/QEO-230 headroom acceptance.