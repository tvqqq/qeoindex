# QEO-238 Intraday OHLCV Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully retire QeoIndex intraday OHLCV so `1D` is the minimum chart timeframe, no retired writer/scheduler can regenerate 1m data, the intraday PostgreSQL + Storage footprint is permanently removed, and Daily 5Y physical compaction runs only if the production capacity gate is safe.

**Architecture:** Use a phased mixed-version-safe cutover. First ship a Daily-only application contract and deterministic retired responses while the old schema still exists; then unschedule intraday jobs; then remove Storage objects through the Supabase Storage API and retire database objects explicitly in dependency order; finally re-measure capacity and conditionally run targeted `VACUUM FULL` for `market_ohlcv_history`. Keep destructive production work outside source CI and gate each phase with readback evidence.

**Tech Stack:** Next.js/TypeScript, Supabase PostgreSQL + Storage, pg_cron, GitHub Actions, Vercel, Linear.

**Spec:** `docs/superpowers/specs/2026-09-16-qeo-238-intraday-retirement-design.md`

## Global Constraints

- Active chart timeframes become exactly `1D, 3D, 1W, 1M, 1Q, 1Y`; `1D` is the minimum.
- Legacy persisted intraday timeframes normalize to `1D` only at the UI/settings boundary.
- `/api/market/ohlcv` rejects retired intraday input with deterministic code `INTRADAY_TIMEFRAME_RETIRED` before any retired service/storage call.
- Do not derive intraday candles from Daily.
- Do not keep intraday data in Neon, Storage, or another archive.
- Do not weaken QEO-236 rolling five-calendar-year Daily retention.
- Do not use blanket `DROP ... CASCADE`.
- Unschedule regeneration before destructive schema deletion.
- Storage bytes must be removed through the Supabase Storage API, not by deleting rows directly from `storage.objects`.
- `VACUUM (FULL, ANALYZE) public.market_ohlcv_history` may run only when `estimated_peak_bytes <= 470000000` and lock/writer prechecks are safe.
- Under the QeoIndex inline-only policy, source changes use GitHub APIs and runtime verification uses GitHub Actions; no shell/RDC/UpCloud execution unless explicitly authorized.

---

### Task 1: Pin the Daily-only product contract with RED tests

