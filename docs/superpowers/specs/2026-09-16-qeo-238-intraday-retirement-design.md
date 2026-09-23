# QEO-238 Intraday OHLCV Retirement Design

## Context

QEO-236 changed canonical Daily OHLCV to a rolling five-calendar-year retention window and permanently deleted rows older than that cutoff. That logical retention change did not shrink the existing `market_ohlcv_history` relation because ordinary `VACUUM (ANALYZE)` makes freed heap space reusable but does not rewrite the table file.

Production still has a separate intraday chart subsystem whose canonical source is raw `1m`. The product decision for QEO-238 is to retire that subsystem completely: the Stock Detail chart will support `1D` and larger timeframes only, no intraday archive will be retained, and retired intraday data must not be regenerated.

Production measurements taken during the QEO-238 audit:

- database size: `376,458,387 B` (`359 MB` as reported by PostgreSQL);
- `market_ohlcv_history`: `158,744,576 B`, `230,013` live rows, `0` dead tuples;
- `chart_ohlcv_intraday`: `72,646,656 B`;
- `chart_ohlcv_provenance_batches`: `7,323,648 B`;
- `chart_ohlcv_derived_hourly`: `3,612,672 B`;
- `chart_ohlcv_cold_manifests`: `1,556,480 B`;
- `chart_ohlcv_derived_hourly_readiness`: `909,312 B`;
- `chart_ohlcv_backfill_ranges`: `737,280 B`;
- measured intraday DB stack total: `86,786,048 B`;
- private Storage bucket `chart-ohlcv`: `1,466` objects using approximately `1,834,869 B`;
- pg_cron jobs `qeoindex-chart-intraday-maintenance-1450-ict` and `qeoindex-chart-archive-catchup-1645-ict` are active.

The current application still exposes `1m`, `15m`, `30m`, `1h`, `2h`, and `4h` and routes those resolutions through canonical raw `1m`. Therefore production schema deletion cannot precede the application cutover.

## Goals

1. Make `1D` the minimum active Stock Detail chart timeframe.
2. Ensure no application route, cron job, backfill, archive, provider-recovery, derived-hourly, or maintenance path can regenerate intraday OHLCV.
3. Retire intraday-only PostgreSQL objects in explicit dependency order without blind `DROP ... CASCADE`.
4. Permanently remove the `chart-ohlcv` cold archive objects; no Neon or other archive is retained.
5. Preserve QEO-236 rolling five-year Daily retention unchanged.
6. Re-measure physical DB size after intraday retirement.
7. Re-evaluate targeted `VACUUM (FULL, ANALYZE) public.market_ohlcv_history` using the existing conservative `470,000,000 B` peak gate and execute it only when the gate and lock/session checks are safe.
8. Leave repository migration state, generated types, operational docs, scheduler catalog, and production evidence reconciled.

## Non-goals

- Do not retain intraday OHLCV in Neon, Supabase Storage, another database, or an application-level archive.
- Do not derive intraday bars from Daily data.
- Do not weaken Daily continuity, provenance, or rolling five-year retention rules.
- Do not rewrite unrelated evidence, AI Council, scanner, orderbook, or realtime tables for storage savings.
- Do not run `VACUUM FULL` merely because a backup or schema cleanup exists; the capacity gate remains mandatory.
- Do not use `DROP ... CASCADE` as a shortcut for dependency discovery.

## Product timeframe contract

The active chart timeframe set becomes exactly:

```text
1D, 3D, 1W, 1M, 1Q, 1Y
```

`1D` is the minimum active timeframe. UI quick-timeframe controls, full timeframe menus, navigation prefetch, chart history planning, benchmark matrices, drawings/settings validation, and tests must no longer assume an active intraday timeframe.

Legacy serialized or persisted timeframe values may still contain `1m`, `15m`, `30m`, `1h`, `2h`, or `4h`. They must be treated as retired input and normalized to `1D` at the UI/settings boundary rather than causing a render failure or reviving an intraday request. This compatibility normalization is for old user state only; it does not preserve an intraday data path.

The public chart OHLCV API must reject a retired intraday resolution before constructing a chart-data service request. The error is explicit and deterministic (`INTRADAY_TIMEFRAME_RETIRED`) so stale clients fail closed instead of touching removed schema.

## Application cutover

The application cutover happens before destructive schema removal.

### Active chart path

- `ChartTimeframe` and active timeframe lists contain only Daily-or-larger values.
- `chart-history` initial windows, cache planning, current-tail logic, and live refresh no longer contain intraday branches.
- Stock Detail no longer creates or consumes canonical-minute context for chart history.
- adjacent-ticker/timeframe prefetch operates only on Daily-or-larger history.
- QEO-172 production benchmark matrix is revised to active timeframes only; its frozen performance budgets remain unchanged for comparable interactions.

