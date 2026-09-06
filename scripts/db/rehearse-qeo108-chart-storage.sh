#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
DB_CONTAINER="${QEO_Q108_DB_CONTAINER:-supabase_db_qeoindex}"
MIGRATION="supabase/pending-migrations/20260906024500_qeo108_chart_intraday_session_partitions.sql"

phase() {
  printf '\n==> QEO-108 %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ -f "$MIGRATION" ]] || fail "pending partition migration is missing"
[[ "${SUPABASE_PROJECT_REF:-}" != "$PRODUCTION_PROJECT_REF" ]] || fail "production project ref is forbidden"
command -v docker >/dev/null 2>&1 || fail "docker is required"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "local Supabase DB container $DB_CONTAINER is not running"

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

phase "seed legacy intraday fixture"
psql_local -f - <<'SQL'
do $$
begin
  if exists (
    select 1 from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    raise exception 'QEO-108 rehearsal requires the pre-cutover non-partitioned table';
  end if;
  if to_regclass('public.chart_ohlcv_intraday_qeo108_legacy') is not null then
    raise exception 'QEO-108 rehearsal found a stale rollback shadow';
  end if;
end;
$$;

insert into public.chart_ohlcv_intraday
  (ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at)
values
  ('Q108A', '1m', ((current_date - 3)::timestamp + time '09:15') at time zone 'Asia/Ho_Chi_Minh', 10.0, 10.2, 9.9, 10.1, 1000, null, now()),
  ('Q108A', '1m', ((current_date - 3)::timestamp + time '09:16') at time zone 'Asia/Ho_Chi_Minh', 10.1, 10.3, 10.0, 10.2, 1100, null, now()),
  ('Q108B', '1m', ((current_date - 2)::timestamp + time '13:00') at time zone 'Asia/Ho_Chi_Minh', 20.0, 20.4, 19.9, 20.2, 2000, null, now()),
  ('Q108B', '1m', ((current_date - 2)::timestamp + time '13:01') at time zone 'Asia/Ho_Chi_Minh', 20.2, 20.5, 20.1, 20.4, 2200, null, now());
SQL

phase "apply quarantined cutover locally"
psql_local -f - < "$MIGRATION"

phase "assert native partitions, parity, RPC rebinds, and index rationalization"
psql_local -f - <<'SQL'
do $$
declare
  v_parent_rows bigint;
  v_legacy_rows bigint;
  v_parent_checksum text;
  v_legacy_checksum text;
  v_partition_count bigint;
  v_capacity jsonb;
  v_coverage_rows bigint;
begin
  if not exists (
    select 1 from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    raise exception 'QEO-108 rehearsal: canonical table is not partitioned';
  end if;
  if to_regclass('public.chart_ohlcv_intraday_qeo108_legacy') is null then
    raise exception 'QEO-108 rehearsal: rollback shadow is missing';
  end if;

  select count(*) into v_partition_count
  from pg_inherits
  where inhparent = 'public.chart_ohlcv_intraday'::regclass;
  if v_partition_count <> 2 then
    raise exception 'QEO-108 rehearsal: expected 2 seeded partitions, found %', v_partition_count;
  end if;

  select count(*), md5(coalesce(string_agg(
    md5(concat_ws('|', ticker, base_resolution, bar_time::text, open::text, high::text, low::text,
      close::text, volume::text, coalesce(provenance_batch_id::text, ''), fetched_at::text)),
    '' order by ticker, base_resolution, bar_time
  ), ''))
  into v_parent_rows, v_parent_checksum
  from public.chart_ohlcv_intraday;

  select count(*), md5(coalesce(string_agg(
    md5(concat_ws('|', ticker, base_resolution, bar_time::text, open::text, high::text, low::text,
      close::text, volume::text, coalesce(provenance_batch_id::text, ''), fetched_at::text)),
    '' order by ticker, base_resolution, bar_time
  ), ''))
  into v_legacy_rows, v_legacy_checksum
  from public.chart_ohlcv_intraday_qeo108_legacy;

  if v_parent_rows <> 4 or v_legacy_rows <> 4 then
    raise exception 'QEO-108 rehearsal: unexpected cutover row counts canonical %, legacy %', v_parent_rows, v_legacy_rows;
  end if;
  if v_parent_checksum is distinct from v_legacy_checksum then
    raise exception 'QEO-108 rehearsal: canonical/legacy checksum mismatch';
  end if;

  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chart_ohlcv_intraday'
      and indexname = 'chart_ohlcv_intraday_lookup_idx'
  ) then
    raise exception 'QEO-108 rehearsal: redundant DESC lookup index exists on canonical parent';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chart_ohlcv_intraday_qeo108_legacy'
      and indexname = 'chart_ohlcv_intraday_lookup_idx'
  ) then
    raise exception 'QEO-108 rehearsal: legacy rollback shadow lost its original lookup index';
  end if;

  select public.qeo_chart_storage_capacity() into v_capacity;
  if coalesce((v_capacity ->> 'databaseBytes')::bigint, 0) <= 0
     or (v_capacity ->> 'hotRows')::bigint <> 4
     or (v_capacity ->> 'partitionCount')::bigint <> 2 then
    raise exception 'QEO-108 rehearsal: invalid capacity payload %', v_capacity;
  end if;

  select count(*) into v_coverage_rows
  from public.qeo_chart_intraday_coverage(
    array['Q108A', 'Q108B'],
    now() - interval '30 days'
  );
  if v_coverage_rows <> 2 then
    raise exception 'QEO-108 rehearsal: coverage RPC did not rebind to canonical parent';
  end if;

  if has_function_privilege('anon', 'public.qeo_chart_storage_capacity()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qeo_chart_storage_capacity()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_chart_storage_capacity()', 'EXECUTE') then
    raise exception 'QEO-108 rehearsal: capacity RPC grants are not service-role-only';
  end if;
end;
$$;
SQL

phase "assert deterministic empty-partition reclamation"
psql_local -f - <<'SQL'
do $$
declare
  v_date date := current_date + 1;
  v_created jsonb;
  v_dropped jsonb;
begin
  select public.qeo_ensure_chart_intraday_session_partition(v_date) into v_created;
  if v_created ->> 'status' not in ('created', 'exists') then
    raise exception 'QEO-108 rehearsal: partition provision failed %', v_created;
  end if;

  select public.qeo_drop_empty_chart_intraday_session_partition(v_date) into v_dropped;
  if v_dropped ->> 'status' <> 'dropped' then
    raise exception 'QEO-108 rehearsal: empty partition reclaim failed %', v_dropped;
  end if;
end;
$$;
SQL

phase "assert rollback shadow remains exact before production acceptance"
psql_local -f - <<'SQL'
do $$
declare
  v_delta bigint;
begin
  select count(*) into v_delta
  from (
    (select ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at
     from public.chart_ohlcv_intraday
     except
     select ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at
     from public.chart_ohlcv_intraday_qeo108_legacy)
    union all
    (select ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at
     from public.chart_ohlcv_intraday_qeo108_legacy
     except
     select ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at
     from public.chart_ohlcv_intraday)
  ) delta;
  if v_delta <> 0 then
    raise exception 'QEO-108 rehearsal: rollback shadow diverged before acceptance';
  end if;
end;
$$;
SQL

printf '\nQEO-108 local chart-storage cutover rehearsal: PASS\n'