**Files:**
- Create: `tests/qeo-238-intraday-retirement.test.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/stock-chart-interaction.test.ts`
- Modify: `tests/browser/qeo173-chart-ui-production.spec.ts`
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`

**Interfaces:**
- Consumes: existing `ChartTimeframe`, `QUICK_TIMEFRAMES`, `ALL_TIMEFRAMES`, timeframe persistence helpers and `/api/market/ohlcv` route.
- Produces: executable source contracts requiring only `1D, 3D, 1W, 1M, 1Q, 1Y`, legacy intraday normalization to `1D`, and API fail-closed behavior.

- [ ] **Step 1: Add the failing QEO-238 contract test**

Create assertions equivalent to:

```ts
const ACTIVE = ["1D", "3D", "1W", "1M", "1Q", "1Y"]
assert.deepEqual(ALL_TIMEFRAMES.map((item) => item.id), ACTIVE)
assert.equal(normalizePersistedChartTimeframe("15m"), "1D")
assert.equal(normalizePersistedChartTimeframe("4h"), "1D")
assert.equal(normalizePersistedChartTimeframe("1W"), "1W")
```

Also assert source-level invariants:

```ts
assert.doesNotMatch(activeChartSource, /"1m"|"15m"|"30m"|"1h"|"2h"|"4h"/)
assert.match(ohlcvRouteSource, /INTRADAY_TIMEFRAME_RETIRED/)
assert.match(ohlcvRouteSource, /retired/i)
```

- [ ] **Step 2: Add RED browser-matrix expectations**

Change QEO-172/QEO-173 matrices to use only active values; preserve sample counts and frozen comparable budgets. The test must fail until UI source lists are updated.

- [ ] **Step 3: Trigger focused CI and confirm RED is intentional**

Use the existing QEO chart contract workflow or PR-triggered Verify. Expected result: the new QEO-238 contract fails because active source still exposes intraday values; unrelated current contracts remain green.

- [ ] **Step 4: Commit the RED test state**

Commit message: `test(qeo-238): pin daily-only chart contract`.

---

### Task 2: Cut the Stock Detail UI and persisted settings to 1D minimum

**Files:**
- Modify: `components/stock-detail/chart/stock-chart-types.ts`
- Modify: `components/stock-detail/chart/drawings/drawing-schema.ts`
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Modify: `components/stock-detail/chart/future-timeline.ts`
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `components/stock-detail/stock-detail-workstation.tsx` only where navigation/prefetch assumes intraday.
- Test: files from Task 1.

**Interfaces:**
- Produces `normalizePersistedChartTimeframe(value: unknown): ChartTimeframe` with retired input falling back to `1D`.
- `ChartTimeframe` becomes exactly `"1D" | "3D" | "1W" | "1M" | "1Q" | "1Y"`.

- [ ] **Step 1: Implement the active timeframe type and lists**

Use exactly:

```ts
export type ChartTimeframe = "1D" | "3D" | "1W" | "1M" | "1Q" | "1Y"
export const QUICK_TIMEFRAMES: ChartTimeframe[] = ["1D", "1W", "1M"]
export const ALL_TIMEFRAMES = [
  { id: "1D", label: "1 ngày", group: "Ngày" },
  { id: "3D", label: "3 ngày", group: "Ngày" },
  { id: "1W", label: "1 tuần", group: "Tuần" },
  { id: "1M", label: "1 tháng", group: "Tháng" },
  { id: "1Q", label: "1 quý", group: "Dài hạn" },
  { id: "1Y", label: "1 năm", group: "Dài hạn" },
] as const
```

If existing copy/labels differ, preserve the existing Vietnamese labels while preserving the exact IDs/order above.

- [ ] **Step 2: Add persisted-state compatibility normalization**

Implement a single boundary helper:

```ts
export function normalizePersistedChartTimeframe(value: unknown): ChartTimeframe {
  return typeof value === "string" && ACTIVE_CHART_TIMEFRAMES.has(value as ChartTimeframe)
    ? value as ChartTimeframe
    : "1D"
}
```

Use it wherever local/user settings restore a timeframe. Do not allow retired values deeper into chart history/service code.

- [ ] **Step 3: Remove client live-tail/current-session branches**

Delete intraday-specific window constants, live refresh set, current-trading-date tail split, canonical-minute context and future-timeline minute mapping when they are no longer referenced. Daily-or-larger initial history remains deterministic from the canonical Daily API.

- [ ] **Step 4: Keep navigation atomic for Daily-only frames**

Preserve QEO-172/QEO-517 atomic ticker/timeframe transition semantics; adjacent prefetch may continue for active Daily-or-larger frames only.

- [ ] **Step 5: Run focused chart contracts in GitHub Actions**

Expected: QEO-238 active-timeframe assertions pass; QEO-172/QEO-173 source contracts pass with the new matrix; no type errors from removed intraday union members.

- [ ] **Step 6: Commit**

Commit message: `feat(qeo-238): make 1D the minimum chart timeframe`.

---

### Task 3: Fail closed at the public OHLCV API and simplify the active server path

**Files:**
- Modify: `app/api/market/ohlcv/route.ts`
- Modify: `modules/market/chart-data/timeframes.ts`
- Modify: `modules/market/chart-data/timeframe-service.ts`
- Modify/Delete intraday-only imports from: `modules/market/chart-data/service.ts`
- Delete later-unused modules under `modules/market/chart-data/` only after repository search proves no active imports.
- Test: `tests/qeo-238-intraday-retirement.test.ts`
- Test: existing chart timeframe/service/API contract tests.

**Interfaces:**
- Public route still accepts Daily-or-larger resolution strings supported by the UI.
- Retired input returns a deterministic client error payload:

```json
{
  "ok": false,
  "error": {
    "code": "INTRADAY_TIMEFRAME_RETIRED",
    "message": "Intraday chart timeframes are retired; minimum timeframe is 1D."
  }
}
```

- [ ] **Step 1: Write/extend RED route tests**

For each retired value `1m,15m,30m,1h,2h,4h`, assert the route rejects before `getChartOhlcv`/provider/HOT/COLD invocation.

- [ ] **Step 2: Add an explicit retired-resolution guard before service construction**

Use an explicit set, not a catch-all parser side effect:

```ts
const RETIRED_INTRADAY_RESOLUTIONS = new Set(["1m", "15m", "30m", "1h", "2h", "4h"])
```

Return the deterministic error immediately.

- [ ] **Step 3: Reduce canonical source mapping to Daily-only aggregation**

`canonicalSourceResolution()` should map active resolutions to `1D`. Remove code whose sole purpose is HOT raw 1m, COLD intraday, provider recovery, or derived 1h readiness.

- [ ] **Step 4: Repository-search for active intraday imports**

The active `app/`, `components/`, `modules/` runtime graph must have no import/use of:

```text
hot-store
cold-store (intraday path)
derived-hourly-store
derived-hourly-ready-range
targeted-archive-partitions
intraday provider recovery/backfill helpers
```

Daily code that happens to share a file is split or preserved rather than deleted blindly.

- [ ] **Step 5: Run route/timeframe/market-data contracts in GitHub Actions**

Expected: retired request tests pass; Daily/3D/1W/1M/1Q/1Y aggregation remains green.

- [ ] **Step 6: Commit**

Commit message: `refactor(qeo-238): retire intraday chart server path`.

---

### Task 4: Retire operator entry points and prevent scheduler recreation

**Files:**
- Modify: `app/api/qeoindex/eod/route.ts`
- Delete or convert to deterministic retired response: `app/api/qeoindex/chart-archive-catchup/route.ts`
- Delete or convert to deterministic retired response: `app/api/qeoindex/chart-archive-targeted/route.ts`
- Delete/retire: `workflows/chart-intraday-archive-catchup.ts`
- Modify: `modules/admin/job-schedule.ts`
- Modify: `modules/admin/effective-job-catalog.ts`
- Modify: `modules/admin/scheduler-reconciliation.ts`
- Modify: scheduler/cron tests including `tests/cron-schedule-catalog.test.ts`, `tests/eod-rollout-contract.test.ts`, `tests/scheduler-reconciliation.test.ts`, `tests/cron-timeline-ui.test.ts`, `tests/qeo-228-chart-archive-catchup.cases.ts` as appropriate.

**Interfaces:**
- Expected active scheduler catalog must no longer include `qeoindex-chart-intraday-maintenance-1450-ict` or `qeoindex-chart-archive-catchup-1645-ict`.
- Old operator URLs must not start archive/backfill work.

- [ ] **Step 1: Add RED scheduler/catalog tests**

Assert both retired job names are absent from expected schedules and manual dispatch surfaces.

- [ ] **Step 2: Remove active maintenance/archive modes from EOD routing**

If stale calls arrive, respond deterministically (for example HTTP 410 with `INTRADAY_PIPELINE_RETIRED`) rather than executing archived code.

- [ ] **Step 3: Remove catalog/reconciliation ownership**

Delete the two mappings so reconciliation cannot recreate them.

- [ ] **Step 4: Remove no-longer-reachable workflow/runtime imports**

Delete the intraday archive workflow and targeted recovery runtime only after the route/catalog changes compile without them.

- [ ] **Step 5: Run EOD + scheduler contract workflows**

Expected: Daily EOD v4 remains green; scheduler tests assert absence of retired jobs.

- [ ] **Step 6: Commit**

Commit message: `feat(qeo-238): retire intraday maintenance schedulers`.

---

### Task 5: Add two explicit database migrations: stop regeneration, then retire schema

**Files:**
- Create: `supabase/migrations/<timestamp>_qeo238_stop_intraday_schedulers.sql`
- Create: `supabase/migrations/<later_timestamp>_qeo238_retire_intraday_schema.sql`
- Modify: `supabase/migration-preproduction.json` / reviewed migration ledger inputs as required by repository policy.
- Test: `tests/qeo-238-intraday-retirement.test.ts`
- Test: DB drift/replay workflow.

**Interfaces:**
- Migration 1 is safe to deploy immediately after Daily-only app rollout.
- Migration 2 is destructive and must not be promoted until production preflight proves source cutover + scheduler shutdown + Storage cleanup readiness.

- [ ] **Step 1: Build the exact live routine signature inventory before writing DROP statements**

Query `pg_proc`, `pg_get_function_identity_arguments`, `pg_trigger`, `pg_class`, and `pg_constraint`. Record exact signatures for all intraday-only functions. Preserve `qeo_prune_verified_chart_daily_partition`.

- [ ] **Step 2: Write scheduler-retirement migration**

Use exact-name, idempotent unscheduling:

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qeoindex-chart-intraday-maintenance-1450-ict') then
    perform cron.unschedule('qeoindex-chart-intraday-maintenance-1450-ict');
  end if;
  if exists (select 1 from cron.job where jobname = 'qeoindex-chart-archive-catchup-1645-ict') then
    perform cron.unschedule('qeoindex-chart-archive-catchup-1645-ict');
  end if;
end $$;
```

