begin;

-- Forward-Only Fix: Strict Full P0 Coverage Guard in publish_market_insight_snapshot
-- Replaces publish_market_insight_snapshot with complete verification of all 8 required P0 coverage keys:
-- 1. canonical_indexes = true
-- 2. market_pulse_content = true
-- 3. ma_breadth = true
-- 4. risk_indicator = true
-- 5. psychology_indicator = true
-- 6. cash_flows = true
-- 7. sector_pulse = true
-- 8. sector_breadth = true

create or replace function public.publish_market_insight_snapshot(
  p_sync_run_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.market_insight_sync_runs%rowtype;
  v_daily_count integer := 0;
  v_index_count integer := 0;
  v_sector_count integer := 0;
  v_leader_count integer := 0;
  v_total_published integer := 0;
  v_valid_indexes integer := 0;
  v_cov jsonb;
begin
  select * into v_run
  from public.market_insight_sync_runs
  where id = p_sync_run_id
  for update;

  if not found or v_run.status <> 'running' then
    raise exception 'Market insight sync run is missing or is not in running state';
  end if;

  if v_run.quality_status = 'failing' then
    raise exception 'Market insight snapshot rejected: sync run quality status is failing';
  end if;

  -- Verify all 8 P0 coverage keys in v_run.endpoint_coverage
  v_cov := coalesce(v_run.endpoint_coverage, '{}'::jsonb);

  if not coalesce((v_cov->>'canonical_indexes')::boolean, false) then
    raise exception 'Market insight snapshot rejected: canonical_indexes coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'market_pulse_content')::boolean, false) then
    raise exception 'Market insight snapshot rejected: market_pulse_content coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'ma_breadth')::boolean, false) then
    raise exception 'Market insight snapshot rejected: ma_breadth coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'risk_indicator')::boolean, false) then
    raise exception 'Market insight snapshot rejected: risk_indicator coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'psychology_indicator')::boolean, false) then
    raise exception 'Market insight snapshot rejected: psychology_indicator coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'cash_flows')::boolean, false) then
    raise exception 'Market insight snapshot rejected: cash_flows coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'sector_pulse')::boolean, false) then
    raise exception 'Market insight snapshot rejected: sector_pulse coverage is false or missing';
  end if;

  if not coalesce((v_cov->>'sector_breadth')::boolean, false) then
    raise exception 'Market insight snapshot rejected: sector_breadth coverage is false or missing';
  end if;

  -- 1. Check staging counts
  select count(*) into v_daily_count
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'daily';

  select count(*) into v_index_count
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'index';

  select count(*) into v_sector_count
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'sector';

  select count(*) into v_leader_count
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'leader';

  if v_daily_count = 0 then
    raise exception 'Market insight snapshot rejected: missing daily summary';
  end if;

  if v_index_count < 4 then
    raise exception 'Market insight snapshot rejected: expected 4 index rows, got %', v_index_count;
  end if;

  -- Check all 4 canonical index rows exist with non-null positive value
  select count(*) into v_valid_indexes
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id
    and category = 'index'
    and staging_key in ('index:VNINDEX', 'index:VN30', 'index:HNX', 'index:UPCOM')
    and (normalized_payload->>'value')::numeric > 0;

  if v_valid_indexes < 4 then
    raise exception 'Market insight snapshot rejected: 4 canonical indexes with non-null positive values required, found %', v_valid_indexes;
  end if;

  if v_sector_count = 0 then
    raise exception 'Market insight snapshot rejected: sectors are empty';
  end if;

  -- 2. Clear old data for this session date across all 4 tables
  delete from public.market_insight_daily where session_date = v_run.session_date;
  delete from public.market_insight_indexes where session_date = v_run.session_date;
  delete from public.market_insight_sectors where session_date = v_run.session_date;
  delete from public.market_insight_leaders where session_date = v_run.session_date;

  -- 3. Insert into market_insight_daily
  insert into public.market_insight_daily (
    session_date, market_regime, sentiment_score, sentiment_label,
    risk_score, risk_label, distribution_count, distribution_window,
    above_ma10_pct, above_ma20_pct, above_ma50_pct, above_ma200_pct,
    foreign_net_value, proprietary_net_value, other_flow_net_value,
    total_matched_volume, total_traded_value, quality_status, missing_fields, evidence_refs,
    source_timestamp, as_of, published_at, contract_version, sync_run_id
  )
  select
    v_run.session_date,
    coalesce(normalized_payload->>'market_regime', 'PHÂN HÓA'),
    (normalized_payload->>'sentiment_score')::numeric,
    normalized_payload->>'sentiment_label',
    (normalized_payload->>'risk_score')::numeric,
    normalized_payload->>'risk_label',
    (normalized_payload->>'distribution_count')::integer,
    coalesce(normalized_payload->>'distribution_window', '25_sessions'),
    (normalized_payload->>'above_ma10_pct')::numeric,
    (normalized_payload->>'above_ma20_pct')::numeric,
    (normalized_payload->>'above_ma50_pct')::numeric,
    (normalized_payload->>'above_ma200_pct')::numeric,
    (normalized_payload->>'foreign_net_value')::numeric,
    (normalized_payload->>'proprietary_net_value')::numeric,
    (normalized_payload->>'other_flow_net_value')::numeric,
    (normalized_payload->>'total_matched_volume')::numeric,
    (normalized_payload->>'total_traded_value')::numeric,
    coalesce(normalized_payload->>'quality_status', v_run.quality_status),
    coalesce(normalized_payload->'missing_fields', '[]'::jsonb),
    coalesce(normalized_payload->'evidence_refs', '[]'::jsonb),
    (normalized_payload->>'source_timestamp')::timestamptz,
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    now(),
    v_run.contract_version,
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'daily'
  limit 1;

  -- 4. Insert into market_insight_indexes
  insert into public.market_insight_indexes (
    session_date, index_code, value, change, change_pct,
    reference, open, high, low, matched_volume, traded_value, previous_value_change_pct,
    advances, unchanged, declines, ceilings, floors, market_pe,
    foreign_buy_value, foreign_sell_value, foreign_net_value,
    quality_status, missing_fields, evidence_refs, source_timestamp,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    normalized_payload->>'index_code',
    (normalized_payload->>'value')::numeric,
    (normalized_payload->>'change')::numeric,
    (normalized_payload->>'change_pct')::numeric,
    (normalized_payload->>'reference')::numeric,
    (normalized_payload->>'open')::numeric,
    (normalized_payload->>'high')::numeric,
    (normalized_payload->>'low')::numeric,
    (normalized_payload->>'matched_volume')::numeric,
    (normalized_payload->>'traded_value')::numeric,
    (normalized_payload->>'previous_value_change_pct')::numeric,
    coalesce((normalized_payload->>'advances')::integer, 0),
    coalesce((normalized_payload->>'unchanged')::integer, 0),
    coalesce((normalized_payload->>'declines')::integer, 0),
    coalesce((normalized_payload->>'ceilings')::integer, 0),
    coalesce((normalized_payload->>'floors')::integer, 0),
    (normalized_payload->>'market_pe')::numeric,
    (normalized_payload->>'foreign_buy_value')::numeric,
    (normalized_payload->>'foreign_sell_value')::numeric,
    (normalized_payload->>'foreign_net_value')::numeric,
    coalesce(normalized_payload->>'quality_status', 'healthy'),
    coalesce(normalized_payload->'missing_fields', '[]'::jsonb),
    coalesce(normalized_payload->'evidence_refs', '[]'::jsonb),
    (normalized_payload->>'source_timestamp')::timestamptz,
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'index';

  -- 5. Insert into market_insight_sectors
  insert into public.market_insight_sectors (
    session_date, sector_key, time_window, display_name,
    traded_value, average_change_pct, advances, unchanged, declines,
    rs_score, rotation_state, strength_ratio, momentum_ratio,
    effort_pct, result_pct, effort_result_state,
    quality_status, missing_fields, evidence_refs, source_timestamp,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    normalized_payload->>'sector_key',
    coalesce(normalized_payload->>'time_window', '1d'),
    coalesce(normalized_payload->>'display_name', normalized_payload->>'sector_key'),
    (normalized_payload->>'traded_value')::numeric,
    (normalized_payload->>'average_change_pct')::numeric,
    coalesce((normalized_payload->>'advances')::integer, 0),
    coalesce((normalized_payload->>'unchanged')::integer, 0),
    coalesce((normalized_payload->>'declines')::integer, 0),
    (normalized_payload->>'rs_score')::numeric,
    coalesce(normalized_payload->>'rotation_state', 'unknown'),
    (normalized_payload->>'strength_ratio')::numeric,
    (normalized_payload->>'momentum_ratio')::numeric,
    (normalized_payload->>'effort_pct')::numeric,
    (normalized_payload->>'result_pct')::numeric,
    normalized_payload->>'effort_result_state',
    coalesce(normalized_payload->>'quality_status', 'healthy'),
    coalesce(normalized_payload->'missing_fields', '[]'::jsonb),
    coalesce(normalized_payload->'evidence_refs', '[]'::jsonb),
    (normalized_payload->>'source_timestamp')::timestamptz,
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'sector';

  -- 6. Insert into market_insight_leaders
  insert into public.market_insight_leaders (
    session_date, category, rank, ticker,
    price, change_pct, estimated_index_points, metric_value, metric_label,
    quality_status, missing_fields, evidence_refs, source_timestamp,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    normalized_payload->>'category',
    coalesce((normalized_payload->>'rank')::integer, 1),
    normalized_payload->>'ticker',
    (normalized_payload->>'price')::numeric,
    (normalized_payload->>'change_pct')::numeric,
    (normalized_payload->>'estimated_index_points')::numeric,
    (normalized_payload->>'metric_value')::numeric,
    normalized_payload->>'metric_label',
    coalesce(normalized_payload->>'quality_status', 'healthy'),
    coalesce(normalized_payload->'missing_fields', '[]'::jsonb),
    coalesce(normalized_payload->'evidence_refs', '[]'::jsonb),
    (normalized_payload->>'source_timestamp')::timestamptz,
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'leader';

  -- 7. Update sync run status to completed
  v_total_published := v_daily_count + v_index_count + v_sector_count + v_leader_count;

  update public.market_insight_sync_runs
  set
    status = 'completed',
    completed_at = now()
  where id = p_sync_run_id;

  return jsonb_build_object(
    'ok', true,
    'session_date', v_run.session_date,
    'daily_count', v_daily_count,
    'index_count', v_index_count,
    'sector_count', v_sector_count,
    'leader_count', v_leader_count,
    'total_published', v_total_published
  );
end;
$$;

commit;
