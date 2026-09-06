begin;

create or replace function public.qeo_prune_verified_chart_daily_partition(
  p_manifest_id uuid,
  p_expected_sha256 text,
  p_expected_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_hot_rows bigint := 0;
  v_deleted bigint := 0;
begin
  if p_expected_row_count is null or p_expected_row_count <= 0 then
    raise exception 'QEO-106 Daily prune requires a positive expected row count';
  end if;

  select * into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;

  if not found then
    raise exception 'QEO-106 Daily prune manifest not found: %', p_manifest_id;
  end if;

  if v_manifest.base_resolution <> '1D'
     or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.row_count <> p_expected_row_count then
    raise exception 'QEO-106 Daily prune manifest verification mismatch: %', p_manifest_id;
  end if;

  select count(*) into v_hot_rows
  from public.market_ohlcv_history h
  where h.ticker = v_manifest.ticker
    and h.timeframe = '1D'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;

  if v_hot_rows <> p_expected_row_count then
    raise exception 'QEO-106 Daily hot row-count mismatch before prune: manifest %, expected %, found %', p_manifest_id, p_expected_row_count, v_hot_rows;
  end if;

  delete from public.market_ohlcv_history h
  where h.ticker = v_manifest.ticker
    and h.timeframe = '1D'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;
  get diagnostics v_deleted = row_count;

  if v_deleted <> p_expected_row_count then
    raise exception 'QEO-106 Daily atomic prune mismatch: manifest %, expected %, deleted %', p_manifest_id, p_expected_row_count, v_deleted;
  end if;

  return jsonb_build_object(
    'status','pruned',
    'manifestId',p_manifest_id,
    'ticker',v_manifest.ticker,
    'rangeStart',v_manifest.range_start,
    'rangeEnd',v_manifest.range_end,
    'deletedRows',v_deleted,
    'sha256',v_manifest.sha256
  );
end;
$function$;

revoke all on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) to service_role;

comment on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) is 'QEO-106 fail-closed Daily hot prune requiring an exact verified 1D cold manifest and exact PostgreSQL row count.';

commit;