### API behavior

`/api/market/ohlcv` retains Daily-or-larger deterministic aggregation from canonical `market_ohlcv_history`. Requests for retired intraday resolutions are rejected before any HOT/COLD/provider/derived-hourly code is invoked.

The old intraday implementation modules may be deleted when no active route/import depends on them. Repository history remains the rollback/audit source; dormant runtime compatibility code is not retained because it could accidentally regenerate retired data.

### Maintenance and recovery routes

The following intraday-only operational entry points are retired or changed to deterministic retired responses:

- chart intraday maintenance mode;
- chart archive lifecycle mode;
- chart derived recovery mode;
- archive catch-up route/workflow;
- targeted archive recovery route;
- storage audit/capacity workflows that exist only for the intraday HOT/COLD subsystem.

Operator/job catalogs and scheduler reconciliation must no longer advertise these jobs as expected active schedules.

## Scheduler cutover

Scheduler retirement is an explicit migration step. The migration checks for each known cron job by exact name and unschedules it when present:

- `qeoindex-chart-intraday-maintenance-1450-ict`;
- `qeoindex-chart-archive-catchup-1645-ict`.

The migration must be idempotent. Repository scheduler catalogs/tests are updated in the same source cutover so a future reconciliation cannot recreate the retired schedules.

Before schema deletion, production verification must show both jobs absent/inactive and no currently executing request for the retired maintenance/archive endpoints.

## PostgreSQL retirement boundary

The following measured tables are intraday-only and are retired:

1. `public.chart_ohlcv_derived_hourly_readiness`;
2. `public.chart_ohlcv_derived_hourly`;
3. `public.chart_ohlcv_backfill_ranges`;
4. `public.chart_ohlcv_intraday`;
5. `public.chart_ohlcv_cold_manifests`;
6. `public.chart_ohlcv_provenance_batches`.

The schema migration must explicitly remove intraday-only triggers, functions/RPCs, and sequences before or with their owning tables. The production audit identified intraday-only routines including:

- `qeo_abandon_chart_intraday_range`;
- `qeo_chart_intraday_coverage`;
- `qeo_chart_intraday_session_coverage`;
- `qeo_chart_intraday_success_coverage`;
- `qeo_chart_storage_capacity`;
- `qeo_claim_chart_intraday_range`;
- `qeo_complete_chart_intraday_range`;
- `qeo_ensure_chart_intraday_session_partition_locked`;
- `qeo_invalidate_chart_derived_hourly_readiness`;
- `qeo_prune_verified_chart_intraday_partition`;
- `qeo_publish_chart_derived_hourly_generation`;
- `qeo_publish_chart_derived_hourly_readiness`;
- `qeo_stamp_chart_intraday_content_identity`;
- `qeo_upsert_chart_intraday_bars`;
- `qeo_validate_chart_derived_hourly_manifests`.

`qeo_prune_verified_chart_daily_partition` must not be removed merely because it was found by a broad chart-storage search; QEO-238 removes only objects whose semantics are exclusively intraday. The implementation phase must verify every routine signature and dependency from the live catalog before writing the final drop list.

Known intraday FK ordering is:

- `chart_ohlcv_derived_hourly_readiness.source_manifest_id -> chart_ohlcv_cold_manifests` (`ON DELETE CASCADE`);
- `chart_ohlcv_derived_hourly.source_manifest_id -> chart_ohlcv_cold_manifests` (`ON DELETE RESTRICT`);
- `chart_ohlcv_backfill_ranges.success_provenance_batch_id -> chart_ohlcv_provenance_batches`;
- `chart_ohlcv_cold_manifests.provenance_batch_id -> chart_ohlcv_provenance_batches`;
- `chart_ohlcv_intraday.provenance_batch_id -> chart_ohlcv_provenance_batches`.

Therefore child tables are dropped before manifests/provenance. No migration uses blanket CASCADE.

## Storage bucket retirement

The private `chart-ohlcv` bucket is an intraday cold archive and is no longer required after the application and scheduler cutover.

Deletion occurs only after:

1. production application no longer reads intraday history;
2. archive/maintenance schedulers are disabled;
3. manifest/object count is captured as evidence;
4. no retention/archive copy is requested.

All objects in the bucket are permanently deleted. The bucket itself may then be removed if no non-intraday object exists in it. The implementation must verify bucket contents are exclusively chart intraday objects before removing the bucket container.

## Deployment and destructive rollout order

QEO-238 uses a mixed-version-safe phased rollout.

### Phase 1 — source cutover, no destructive DB removal

Ship application and operator changes that:

