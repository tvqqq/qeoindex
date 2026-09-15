# QEO-234 — Compact Daily provenance cutover + physical reclaim design

Date: 2026-09-15  
Status: Approved design direction; implementation pending plan  
Parent: QEO-227  
Depends on: QEO-233 complete  
Scope owner: `public.market_ohlcv_history`

## 1. Problem statement

QEO-233 completed the additive provenance-reference migration for the canonical completed-Daily OHLCV store. Production now has a lossless immutable Daily provenance registry and every `market_ohlcv_history` row references an exact version-1 provenance identity.

The fact table still stores the long provenance strings inline on every Daily row:

- `provider_detail`
- `source_url`

These fields are now redundant because the exact values already exist in `public.market_ohlcv_provenance` and are reachable through `provenance_id`.

Production baseline after QEO-233 completion:

- database size: **399,789,203 bytes**;
- `market_ohlcv_history` rows: **348,691**;
- rows with `provenance_id IS NULL`: **0**;
- provenance mismatch/orphan rows: **0**;
- compatibility inconsistencies: **0**;
- registry rows: **1,560**;
- distinct history provenance tuples: **1,560**;
- history heap: **135,839,744 bytes**;
- history indexes: **43,188,224 bytes**;
- history total relation: **179,101,696 bytes**;
- inline `provider_detail` payload: **20,403,667 bytes**;
- inline `source_url` payload: **48,034,986 bytes**;
- repeated long provenance payload: **68,438,653 bytes**;
- estimated current tuple payload: **106,926,632 bytes** (~306.65 B/row);
- estimated compact tuple payload without the two long inline fields: **38,037,480 bytes** (~109.09 B/row).

The logical saving opportunity is therefore about **68.4 MB** before PostgreSQL tuple/page overhead. QEO-234 must convert that logical saving into physical database headroom without risking the ~500 MB plan limit.

## 2. Goals

QEO-234 must:

1. prove zero runtime dependence on inline `provider_detail` and `source_url`;
2. make registry-backed reads and compact writes canonical;
3. preserve exact provenance auditability and existing logical APIs;
4. preserve inline `provider` and `fetched_at`;
5. enforce `provenance_id NOT NULL` only after cutover gates pass;
6. remove only `provider_detail` and `source_url` from the Daily fact table;
7. preserve the grouped Daily RPC positional ABI at width 10;
8. preserve EOD, Wyckoff, chart Daily, integrity, and repair semantics;
9. reclaim physical storage using a measured capacity-safe strategy;
10. preserve a lossless rollback path after column removal;
11. measure before/after database, heap, index, and total relation size.

Target physical saving is on the order of **50 MB**, but acceptance reports the actual measured delta rather than treating the target as guaranteed.

## 3. Non-goals

QEO-234 does not:

- change Daily OHLCV values or fact identity;
- change provider precedence or zero-volume authority semantics;
- change RAW/ADJUSTED price-basis policy;
- remove inline `provider`;
- remove inline `fetched_at`;
- merge Daily and intraday provenance models;
- prune historical Daily bars;
- introduce provenance normalization beyond exact version-1 byte identity;
- run `VACUUM FULL` merely because columns were dropped;
- use a full shadow-table copy unless a later production headroom review explicitly proves it safe;
- drop the existing lookup index merely because it appears redundant.

## 4. Existing contracts that must survive

### 4.1 Canonical Daily fact identity

The fact key remains:

```text
(ticker, timeframe, bar_time)
```

`market_ohlcv_history` remains the canonical persistent completed-Daily fact store.

### 4.2 Exact provenance identity

Version-1 provenance identity remains exact byte equality of:

```text
(identity_version, provider, provider_detail, source_url)
```

No trimming, case folding, URL canonicalization, parsing, prefix normalization, or heuristic reconstruction is allowed.

### 4.3 Inline fields retained after cutover

The final compact Daily row retains:

- `provider` — short and frequently used for authority decisions;
- `fetched_at` — fact acquisition/update event metadata;
- `provenance_id` — immutable registry reference.

The final compact fact row removes only:

- `provider_detail`;
- `source_url`.

### 4.4 Logical provenance shape remains available

Consumers that require logical provenance must still receive:

```text
provider
provider_detail
source_url
fetched_at
```

The long fields are reconstructed by joining `provenance_id -> market_ohlcv_provenance`.

### 4.5 Grouped RPC ABI remains width 10

`qeo_market_ohlcv_recent_grouped(text[], integer)` continues to emit:

```text
[bar_time, open, high, low, close, volume,
 provider, provider_detail, source_url, fetched_at]
```

No caller migration is allowed to depend on a positional-width change in QEO-234.

### 4.6 Zero-volume authority semantics remain exact

Fallback no-trade authority must still require the exact registry-backed logical values equivalent to:

```text
provider = 'Fallback'
source_url = 'internal://stock_orderbook_snapshots'
provider_detail starts with 'Verified final market-close repair'
```

## 5. Current dependency audit

QEO-233 moved major application provenance-sensitive reads through `market_ohlcv_history_compat`, but QEO-234 cannot drop the legacy columns yet.

Production SQL objects still directly reference the legacy columns, including:

- `qeo_market_daily_integrity_report()`;
- `qeo_market_daily_integrity_report_scoped(text[])`;
- `qeo_market_ohlcv_recent(text[], integer)`;
- the QEO-233 backfill RPC, which becomes obsolete after cutover;
- the current compatibility view definition itself.

Application source also still contains pre-QEO-233 schema fallback branches that select inline `provider_detail` / `source_url` directly when the compatibility view is unavailable. Those fallbacks are intentionally useful during additive rollout but must be removed before destructive column removal.

Direct readers that select only OHLCV, ticker, close, volume, or other non-provenance fields may continue querying `market_ohlcv_history` directly.

## 6. Chosen architecture: two-stage bridge + maintenance cutover

QEO-234 uses a two-stage cutover rather than dropping the long columns in the same release that removes application dependencies.

Reason: deployment-order safety. The bridge release must prove that the running application and all SQL consumers can operate with registry-backed provenance before production loses the legacy inline rollback authority.

### 6.1 Stage 1 — registry-canonical bridge release

Stage 1 is logically non-destructive and rollback-friendly.

It performs the following source/schema changes:

1. Make `provider_detail` and `source_url` nullable but retain them physically.
2. Redefine `market_ohlcv_history_compat` so a non-null `provenance_id` always sources `provider_detail` and `source_url` from the registry.
3. Make compatibility consistency mean:
   - registry row exists;
   - inline `provider` exactly equals registry `provider`;
   - if legacy long fields are still non-null, they must exactly equal registry values;
   - null long legacy fields are valid because the registry is authoritative.
4. Change the shared Daily persistence helper so it still accepts the complete logical provenance tuple in application memory, resolves/creates the exact registry identity, but writes to the fact table using only:
   - OHLCV/fact identity;
   - `provider`;
   - `fetched_at`;
   - `provenance_id`.
5. Remove the legacy fact-upsert fallback from the shared provenance writer helper.
6. Remove provenance-sensitive application fallback branches that directly select `provider_detail` / `source_url` from the fact table.
7. Convert all SQL functions that consume provenance to registry-aware reads through `market_ohlcv_history_compat` or an exact equivalent join.
8. Preserve grouped and ungrouped RPC logical return shapes.
9. Retire or disable the historical QEO-233 backfill RPC after proving pending rows remain zero; it must not remain an active migration mechanism once the legacy columns cease to exist.

Stage 1 does **not** drop the two columns and does **not** perform physical reclamation.

### 6.2 Stage 1 production canary gate

Before Stage 2 is allowed, production must observe at least one real controlled Daily writer event under the bridge build.

The canary must prove:

- writer resolves the exact provenance registry identity;
- fact row has non-null `provenance_id`;
- inline `provider` and `fetched_at` are correct;
- new write does not require non-null inline `provider_detail` / `source_url`;
- compatibility read reconstructs exact logical `provider_detail` / `source_url` from the registry;
- integrity / chart / grouped reads see the same logical provenance;
- zero mismatch/orphan rows remain after the canary.

If a natural Daily writer event is not available during the rollout window, a controlled idempotent canary may rewrite one known Daily fact with identical OHLCV and logical provenance through the canonical writer helper. The canary must not change OHLCV values.

