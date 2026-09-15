# QEO-234 Daily provenance maintenance runbook

This runbook governs the production transition from duplicated inline Daily provenance to compact `provenance_id` references. It is intentionally fail-closed. Source-plan approval does **not** authorize production mutation.

## Authorization boundaries

The following are separate approvals and must not be inferred from one another:

1. **Stage-1 bridge promotion** — apply only `qeo234_daily_provenance_bridge` while the QEO-233-compatible app remains deployed.
2. **Application merge/deploy** — merge/deploy compact-writer code only after bridge readback succeeds.
3. **Stage-2 maintenance cutover** — pause Daily writers and apply the destructive column-drop migration only after the production compact-write canary passes and the user explicitly approves maintenance.
4. **Physical reclaim / index removal** — any permanent index drop or `VACUUM FULL` requires its own explicit authorization after measured capacity and benchmark gates pass.

Never combine these approvals. Never use UpCloud or another production host as an ad-hoc development/test runner.

## Stage-1 production acceptance

Before bridge promotion capture:

```sql
select
  count(*)::bigint as row_count,
  count(*) filter (where provenance_id is null)::bigint as pending_rows
from public.market_ohlcv_history;

select count(*)::bigint as mismatch_or_orphan_rows
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id
where history.provenance_id is null
   or registry.id is null
   or history.provider is distinct from registry.provider
   or history.provider_detail is distinct from registry.provider_detail
   or history.source_url is distinct from registry.source_url;
```

Stop unless pending and mismatch/orphan counts are both zero. Apply only the bridge migration, then prove:

- `provider_detail` and `source_url` are nullable on the fact table;
- the consistency guard accepts null long fields only for a valid registry reference/provider;
- `market_ohlcv_history_compat` returns exact registry-backed logical provenance;
- `qeo_market_ohlcv_recent`, both Daily integrity RPCs, and grouped Daily reads use compatibility data;
- grouped rows remain positional width 10;
- the old app still reads/writes successfully.

After the compact-writer app is explicitly merged/deployed, run the machine canary for `VCB`, `FPT`, `HPG`, `SSI`, and `VNM`. Every result must be HTTP 200 with a positive provenance ID, `bridgeLegacyColumnsPresent=true`, `bridgeLegacyColumnsNull=true`, and `logicalProvenancePreserved=true`.

## Stage-2 preflight baseline

Writers must still be enabled during baseline capture. Stop immediately on any pending reference, orphan, provider mismatch, logical inconsistency, or unexpected direct dependency on the legacy columns.

### Deterministic logical digest

Production has `pgcrypto` under schema `extensions`; call it explicitly.

```sql
with logical_rows as (
  select
    ticker,
    timeframe,
    bar_time,
    open,
    high,
    low,
    close,
    volume,
    provider,
    provider_detail,
    source_url,
    fetched_at
  from public.market_ohlcv_history_compat
  where provenance_consistent is true
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

Record the exact output and do not proceed if the logical row count differs from the fact row count.

### Capacity baseline

```sql
select
  pg_database_size(current_database()) as database_bytes,
  pg_relation_size('public.market_ohlcv_history') as heap_bytes,
  pg_indexes_size('public.market_ohlcv_history') as index_bytes,
  pg_total_relation_size('public.market_ohlcv_history') as total_bytes;
```

Also record live/dead tuple estimates and last analyze/vacuum timestamps from `pg_stat_user_tables`.

### Provenance gates

```sql
select count(*)::bigint as pending_rows
from public.market_ohlcv_history
where provenance_id is null;

select count(*)::bigint as orphan_rows
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id
where history.provenance_id is not null
  and registry.id is null;

select count(*)::bigint as provider_mismatch_rows
from public.market_ohlcv_history history
join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id
where history.provider is distinct from registry.provider;

select count(*)::bigint as compat_inconsistent_rows
from public.market_ohlcv_history_compat
where provenance_consistent is not true;
```

Every count must be zero.

### Live dependency proof

This check is against live database object definitions, not historical migration/spec text. Review every returned object; Stage 2 must stop if an active runtime definition still depends directly on `market_ohlcv_history.provider_detail` or `market_ohlcv_history.source_url` rather than the compatibility view/registry.

```sql
select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind,
  pg_get_viewdef(c.oid, true) as definition
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v', 'm')
  and pg_get_viewdef(c.oid, true) ~* 'market_ohlcv_history';

select
  n.nspname as schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where pg_get_functiondef(p.oid) ~* 'market_ohlcv_history';

select
  trigger_row.tgname,
  pg_get_triggerdef(trigger_row.oid, true) as definition
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid = 'public.market_ohlcv_history'::regclass
  and not trigger_row.tgisinternal;
