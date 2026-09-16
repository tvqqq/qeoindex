begin;

-- QEO-236: canonical Daily OHLCV is intentionally bounded to a rolling
-- five-calendar-year production window. This is permanent retention cleanup;
-- no Daily cold/archive copy is required by this contract.
create or replace function public.qeo_prune_daily_ohlcv_history(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_started_at timestamptz := clock_timestamp();
  v_daily_cutoff timestamptz := (
    (date_trunc('day', p_reference_at at time zone 'Asia/Ho_Chi_Minh') - interval '5 years')
      at time zone 'Asia/Ho_Chi_Minh'
  );
  v_deleted bigint := 0;
  v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('qeoindex.daily_history_retention', 0));

  delete from public.market_ohlcv_history
  where timeframe = '1D'
    and bar_time < v_daily_cutoff;
  get diagnostics v_deleted = row_count;

  select min(bar_time)
  into v_oldest
  from public.market_ohlcv_history
  where timeframe = '1D';

  return jsonb_build_object(
    'status', 'succeeded',
    'table', 'market_ohlcv_history',
    'referenceAt', p_reference_at,
    'cutoff', v_daily_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'rolling 5 calendar years',
    'durationMs', greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::bigint)
  );
end;
$function$;

revoke all on function public.qeo_prune_daily_ohlcv_history(timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_prune_daily_ohlcv_history(timestamptz) to service_role;

comment on function public.qeo_prune_daily_ohlcv_history(timestamptz) is
  'QEO-236 service-role-only idempotent canonical Daily OHLCV retention: rolling 5 calendar years using the Vietnam-local reference date.';

commit;