## 7. Stage 2 — maintenance cutover

Stage 2 runs only in an explicitly authorized post-market maintenance window. Expected target window is 5–10 minutes, but timeout/stop conditions are authoritative.

### 7.1 Writer pause

Before destructive DDL:

- preserve normal reads;
- temporarily revoke `INSERT` and `UPDATE` for `service_role` on `market_ohlcv_history`;
- owner/migration role retains the ability to perform validated DDL;
- no background Daily writer may proceed until post-cutover verification passes.

The writer pause is a safety boundary, not a long-term permission model.

### 7.2 Transactional logical cutover

Within one migration transaction:

1. assert `provenance_id IS NOT NULL` for all rows;
2. assert every provenance reference resolves to a registry row;
3. assert exact `provider == registry.provider` for all rows;
4. assert all non-null legacy long fields, if present, match the registry;
5. replace the provenance consistency trigger so it no longer references soon-to-be-dropped columns and enforces registry existence + inline-provider equality;
6. redefine `market_ohlcv_history_compat` to reconstruct both long fields solely from the registry;
7. redefine all dependent SQL functions before/around column removal so no stored expression references the legacy fields;
8. set `provenance_id NOT NULL`;
9. drop `provider_detail`;
10. drop `source_url`;
11. preserve all OHLCV constraints, primary key, provider/fetched_at fields, FK `ON DELETE RESTRICT`, RLS state, grants, canonical-time/session/provider-precedence triggers;
12. commit only if every validation and DDL statement succeeds.

Any failure before commit rolls the logical cutover back atomically.

### 7.3 Post-cutover compact row shape

The final fact columns are conceptually:

```text
ticker
 timeFrame / timeframe
bar_time
open
high
low
close
volume
provider
fetched_at
provenance_id NOT NULL
```

The exact repository schema naming remains `timeframe` as today.

## 8. SQL consumer cutover

All SQL objects that require long provenance must become registry-aware before the columns are removed.

### 8.1 `qeo_market_ohlcv_recent`

Keep its current logical return columns including `provider_detail` and `source_url`, but source them from `market_ohlcv_history_compat`.

### 8.2 `qeo_market_ohlcv_recent_grouped`

Keep width 10 and exact positional order. Continue reading from the compatibility model.

After Stage 2 there is no longer an inline-vs-registry long-field equivalence check because the inline fields do not exist; consistency reduces to a valid provenance reference and inline-provider equality.

### 8.3 Daily integrity report RPCs

Both full and scoped integrity reports must source `provider_detail` and `source_url` through the registry-aware compatibility model. Their zero-volume classification logic must remain logically identical.

### 8.4 Backfill RPC retirement

`qeo_market_ohlcv_provenance_backfill_batch` depends on the legacy inline tuple to seed/resolve provenance. After QEO-233 completion and QEO-234 destructive cutover it is no longer valid.

QEO-234 must explicitly retire it, preferably by dropping the function in Stage 2 after all final pre-cutover assertions pass. Reintroducing a legacy historical backfill path after the source columns are removed would be misleading and unsafe.

## 9. Application writer cutover

The shared `persistDailyOhlcvRows(...)` interface may continue accepting logical source fields from caller code:

```text
provider
provider_detail
source_url
fetched_at
```

This keeps provider-specific logic and caller models stable.

Internally the helper:

1. resolves the exact registry identity;
2. verifies the resolved `provider` equals the source row provider;
3. maps the row to `provenance_id`;
4. upserts the compact fact row without the two long fields.

All known writers remain routed through this helper:

- normal Daily history refresh;
- targeted Daily integrity repair;
- EOD final/no-trade repair.

No writer may directly write a provenance ID without resolving/validating the exact tuple through the shared helper.

## 10. Application reader cutover

Provenance-sensitive readers use only registry-aware logical reads after Stage 1.

Legacy schema-unavailable fallback logic that selects the long fields directly from `market_ohlcv_history` is removed.

This includes the known provenance-sensitive paths in:

- `modules/market/history/ohlcv-store.ts`;
- `modules/market/history/daily-integrity.ts`;
- `modules/market/chart-data/service.ts`;
- `modules/market/chart-data/maintenance.ts`;
- `modules/market/history/daily-cold-history.ts` where still retained for historical compatibility/audit.

