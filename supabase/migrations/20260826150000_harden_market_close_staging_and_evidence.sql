begin;

-- 1. Recreate staging table with compound staging_key
drop table if exists public.market_insight_snapshot_staging;
create table public.market_insight_snapshot_staging (
  run_id uuid not null references public.market_insight_sync_runs(id) on delete cascade,
  category text not null check (category in ('daily', 'index', 'sector', 'leader')),
  staging_key text not null,
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (run_id, staging_key)
);

alter table public.market_insight_snapshot_staging enable row level security;
revoke all privileges on table public.market_insight_snapshot_staging from anon, authenticated;
grant all privileges on table public.market_insight_snapshot_staging to service_role;

-- 2. Add module/row-level evidence, timestamps, quality flags and missing fields
alter table public.market_insight_daily
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  add column if not exists source_timestamp timestamptz;

alter table public.market_insight_indexes
  add column if not exists quality_status text not null default 'healthy' check (quality_status in ('healthy', 'degraded', 'stale')),
  add column if not exists missing_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_fields) = 'array'),
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  add column if not exists source_timestamp timestamptz;

alter table public.market_insight_sectors
  add column if not exists quality_status text not null default 'healthy' check (quality_status in ('healthy', 'degraded', 'stale')),
  add column if not exists missing_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_fields) = 'array'),
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  add column if not exists source_timestamp timestamptz;

alter table public.market_insight_leaders
  add column if not exists quality_status text not null default 'healthy' check (quality_status in ('healthy', 'degraded', 'stale')),
  add column if not exists missing_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_fields) = 'array'),
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  add column if not exists source_timestamp timestamptz;

-- 3. Grant updated column permissions to authenticated users
revoke select on public.market_insight_daily from authenticated;
grant select (
  session_date,
  market_regime,
  sentiment_score,
  sentiment_label,
  risk_score,
  risk_label,
  distribution_count,
  distribution_window,
  above_ma10_pct,
  above_ma20_pct,
  above_ma50_pct,
  above_ma200_pct,
  foreign_net_value,
  proprietary_net_value,
  other_flow_net_value,
  total_matched_volume,
  total_traded_value,
  quality_status,
  missing_fields,
  evidence_refs,
  source_timestamp,
  as_of,
  published_at,
  contract_version
) on public.market_insight_daily to authenticated;

revoke select on public.market_insight_indexes from authenticated;
grant select (
  session_date,
  index_code,
  value,
  change,
  change_pct,
  reference,
  open,
  high,
  low,
  matched_volume,
  traded_value,
  previous_value_change_pct,
  advances,
  unchanged,
  declines,
  ceilings,
  floors,
  market_pe,
  foreign_buy_value,
  foreign_sell_value,
  foreign_net_value,
  quality_status,
  missing_fields,
  evidence_refs,
  source_timestamp,
  as_of
) on public.market_insight_indexes to authenticated;

revoke select on public.market_insight_sectors from authenticated;
grant select (
  session_date,
  sector_key,
  time_window,
  display_name,
  traded_value,
  average_change_pct,
  advances,
  unchanged,
  declines,
  rs_score,
  rotation_state,
  strength_ratio,
  momentum_ratio,
  effort_pct,
  result_pct,
  effort_result_state,
  quality_status,
  missing_fields,
  evidence_refs,
  source_timestamp,
  as_of
) on public.market_insight_sectors to authenticated;

revoke select on public.market_insight_leaders from authenticated;
grant select (
  session_date,
  category,
  rank,
  ticker,
  price,
  change_pct,
  estimated_index_points,
  metric_value,
  metric_label,
  quality_status,
  missing_fields,
  evidence_refs,
  source_timestamp,
  as_of
) on public.market_insight_leaders to authenticated;

-- 4. Recreate atomic publish function handling compound keys and module quality metadata
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
begin
  select * into v_run
  from public.market_insight_sync_runs
  where id = p_sync_run_id
  for update;

  if not found or v_run.status <> 'running' then
    raise exception 'Market insight sync run is missing or is not in running state';
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
    raise exception 'Market insight snapshot rejected: expected at least 4 index rows, got %', v_index_count;
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
    coalesce(normalized_payload->>'index_code', replace(staging_key, 'index:', '')),
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
    session_date, sector_key, time_window, display_name, traded_value,
    average_change_pct, advances, unchanged, declines, rs_score,
    rotation_state, strength_ratio, momentum_ratio, effort_pct, result_pct, effort_result_state,
    quality_status, missing_fields, evidence_refs, source_timestamp,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    coalesce(normalized_payload->>'sector_key', split_part(staging_key, ':', 2)),
    coalesce(normalized_payload->>'time_window', split_part(staging_key, ':', 3), '1d'),
    coalesce(normalized_payload->>'display_name', split_part(staging_key, ':', 2)),
    (normalized_payload->>'traded_value')::numeric,
    coalesce((normalized_payload->>'average_change_pct')::numeric, 0),
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
    session_date, category, rank, ticker, price, change_pct,
    estimated_index_points, metric_value, metric_label,
    quality_status, missing_fields, evidence_refs, source_timestamp,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    coalesce(normalized_payload->>'category', split_part(staging_key, ':', 2), 'top_volume'),
    coalesce((normalized_payload->>'rank')::smallint, nullif(split_part(staging_key, ':', 3), '')::smallint, 1),
    coalesce(normalized_payload->>'ticker', split_part(staging_key, ':', 4)),
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

  v_total_published := v_daily_count + v_index_count + v_sector_count + v_leader_count;

  -- 7. Update sync run status
  update public.market_insight_sync_runs
  set
    status = 'completed',
    staged_counts = jsonb_build_object(
      'daily', v_daily_count,
      'index', v_index_count,
      'sector', v_sector_count,
      'leader', v_leader_count
    ),
    published_counts = jsonb_build_object(
      'daily', v_daily_count,
      'index', v_index_count,
      'sector', v_sector_count,
      'leader', v_leader_count,
      'total', v_total_published
    ),
    completed_at = now()
  where id = p_sync_run_id;

  -- 8. Clean up staging
  delete from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', p_sync_run_id,
    'session_date', v_run.session_date,
    'daily_count', v_daily_count,
    'index_count', v_index_count,
    'sector_count', v_sector_count,
    'leader_count', v_leader_count,
    'total_published', v_total_published
  );
end;
$$;

revoke all on function public.publish_market_insight_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_market_insight_snapshot(uuid) to service_role;

commit;