Do not touch unrelated cron jobs.

- [ ] **Step 3: Write schema-retirement migration in explicit dependency order**

The migration must explicitly drop intraday-only triggers/functions first where required, then tables in child-first order:

```text
chart_ohlcv_derived_hourly_readiness
chart_ohlcv_derived_hourly
chart_ohlcv_backfill_ranges
chart_ohlcv_intraday
chart_ohlcv_cold_manifests
chart_ohlcv_provenance_batches
```

Then remove the known intraday sequence `chart_ohlcv_intraday_content_version_seq` and any other verified intraday-only sequences. Every routine is dropped with its exact identity signature. No `CASCADE`.

- [ ] **Step 4: Add SQL source assertions**

Tests must assert:

```ts
assert.doesNotMatch(sql, /drop\s+.+\s+cascade/i)
assert.match(sql, /drop table if exists public\.chart_ohlcv_intraday/i)
assert.doesNotMatch(sql, /drop function .*qeo_prune_verified_chart_daily_partition/i)
```

- [ ] **Step 5: Run zero-to-latest DB replay in GitHub Actions**

Expected: both migrations replay cleanly from empty DB, with migration-ledger state explained. Do not promote migration 2 yet.

- [ ] **Step 6: Commit**

Commit message: `db(qeo-238): add phased intraday retirement migrations`.