- expose only Daily-or-larger chart timeframes;
- normalize legacy persisted intraday timeframes to `1D`;
- reject retired API resolutions;
- remove/disable intraday maintenance and archive entry points;
- remove retired jobs from scheduler expectations;
- add regression tests pinning the new contract.

At the end of Phase 1, the old intraday DB objects still exist, so rollback to the previous application remains possible.

### Phase 2 — stop regeneration

Apply the scheduler-retirement migration and verify both intraday cron jobs are absent/inactive. Observe production logs for a bounded period and confirm no active application path reads or writes the retired intraday subsystem.

### Phase 3 — physical intraday deletion

Capture pre-delete object counts/sizes, verify no blocking sessions, then apply the explicit intraday-schema retirement migration. Remove cold Storage objects and, if exclusively intraday, the `chart-ohlcv` bucket.

Immediately read back:

- retired tables/routines/sequences/triggers are absent;
- Daily objects remain present;
- `market_ohlcv_history` row count and five-year cutoff are unchanged;
- `market_ohlcv_history_pkey` remains present;
- representative Daily reads for VCB, FPT, HPG, SSI and VNM succeed;
- database size is re-measured.

Expected DB size after removing the currently measured intraday relational stack is approximately `289.7 MB` decimal before Daily physical compaction, but this is an estimate rather than an acceptance value.

### Phase 4 — Daily physical compaction gate

Recompute the conservative rewrite estimate using post-retirement production values. The existing gate remains:

```text
estimated_peak_bytes <= 470,000,000
```

The estimate must include current database bytes plus the conservative temporary rewrite requirement for `market_ohlcv_history` and its indexes.

Run `VACUUM (FULL, ANALYZE) public.market_ohlcv_history` only if all are true:

- estimated peak passes the `470,000,000 B` gate;
- no conflicting long-running transaction/lock is present;
- relevant EOD/Daily writers are outside their active window;
- the operator has captured immediate pre-FULL counts/sizes/index state.

If any gate fails, QEO-238 records the evidence and stops without forcing the rewrite.

After a successful FULL, validate row count, oldest retained date, PK/index state, representative reads, relation size, and total DB size.

## Testing and verification

Source-level tests must pin:

- active timeframe set contains no intraday value and starts at `1D`;
- legacy intraday persisted timeframe normalizes to `1D`;
- `/api/market/ohlcv` rejects retired intraday resolutions before service invocation;
- Daily/weekly/monthly/quarterly/yearly chart aggregation still works;
- no active source import references HOT/COLD intraday writers/readers;
- scheduler catalog/reconciliation no longer expects intraday jobs;
- migration SQL explicitly names retired objects and contains no blanket `DROP ... CASCADE`;
- generated Supabase types no longer expose retired tables/RPCs after the schema migration;
- zero-to-latest migration replay remains valid.

GitHub Actions is the runtime verification environment under the QeoIndex inline-only policy. Required gates include the repository Verify workflow, DB Drift zero-to-latest/generated-types checks, Daily/EOD regression contracts, and active Stock Detail chart UI contracts updated for the new timeframe set.

Production acceptance after deployment verifies Daily chart rendering/navigation, explicit rejection of stale intraday clients, absence of retired cron activity, and no new runtime error cluster before destructive schema deletion.

## Rollback policy

Before Phase 3, rollback is application-only: the intraday tables remain available while the previous production build could be restored.

After Phase 3, rollback does **not** promise restoration of intraday history. The user explicitly chose permanent deletion with no archive. A rollback after schema retirement may restore code/schema definitions from repository migrations, but historical 1m/HOT/COLD data is intentionally unrecoverable unless an external managed database backup happens to exist.

Daily OHLCV remains protected by the independent QEO-236 five-year canonical contract and is not deleted by QEO-238.

## Acceptance criteria

QEO-238 is complete only when all of the following are evidenced:

- Stock Detail active timeframes are exactly `1D, 3D, 1W, 1M, 1Q, 1Y`.
- Stale intraday UI/API input fails closed or normalizes to `1D` only at the persisted-user-state boundary; it never reads/writes intraday storage.
- Intraday cron jobs and regeneration paths are retired.
- Intraday relational tables, functions/RPCs, triggers, and sequences are absent without blind CASCADE.
- `chart-ohlcv` cold objects are permanently removed and bucket state is reconciled.
- QEO-236 rolling five-year Daily data remains unchanged logically.
- Post-retirement database size is measured and recorded.
- Targeted Daily `VACUUM FULL` runs only if the 470 MB peak gate and lock/session checks pass; otherwise the stop decision is recorded.
- Post-maintenance Daily read canaries and index checks pass.
- migration ledger/evidence is reconciled and Linear QEO-238 contains the final production evidence.