OHLCV-only direct reads remain valid and need not be forced through the provenance join.

## 11. Dependency-proof gate

Before Stage 2 production DDL, QEO-234 must prove zero runtime dependence on the soon-to-be-dropped columns through all of:

1. repository source search excluding historical migration/spec text;
2. current database dependency inventory (`pg_depend` / stored function definitions / views / triggers);
3. focused contract tests that reject new direct provenance reads from the fact table;
4. zero-to-latest migration replay;
5. generated Supabase database types showing the intended bridge/cutover state at the appropriate migration boundary;
6. bridge production canary;
7. standard QeoIndex Verify + EOD/Wyckoff/chart Daily contracts on the exact head.

Historical migration files may still contain the old column names because they describe prior schema states; the dependency gate distinguishes historical DDL text from live runtime dependencies.

## 12. Physical reclamation strategy

Dropping PostgreSQL columns does not shrink the table file. QEO-234 therefore separates logical cutover from physical rewrite.

### 12.1 Why shadow-table swap is rejected by default

At the current ~399.8 MB database size, materializing a second full compact table plus indexes while keeping the ~179.1 MB old relation could consume unsafe temporary headroom under the ~500 MB plan limit.

Therefore a full copy/swap is not the default QEO-234 production method.

### 12.2 Preferred method

Preferred physical reclaim, only after successful logical cutover and capacity preflight:

```text
VACUUM FULL public.market_ohlcv_history
```

This is permitted only inside the approved maintenance window and only when the measured headroom gate passes.

Regular `VACUUM (ANALYZE)` remains useful before the maintenance operation but is not considered physical reclamation because it does not shrink the relation file.

## 13. Lookup-index evaluation

Production currently has:

- `market_ohlcv_history_pkey`: ~22.8 MB;
- `market_ohlcv_history_lookup_idx`: ~20.4 MB on `(ticker, timeframe, bar_time DESC)`.

The lookup index overlaps the PK key order and a B-tree can scan the PK backward, but production usage counters show both indexes are actively used. QEO-234 must therefore benchmark rather than assume redundancy.

### 13.1 Baseline

Capture representative `EXPLAIN (ANALYZE, BUFFERS)` results for recent 260-row Daily reads across multiple tickers before maintenance.

### 13.2 Transactional benchmark

Inside maintenance, evaluate the lookup index removal in a rollbackable experiment:

1. begin transaction;
2. drop only `market_ohlcv_history_lookup_idx`;
3. run representative read plans;
4. verify the PK backward scan or another bounded index plan is chosen;
5. record execution times;
6. rollback the experiment.

Permanent index removal is allowed only if:

- no sequential scan is introduced for the representative bounded ticker/timeframe query;
- execution time is no worse than **2× baseline**;
- absolute execution time remains **<20 ms** for the representative 260-row read;
- relevant CI/query contracts remain compatible.

If any criterion fails, retain/recreate the lookup index and do not count its ~20 MB as expected reclaim.

## 14. Capacity gate for `VACUUM FULL`

Before the rewrite, calculate a conservative temporary-space estimate from production measurements.

Use:

```text
estimated_rewrite_temp_bytes =
  estimated_compact_live_tuple_bytes * 1.6
  + remaining_index_bytes * 1.25

estimated_peak_database_bytes =
  current_database_bytes + estimated_rewrite_temp_bytes
```

`VACUUM FULL` is allowed only when both conditions hold immediately before execution:

1. **current database size <= 385,000,000 bytes** after any independently accepted index reclamation and regular vacuum;
2. **estimated peak database size <= 470,000,000 bytes**.

This leaves at least ~30 MB safety margin under a 500 MB plan cap and avoids relying on a best-case rewrite estimate.

If either condition fails, QEO-234 stops after the logical compact cutover. Physical reclaim is explicitly deferred rather than consuming unsafe headroom.

## 15. Rewrite timeout and stop behavior

`VACUUM FULL public.market_ohlcv_history` receives a maintenance statement timeout of approximately **8 minutes**.

Stop conditions include:

- timeout;
- disk/quota error;
- lock acquisition failure beyond the maintenance envelope;
- unexpected database growth;
- any pre- or post-rewrite integrity failure.

