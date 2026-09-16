-- QEO-238 phase 2: retire the isolated stock-chart intraday persistence graph.
-- Preconditions enforced operationally before production promotion:
--   1) Daily-only app contract is live;
--   2) QEO-238 phase-1 scheduler retirement is verified;
--   3) chart-ohlcv Storage objects have been removed through the Storage API.
--
-- Do not add CASCADE here. Every live intraday-only dependency is retired
-- explicitly so an unexpected dependency fails the migration closed.

-- QEO-236 owns rolling five-calendar-year Daily retention and no longer keeps a
-- Daily cold/archive copy. Preserve this historical RPC signature as a
-- deterministic tombstone instead of leaving it dependent on the shared cold
-- manifest table that QEO-238 removes.
create or replace function public.qeo_prune_verified_chart_daily_partition(
  p_manifest_id uuid,
  p_expected_sha256 text,
  p_expected_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QEO-238: legacy Daily cold-archive prune is retired; QEO-236 rolling five-year retention is canonical';
end;
$$;

revoke all on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) to service_role;

-- Explicit user triggers first.
drop trigger if exists qeo147_chart_derived_hourly_content_identity on public.chart_ohlcv_derived_hourly;
drop trigger if exists qeo147_chart_derived_hourly_readiness_invalidation on public.chart_ohlcv_derived_hourly;
drop trigger if exists qeo149_chart_intraday_content_identity on public.chart_ohlcv_intraday;

-- Intraday range / HOT writer functions.
drop function if exists public.qeo_abandon_chart_intraday_range(uuid, uuid, bigint, text);
drop function if exists public.qeo_chart_intraday_success_coverage(text, text, timestamptz, timestamptz);
drop function if exists public.qeo_claim_chart_intraday_range(text, text, timestamptz, timestamptz, uuid, boolean, integer);
drop function if exists public.qeo_complete_chart_intraday_range(uuid, uuid, bigint, text, integer, uuid, text);
drop function if exists public.qeo_upsert_chart_intraday_bars(text, jsonb);
drop function if exists public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]);
drop function if exists public.qeo_ensure_chart_intraday_session_partition_locked(date);

-- Intraday coverage/capacity helpers.
drop function if exists public.qeo_chart_intraday_coverage(text[], timestamptz);
drop function if exists public.qeo_chart_intraday_session_coverage(text[], timestamptz);
drop function if exists public.qeo_chart_storage_capacity();
drop function if exists public.qeo_chart_intraday_backfill_lock_key(text, text);
drop function if exists public.qeo_chart_intraday_session_lock_key(date);
drop function if exists public.qeo_chart_intraday_row_content_digest(text, text, timestamptz, double precision, double precision, double precision, double precision, double precision, uuid, timestamptz, bigint);

-- Derived-hourly publication/readiness functions and helpers.
drop function if exists public.qeo_publish_chart_derived_hourly_generation(uuid, text, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid, timestamptz, jsonb);
drop function if exists public.qeo_publish_chart_derived_hourly_readiness(uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid, integer, text);
drop function if exists public.qeo_validate_chart_derived_hourly_manifests(uuid[]);
drop function if exists public.qeo_invalidate_chart_derived_hourly_readiness();
drop function if exists public.qeo_stamp_chart_derived_hourly_content_identity();
drop function if exists public.qeo_stamp_chart_intraday_content_identity();
drop function if exists public.qeo_chart_derived_hourly_manifest_lock_key(uuid);
drop function if exists public.qeo_chart_derived_hourly_row_content_digest(text, text, timestamptz, double precision, double precision, double precision, double precision, double precision, uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid);

-- Child / dependent relations first. Table-owned indexes and constraints are
-- removed with their table; no unrelated object is cascaded.
drop table if exists public.chart_ohlcv_derived_hourly_readiness;
drop table if exists public.chart_ohlcv_derived_hourly;
drop table if exists public.chart_ohlcv_backfill_ranges;
drop table if exists public.chart_ohlcv_intraday;
drop table if exists public.chart_ohlcv_cold_manifests;
drop table if exists public.chart_ohlcv_provenance_batches;

-- Known intraday-only sequence from QEO-149.
drop sequence if exists public.chart_ohlcv_intraday_content_version_seq;