```

## Maintenance writer pause

After explicit Stage-2 approval and immediately before destructive DDL:

```sql
revoke insert, update on table public.market_ohlcv_history from service_role;
```

Prove a service-role write fails while ordinary reads remain healthy. Keep writers paused until all applicable post-cutover checks pass.

Restore only after acceptance:

```sql
grant insert, update on table public.market_ohlcv_history to service_role;
```

## Apply Stage-2 logical cutover

Apply only `qeo234_daily_provenance_cutover`. The migration itself must:

- assert zero pending/orphan/provider/legacy mismatch rows;
- replace the consistency trigger/function before dropping long columns;
- make the compatibility view registry-only for long provenance;
- retire the historical QEO-233 backfill RPC;
- enforce `provenance_id NOT NULL`;
- drop only `provider_detail` and `source_url` from the fact table;
- preserve `provider`, `fetched_at`, OHLCV, the restrictive provenance FK, and grouped width-10 logical ABI;
- perform no physical rewrite, index drop, fact DELETE, or TRUNCATE.

Before any physical reclaim, repeat the row count and logical digest. They must exactly equal the pre-cutover values.

## Lookup-index benchmark

The candidate `market_ohlcv_history_lookup_idx` must not be dropped based on key similarity alone. Capture a baseline for at least `VCB`, `FPT`, `HPG`, `SSI`, and `VNM`:

```sql
explain (analyze, buffers, format json)
select
  ticker,
  timeframe,
  bar_time,
  open,
  high,
  low,
  close,
  volume,
  provider,
  fetched_at,
  provenance_id
from public.market_ohlcv_history
where ticker = 'VCB'
  and timeframe = '1D'
order by bar_time desc
limit 260;
```

Repeat with each representative ticker, then perform only a transactional experiment:

```sql
begin;
drop index public.market_ohlcv_history_lookup_idx;

-- Repeat the exact same EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) statements.

rollback;
```

A permanent index drop is allowed only under separate authorization and only if **every** representative query:

- avoids a sequential scan;
- has execution time no worse than `2x` its own baseline;
- remains below `20 ms` absolute execution time.

If any query fails a threshold, retain the index.

## Physical capacity gate

Run an ordinary maintenance vacuum/analyze first and remeasure sizes:

```sql
vacuum (analyze) public.market_ohlcv_history;
```

Ordinary VACUUM is for dead-space reuse and statistics; it does not promise physical file shrink.

Compute conservatively:

```text
estimated_rewrite_temp_bytes = estimated_compact_live_tuple_bytes * 1.6 + remaining_index_bytes * 1.25
estimated_peak_database_bytes = current_database_bytes + estimated_rewrite_temp_bytes
```

`VACUUM FULL` is **prohibited** unless both are true at the immediately preceding measurement:

```text
current_database_bytes <= 385000000
estimated_peak_database_bytes <= 470000000
```

These thresholds intentionally preserve reserve below the nominal 500 MB cap. If either gate fails, accept the logical cutover and defer physical reclaim; do not improvise a shadow table, CLUSTER, REINDEX, copy/swap, or another rewrite.

## Separately authorized physical rewrite

Only after the explicit physical-reclaim approval and successful capacity gate, issue the rewrite as a standalone maintenance statement. If the SQL interface wraps multi-statement requests in a transaction, split the timeout/session setup from the standalone `VACUUM FULL` as required by that interface.

```sql
set statement_timeout = '8min';
vacuum full public.market_ohlcv_history;
analyze public.market_ohlcv_history;
```

Never auto-retry timeout, disk, or lock failures. On failure, inspect the exact database/relation state while writers remain paused.

## Post-cutover acceptance

Before restoring writes require all applicable checks to pass:

- fact row count equals the pre-maintenance baseline;
- logical SHA-256 digest equals the pre-maintenance baseline;
- `provider_detail` and `source_url` are absent from the fact table;
- `provider`, `fetched_at`, and `provenance_id` remain non-null;
- every provenance reference resolves and `history.provider = registry.provider`;
- compatibility reads return exact registry long strings;
- grouped Daily RPC remains positional width 10;
- recent/integrity/chart/Wyckoff representative reads are healthy;
- relation/database bytes are recorded before/after;
- if an index was removed, all benchmark thresholds remain satisfied.

After write permissions are restored, run the machine canary again. Final-schema mode must report `bridgeLegacyColumnsPresent=false` and exact logical provenance preserved.

## Lossless rollback reconstruction

Rollback from the final compact schema requires writers to be paused. The registry is the source of truth for reconstructing the two long columns.

```sql
alter table public.market_ohlcv_history
  ADD COLUMN provider_detail text,
  ADD COLUMN source_url text;

update public.market_ohlcv_history history
set provider_detail = registry.provider_detail,
    source_url = registry.source_url
from public.market_ohlcv_provenance registry
where registry.id = history.provenance_id;

select count(*)::bigint as unresolved
from public.market_ohlcv_history
where provider_detail is null
   or source_url is null;

alter table public.market_ohlcv_history
  alter column provider_detail set not null,
  alter column source_url set not null;
```

Stop unless `unresolved = 0`. Then restore the reviewed QEO-233-compatible view, trigger, recent/grouped/integrity RPC definitions from repository migration source. Recompute the exact logical digest and verify grouped width-10 ABI. A legacy-compatible application build may be deployed only after those checks pass; restore writer permissions last.

## Absolute stop conditions

Do not continue maintenance when any of the following occurs:

- pending provenance reference, orphan, provider mismatch, or compatibility inconsistency is nonzero;
- a live DB consumer still depends directly on a long fact-table provenance column;
- compact writer canary fails;
- row count or logical digest changes unexpectedly;
- index experiment produces a sequential scan or fails either latency threshold;
- database size is above `385000000` before rewrite or estimated peak is above `470000000`;
- destructive DDL or rewrite exceeds its timeout or reports disk/lock failure;
- post-cutover recent/grouped/integrity/chart/Wyckoff verification fails.

Keep writers paused after a Stage-2 failure until the state is understood and either verified forward or losslessly rolled back.