---

### Task 6: Reconcile generated Supabase types and delete dead intraday runtime modules

**Files:**
- Modify generated: `modules/shared/supabase/database.types.ts` using the repository's generated-types workflow output, not hand-written type guesses.
- Delete intraday-only modules proven unreachable by repository search.
- Modify existing tests that intentionally describe the retired subsystem.

**Interfaces:**
- Generated types no longer expose retired tables/RPCs after migration 2.
- Active Daily chart types remain intact.

- [ ] **Step 1: Let DB Drift produce the generated-types candidate**

Do not manually invent generated shapes.

- [ ] **Step 2: Commit the generated candidate**

Confirm only expected retired tables/RPCs disappear; unrelated schema diffs are a blocker.

- [ ] **Step 3: Delete unreachable intraday source modules**

Use GitHub code search to prove no active imports first. Keep shared Daily utilities even if their historical filename contains `chart` or `cold`.

- [ ] **Step 4: Run Verify + DB Drift exact-head**

Expected: TypeScript, build, zero-to-latest, generated types, DB contracts all green.

- [ ] **Step 5: Commit**

Commit message: `chore(qeo-238): remove retired intraday schema types and modules`.

---

### Task 7: Add a one-shot authenticated Storage retirement helper

**Files:**
- Create: `modules/market/chart-data/intraday-retirement.ts`
- Create: `app/api/qeoindex/chart-intraday-retirement/route.ts`
- Create/Modify: focused tests for machine auth, dry-run, batching and bucket exclusivity.