On rewrite failure, verify the live relation and schema before any writer permission is restored. Do not chain additional rewrite attempts blindly.

## 16. Maintenance sequence

The exact production sequence is:

```text
A. Preflight before writer pause
   - confirm bridge build + production canary accepted
   - confirm pending=0, orphan/mismatch=0
   - snapshot row count, DB/table/index sizes
   - snapshot deterministic logical digest
   - capture representative query-plan/latency baseline
   - prove zero live dependency on legacy columns

B. Pause writers
   - revoke INSERT/UPDATE on market_ohlcv_history from service_role
   - keep reads available

C. Logical cutover migration
   - run all fail-closed assertions
   - redefine trigger/view/functions
   - SET provenance_id NOT NULL
   - drop provider_detail/source_url
   - retire historical backfill RPC
   - commit transaction

D. Verify logical cutover while writers remain paused
   - row count unchanged
   - deterministic logical digest unchanged through registry-backed logical view
   - grouped width=10
   - integrity RPCs execute with unchanged logical semantics
   - representative Daily reads pass

E. Lookup-index benchmark
   - evaluate transactional index drop
   - permanently drop only if acceptance gates pass

F. Physical capacity preflight
   - regular VACUUM (ANALYZE)
   - remeasure DB/relation/index bytes
   - calculate conservative peak estimate

G. Physical reclaim
   - VACUUM FULL only if both capacity gates pass
   - otherwise skip/defer rewrite

H. Post-reclaim verification
   - repeat digest/row-count/RPC/read checks
   - measure final DB/table/index sizes

I. Restore writers
   - re-grant intended service_role INSERT/UPDATE privileges
   - run compact writer canary
   - verify new fact + registry-backed logical provenance
```

## 17. Deterministic logical digest

The cutover must compare the same logical dataset before and after column removal.

The digest input includes, in canonical primary-key order:

```text
ticker
 timeFrame/timeframe
bar_time
open
high
low
close
volume
provider
provider_detail   -- logical value, registry-backed after cutover
source_url        -- logical value, registry-backed after cutover
fetched_at
```

The digest implementation must use deterministic serialization with unambiguous field boundaries and NULL representation. The production comparison uses the compatibility logical read model so pre/post schemas can be compared without changing the logical tuple shape.

A digest mismatch is a hard stop. It is not acceptable to continue because row counts happen to match.

## 18. Rollback strategy

### 18.1 Stage 1 rollback

Before legacy column removal:

- redeploy the QEO-233-compatible application build if necessary;
- legacy long fields still exist for historical rows;
- registry/reference data remains valid;
- no provenance or OHLCV restoration is required.

### 18.2 Stage 2 rollback after column removal

Rollback remains lossless because the immutable registry contains the exact version-1 strings.

Procedure:

1. pause Daily writers;
2. re-add nullable `provider_detail` and `source_url` columns;
3. populate them strictly from `provenance_id -> market_ohlcv_provenance`;
4. assert every row resolves;
5. assert inline provider equals registry provider;
6. set both restored columns NOT NULL only after successful population;
7. restore QEO-233-compatible view/triggers/RPC definitions;
8. verify logical digest and grouped width-10 ABI;
9. only then deploy a legacy application build;
10. restore writer permissions.

Rollback must never reconstruct long provenance fields from provider names, external APIs, URL heuristics, or default strings.

### 18.3 Physical rewrite rollback limitation

`VACUUM FULL` itself is not reversed by restoring an old relfilenode after successful commit. Logical rollback remains possible because schema/provenance data are recoverable from the registry. This is why all logical verification is performed both before and after the physical rewrite.

## 19. Testing requirements

QEO-234 implementation requires focused source/schema contracts before production rollout.

Tests must prove at minimum:

