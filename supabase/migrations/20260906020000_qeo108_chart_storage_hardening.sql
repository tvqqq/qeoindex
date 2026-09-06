begin;

-- QEO-108: the canonical PK already supports both forward and backward scans for
-- (ticker, base_resolution, bar_time). Production EXPLAIN evidence confirmed
-- that the duplicate DESC index is not selected for representative ASC/DESC
-- chart reads, so remove it before scaling raw 1m HOT storage to the universe.
drop index if exists public.chart_ohlcv_intraday_lookup_idx;

create or replace function public.qeo_chart_storage_capacity_report(
  p_budget_bytes bigint default 500000000
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_database_bytes bigint := pg_database_size(current_database());
  v_hot_heap_bytes bigint := pg_relation_size('public.chart_ohlcv_intraday'::regclass);
  v_hot_index_bytes bigint := pg_indexes_size('public.chart_ohlcv_intraday'::regclass);
  v_hot_total_bytes bigint := pg_total_relation_size('public.chart_ohlcv_intraday'::regclass);
  v_hot_rows bigint := 0;
  v_hot_sessions integer := 0;
  v_oldest_hot_bar timestamptz;
  v_newest_hot_bar timestamptz;
  v_cold_manifests bigint := 0;
  v_cold_rows bigint := 0;
  v_cold_bytes bigint := 0;
  v_cold_verified_through timestamptz;
  v_usage_ratio numeric;
  v_headroom_bytes bigint;
  v_status text;
begin
  if p_budget_bytes is null or p_budget_bytes <= 0 then
    raise exception 'QEO-108 capacity report requires a positive database budget';
  end if;

  select
    count(*),
    count(distinct ((bar_time at time zone 'Asia/Ho_Chi_Minh')::date)),
    min(bar_time),
    max(bar_time)
  into
    v_hot_rows,
    v_hot_sessions,
    v_oldest_hot_bar,
    v_newest_hot_bar
  from public.chart_ohlcv_intraday
  where base_resolution = '1m';

  select
    count(*),
    coalesce(sum(row_count), 0),
    coalesce(sum(byte_count), 0),
    max(range_end)
  into
    v_cold_manifests,
    v_cold_rows,
    v_cold_bytes,
    v_cold_verified_through
  from public.chart_ohlcv_cold_manifests
  where base_resolution = '1m'
    and verified_at is not null;

  v_usage_ratio := round(v_database_bytes::numeric / p_budget_bytes::numeric, 4);
  v_headroom_bytes := greatest(p_budget_bytes - v_database_bytes, 0);
  v_status := case
    when v_database_bytes >= (p_budget_bytes * 0.90)::bigint then 'BLOCK'
    when v_database_bytes >= (p_budget_bytes * 0.80)::bigint then 'WARN'
    else 'OK'
  end;

  return jsonb_build_object(
    'status', v_status,
    'budgetBytes', p_budget_bytes,
    'databaseBytes', v_database_bytes,
    'databaseUsageRatio', v_usage_ratio,
    'headroomBytes', v_headroom_bytes,
    'hotHeapBytes', v_hot_heap_bytes,
    'hotIndexBytes', v_hot_index_bytes,
    'hotTotalBytes', v_hot_total_bytes,
    'hotRows', v_hot_rows,
    'hotSessions', v_hot_sessions,
    'oldestHotBar', v_oldest_hot_bar,
    'newestHotBar', v_newest_hot_bar,
    'coldManifestCount', v_cold_manifests,
    'coldRows', v_cold_rows,
    'coldBytes', v_cold_bytes,
    'coldVerifiedThrough', v_cold_verified_through
  );
end;
$function$;

revoke all on function public.qeo_chart_storage_capacity_report(bigint) from public, anon, authenticated;
grant execute on function public.qeo_chart_storage_capacity_report(bigint) to service_role;

comment on function public.qeo_chart_storage_capacity_report(bigint) is
  'QEO-108 service-role storage guardrail for canonical raw 1m HOT/COLD capacity. Defaults to the current 500,000,000-byte project budget; callers may override after a plan upgrade.';

commit;