**Interfaces:**
- `inspectIntradayStorage(supabase)` returns bucket/object count, total metadata bytes where available, and rejects cleanup if any object is not part of the verified intraday namespace.
- `deleteIntradayStorageObjects(supabase, { batchSize })` deletes with `supabase.storage.from("chart-ohlcv").remove(paths)` in bounded batches.
- Route supports authenticated `GET`/dry-run and authenticated `POST` execute; it is temporary and removed after reconciliation.

- [ ] **Step 1: Write RED helper tests**

Pin these invariants:

```ts
assert.equal(DEFAULT_DELETE_BATCH_SIZE <= 100, true)
assert.match(source, /storage\.from\(["']chart-ohlcv["']\)\.remove/)
assert.doesNotMatch(source, /from\(["']objects["']\).*delete/s)
```

- [ ] **Step 2: Implement bucket inspection with exclusivity check**

List all objects recursively/paginated and require paths to match the retired archive namespace expected by manifests (`1m/...`). If any `1D/` or unknown path exists, stop and report rather than delete the bucket.

This is important because historical QEO-106 code once contemplated Daily objects in the same bucket; production evidence must prove current contents are exclusively retired intraday before deletion.

- [ ] **Step 3: Implement bounded Storage API deletion**

Delete exact object paths through Supabase Storage API in batches, retry only failed batches with bounded attempts, and read back object count after execution. Do not delete `storage.objects` rows directly.

- [ ] **Step 4: Remove the bucket container only when empty**

Call the supported Storage API bucket removal operation only after object count is zero and exclusivity was verified. If bucket removal is not available in the current Supabase client/runtime, leave an empty bucket and record that state; bytes are already reclaimed.

- [ ] **Step 5: Add machine-authenticated route guard**

Reuse the repository's existing cron/admin machine-auth convention. Unauthenticated calls return 401/403; GET never mutates; POST requires explicit execute intent.

- [ ] **Step 6: Run focused tests + Verify**

Expected: auth, dry-run, batching, exclusivity guard and production build are green.

- [ ] **Step 7: Commit**

Commit message: `feat(qeo-238): add one-shot intraday storage cleanup`.

---

### Task 8: Update docs and open the source-cutover PR

**Files:**
- Modify: `docs/chart-data.md`
- Modify: `docs/HANDOVER.md`
- Modify: `docs/README.md`
- Modify: `docs/chart-performance-budget.md` only where it lists retired timeframe scope; do not loosen budgets.
- Modify: relevant QEO-172 benchmark docs to active Daily-only matrix.

**Interfaces:**
- Docs describe canonical chart data as Daily-only from `market_ohlcv_history` with deterministic 3D/weekly/monthly/quarterly/yearly aggregation.

- [ ] **Step 1: Remove active intraday architecture statements**

Retain historical design docs unchanged; current operational docs must describe the new state.

- [ ] **Step 2: Document retired API response and 1D minimum**

Include the stale-client behavior and five-year Daily retention.

- [ ] **Step 3: Run exact-head source gates**

Required at minimum: Verify, DB Drift, EOD/Daily contracts, current Stock Detail chart UI contracts, scheduler contracts, QEO-238 focused tests.

- [ ] **Step 4: Review the PR diff for scope**

Block merge on unrelated schema/runtime changes.

- [ ] **Step 5: Merge source cutover only when all exact-head gates are green**