1. bridge writer resolves provenance but does not require inline long-column writes;
2. no provenance-sensitive application reader has a direct legacy fallback to `market_ohlcv_history.provider_detail/source_url`;
3. all current SQL provenance consumers are registry-aware;
4. bridge compatibility view tolerates null legacy long fields only when registry identity is valid;
5. cutover migration fails if any provenance reference is null/orphaned/inconsistent;
6. final fact schema keeps `provider`, `fetched_at`, `provenance_id NOT NULL` and removes only the two long fields;
7. FK remains `ON DELETE RESTRICT`;
8. grouped RPC remains exact width 10/order-compatible;
9. ungrouped recent RPC preserves logical return fields;
10. Daily integrity RPC zero-volume authority logic remains unchanged logically;
11. historical backfill RPC is retired after destructive cutover;
12. rollback SQL can reconstruct exact long fields from registry;
13. migration contains no Daily OHLCV update/rewrite logic beyond schema/rollback operations;
14. no Daily-history DELETE/TRUNCATE is introduced;
15. no intraday provenance model is reused;
16. standard Verify, EOD/Wyckoff/chart Daily contracts, TypeScript, production build, and zero-to-latest migration replay are green on the exact final head.

## 20. Production acceptance criteria

QEO-234 may close only when all applicable gates pass:

- bridge release deployed and compact-write production canary succeeds;
- zero runtime dependency on inline long columns is proven;
- all 348,691 existing rows retain valid exact provenance after cutover, adjusted only for legitimate new Daily writes between design and execution;
- final `provenance_id` is non-null for every fact row;
- inline `provider` matches registry provider for every row;
- exact logical digest matches before/after destructive cutover;
- grouped RPC remains width 10;
- integrity/report/RPC/chart/Wyckoff Daily behavior passes verification;
- final compact schema has no `provider_detail` / `source_url` columns on the fact table;
- physical DB/table/index sizes are measured before and after;
- if lookup index is removed, benchmark gates prove no unacceptable regression;
- `VACUUM FULL` runs only if the capacity gate is satisfied; otherwise the deferred physical-reclaim decision is documented explicitly;
- writer permissions are restored only after verification;
- post-cutover compact writer canary succeeds;
- rollback evidence and exact reconstruction query are recorded.

A physical saving materially below the ~50 MB order-of-magnitude target is reported as measured evidence, not hidden or reinterpreted as success. Logical normalization can be complete even when physical rewrite is safely deferred, but QEO-234's physical-reclaim acceptance remains open until the issue explicitly records the accepted measured outcome or a capacity-based defer decision.

## 21. Absolute stop conditions

Immediately stop the production cutover if any of the following occurs:

- `provenance_id` null rows > 0;
- registry orphan/mismatch rows > 0;
- provider/registry mismatch > 0;
- source or database dependency audit still finds a live consumer of the legacy columns;
- bridge production writer canary fails;
- deterministic digest mismatch;
- grouped RPC width/order regression;
- integrity RPC logical regression;
- index experiment produces sequential scan or exceeds benchmark thresholds;
- current DB >385 MB at the physical rewrite gate;
- estimated peak DB >470 MB;
- rewrite timeout/disk/lock failure;
- post-cutover read or provenance audit failure.

Index benchmark failure only blocks index removal; it does not by itself invalidate the logical provenance cutover.

Capacity-gate failure blocks `VACUUM FULL`; it does not force rollback of a verified logical compact cutover.

## 22. Authorization boundaries

Approval of this design is not authorization to perform the destructive production Stage 2 cutover or `VACUUM FULL`.

Implementation follows normal QeoIndex inline-only policy:

```text
source analysis
→ GitHub source/migration changes
→ PR
→ exact-head GitHub Actions verification
→ merge only with user approval
→ bridge deploy only with user approval
→ production maintenance cutover only with explicit user approval
```

The maintenance authorization must be obtained after bridge production acceptance and immediately before writer pause / destructive DDL.

## 23. Decision summary

Use a **two-stage registry-canonical bridge followed by a short post-market maintenance cutover**.

Do not shadow-copy the full table under current quota headroom. First remove every application and SQL dependency on inline long provenance and prove compact writes in production. Then, during an explicitly authorized writer-pause window, enforce non-null references, drop only `provider_detail` and `source_url`, preserve registry-backed logical APIs and width-10 ABI, benchmark the overlapping lookup index rather than assuming it is redundant, and run `VACUUM FULL` only when conservative measured peak capacity is <=470 MB and current DB is <=385 MB.

Exact provenance remains losslessly recoverable from the immutable registry throughout the lifecycle.