Do not promote destructive schema migration in the same action.

---

### Task 9: Deploy Phase 1 and prove production no longer touches intraday paths

**Files:** none unless evidence/docs require a reconciliation commit.

**Interfaces:** production acceptance evidence.

- [ ] **Step 1: Confirm Vercel production READY on the exact merge SHA**

Do not manually redeploy if Git integration already deploys the merge.

- [ ] **Step 2: Production UI smoke**

Verify representative tickers render with `1D` minimum, all active Daily-or-larger frames work, and persisted legacy intraday timeframe state normalizes to `1D`.

- [ ] **Step 3: Stale-client API smoke**

Verify `/api/market/ohlcv?...resolution=15m...` returns deterministic `INTRADAY_TIMEFRAME_RETIRED` and does not produce HOT/COLD/provider log activity.

- [ ] **Step 4: Check Vercel runtime logs for retired route access**

Use a bounded recent window. Any active intraday read/write after source cutover blocks Phase 2 until explained.

- [ ] **Step 5: Record Phase 1 evidence in Linear QEO-238**

---

### Task 10: Promote scheduler-retirement migration and verify regeneration is stopped

**Files:** migration ledger/evidence only if required.

- [ ] **Step 1: Apply only `qeo238_stop_intraday_schedulers` to production**

Use Supabase migration tooling, not raw DDL through `execute_sql`.

- [ ] **Step 2: Read back cron state**

Both exact job names must be absent or inactive; unrelated jobs remain unchanged.

- [ ] **Step 3: Check active requests/sessions**

Verify no active request is running retired maintenance/archive endpoints before Storage/schema deletion.

- [ ] **Step 4: Capture production pre-delete snapshot**

Record DB size, six intraday table sizes/counts, routine inventory, Storage object count/bytes, Daily row count/oldest date/PK state.

---

### Task 11: Permanently remove cold Storage objects

**Files:** none; execute the deployed one-shot helper.

- [ ] **Step 1: Run authenticated dry-run**

Expected: `1,466`-ish objects (or current count), all exclusively in retired intraday namespace. If unknown/`1D` objects appear, STOP and investigate.

- [ ] **Step 2: Execute bounded deletion**

Run the authenticated POST cleanup. Deletion uses Storage API batches and reports per-batch failures.

- [ ] **Step 3: Read back zero object count**

Bucket must be empty before schema manifest deletion. If bucket container is retained empty, record that explicitly.

- [ ] **Step 4: Record exact reclaimed Storage bytes/count in Linear evidence**

---

### Task 12: Promote the explicit schema-retirement migration

**Files:** production migration ledger/evidence only if required.

- [ ] **Step 1: Re-query exact dependencies immediately before promotion**

Ensure no new function/view/trigger references the six tables. Any unexpected dependency blocks promotion; do not switch to CASCADE.

- [ ] **Step 2: Check locks and active transactions**

Ensure no long-running transaction or table lock conflicts with the targeted DROP operations.

- [ ] **Step 3: Apply `qeo238_retire_intraday_schema` through Supabase migration tooling**

- [ ] **Step 4: Read back absence of retired objects**

Verify six tables, intraday-only routines/triggers and `chart_ohlcv_intraday_content_version_seq` are absent.

- [ ] **Step 5: Verify Daily invariants immediately**

```text
market_ohlcv_history row count = pre-drop count
rows older than rolling 5Y cutoff = 0
market_ohlcv_history_pkey exists
oldest retained Daily session unchanged from QEO-236 contract
```

- [ ] **Step 6: Run representative Daily read canaries**

VCB, FPT, HPG, SSI, VNM must return recent Daily rows. Capture query plans/index usage where practical.

- [ ] **Step 7: Re-measure DB size**

Compare to pre-delete `376,458,387 B`; expected order of magnitude is ~`289.7 MB` decimal before Daily rewrite, but acceptance is measured reality rather than this estimate.

---

### Task 13: Recompute and conditionally run Daily VACUUM FULL

**Files:** evidence only unless operational docs need reconciliation.

- [ ] **Step 1: Compute conservative rewrite requirement from post-retirement live values**

Use the same QEO-234 methodology so the comparison is apples-to-apples. Record:

```text
current_db_bytes
market_ohlcv_history heap/index/total bytes
live row bytes estimate
conservative temp rewrite bytes
estimated_peak_bytes = current_db_bytes + conservative_temp_rewrite_bytes
```

- [ ] **Step 2: Apply the hard gate**

Proceed only when:

```text
estimated_peak_bytes <= 470000000
```

Otherwise stop and record the gate failure.

- [ ] **Step 3: Pre-FULL lock/writer check**

Confirm no conflicting long-running transaction and no active EOD/Daily writer window.

- [ ] **Step 4: Run targeted `VACUUM (FULL, ANALYZE) public.market_ohlcv_history` only if safe**

Use an execution path that can run VACUUM outside a transaction block. If the Supabase connector action wraps SQL in a transaction and rejects VACUUM, do not hack around it; use an explicitly supported production maintenance path or stop and report the limitation.

- [ ] **Step 5: Post-FULL validation**

Re-check exact row count, cutoff, PK, representative read canaries, relation/index size and total DB size.

---

### Task 14: Remove the one-shot cleanup surface and reconcile repository/production evidence

**Files:**
- Delete: `app/api/qeoindex/chart-intraday-retirement/route.ts`
- Delete: `modules/market/chart-data/intraday-retirement.ts`
- Delete/adjust their focused tests.
- Modify: `supabase/migration-preproduction.json`
- Create/Modify: `docs/db/evidence/production-migration-ledger-2026-09-16.json`
- Update current operational docs if final measured sizes differ materially from estimates.

**Interfaces:**
- No permanent endpoint remains that can perform destructive Storage cleanup.
- Repo migration state reports the two QEO-238 production migrations accurately.

- [ ] **Step 1: Delete the temporary cleanup route/helper after production Storage is empty**

- [ ] **Step 2: Reconcile migration ledger from `REPO_AHEAD` to production mapping**

Carry forward all pre-existing reviewed ledger states exactly; do not accidentally drop unrelated `PRODUCTION_AHEAD` rows.

- [ ] **Step 3: Run exact-head Verify + DB Drift + Daily/EOD regressions**

- [ ] **Step 4: Merge the reconciliation PR only when green**

- [ ] **Step 5: Add final Linear QEO-238 evidence**

Include source PRs/SHAs, production deployment SHA, cron removal, Storage deletion counts, schema retirement version, before/after DB size, FULL gate calculation/result, Daily row/cutoff/PK/read canaries, and final CI runs.

- [ ] **Step 6: Mark QEO-238 Done only after all acceptance criteria are evidenced**

---

## Recommended verification commands (do not execute locally under inline-only policy)

These commands are for an authorized local/Codex environment or as the basis of GitHub Actions steps; ChatGPT Web should rely on existing GitHub Actions workflows instead of running them on a shell:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Use the repository's focused QEO-172/QEO-173/EOD/DB Drift workflows for exact-head verification. Do not claim these passed unless the corresponding GitHub Actions runs are actually green.

## Self-review

- Spec coverage: every design phase is mapped to Tasks 1–14, including UI compatibility, API fail-closed, scheduler stop, explicit schema drop order, Storage API deletion, DB sizing, conditional FULL and ledger reconciliation.
- Placeholder scan: no TBD/TODO/"similar to" placeholders remain.
- Type/interface consistency: the active `ChartTimeframe` set and `normalizePersistedChartTimeframe()` signature are consistent across UI/test tasks; the two migration roles remain separated throughout the rollout.
- Safety check: no task uses `DROP ... CASCADE`, no task deletes `storage.objects` directly, and `VACUUM FULL` remains gated rather than unconditional.
