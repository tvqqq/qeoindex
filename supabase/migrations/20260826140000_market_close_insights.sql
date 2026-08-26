begin;

-- 1. Private operational sync runs table
create table if not exists public.market_insight_sync_runs (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  trigger text not null default 'workflow',
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  contract_version integer not null default 1 check (contract_version > 0),
  started_at timestamptz not null default now(),
  source_observed_at timestamptz,
  completed_at timestamptz,
  endpoint_coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(endpoint_coverage) = 'object'),
  staged_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(staged_counts) = 'object'),
  published_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(published_counts) = 'object'),
  payload_checksum text,
  quality_status text not null default 'healthy' check (quality_status in ('healthy', 'degraded', 'failing', 'stale')),
  sanitized_error_code text,
  sanitized_error_message text,
  created_at timestamptz not null default now()
);

-- 2. Private staging table
create table if not exists public.market_insight_snapshot_staging (
  run_id uuid not null references public.market_insight_sync_runs(id) on delete cascade,
  category text not null check (category in ('daily', 'index', 'sector', 'leader')),
  entity_key text not null,
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (run_id, category, entity_key)
);

-- 3. Authenticated read: Daily overview
create table if not exists public.market_insight_daily (
  session_date date primary key,
  market_regime text not null,
  sentiment_score numeric check (sentiment_score is null or sentiment_score between 0 and 100),
  sentiment_label text,
  risk_score numeric check (risk_score is null or risk_score between 0 and 100),
  risk_label text,
  distribution_count integer check (distribution_count is null or distribution_count >= 0),
  distribution_window text not null default '25_sessions',
  above_ma10_pct numeric check (above_ma10_pct is null or above_ma10_pct between 0 and 100),
  above_ma20_pct numeric check (above_ma20_pct is null or above_ma20_pct between 0 and 100),
  above_ma50_pct numeric check (above_ma50_pct is null or above_ma50_pct between 0 and 100),
  above_ma200_pct numeric check (above_ma200_pct is null or above_ma200_pct between 0 and 100),
  foreign_net_value numeric,
  proprietary_net_value numeric,
  other_flow_net_value numeric,
  total_matched_volume numeric check (total_matched_volume is null or total_matched_volume >= 0),
  total_traded_value numeric check (total_traded_value is null or total_traded_value >= 0),
  quality_status text not null default 'healthy' check (quality_status in ('healthy', 'degraded', 'stale')),
  missing_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_fields) = 'array'),
  as_of timestamptz not null default now(),
  published_at timestamptz not null default now(),
  contract_version integer not null default 1,
  sync_run_id uuid references public.market_insight_sync_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 4. Authenticated read: 4 Major Indexes
create table if not exists public.market_insight_indexes (
  session_date date not null,
  index_code text not null check (index_code in ('VNINDEX', 'VN30', 'HNX', 'UPCOM')),
  value numeric not null check (value > 0),
  change numeric not null,
  change_pct numeric not null,
  reference numeric check (reference is null or reference > 0),
  open numeric check (open is null or open > 0),
  high numeric check (high is null or high > 0),
  low numeric check (low is null or low > 0),
  matched_volume numeric check (matched_volume is null or matched_volume >= 0),
  traded_value numeric check (traded_value is null or traded_value >= 0),
  previous_value_change_pct numeric,
  advances integer not null default 0 check (advances >= 0),
  unchanged integer not null default 0 check (unchanged >= 0),
  declines integer not null default 0 check (declines >= 0),
  ceilings integer not null default 0 check (ceilings >= 0),
  floors integer not null default 0 check (floors >= 0),
  market_pe numeric check (market_pe is null or market_pe >= 0),
  foreign_buy_value numeric check (foreign_buy_value is null or foreign_buy_value >= 0),
  foreign_sell_value numeric check (foreign_sell_value is null or foreign_sell_value >= 0),
  foreign_net_value numeric,
  as_of timestamptz not null default now(),
  sync_run_id uuid references public.market_insight_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_date, index_code)
);

-- 5. Authenticated read: Sectors
create table if not exists public.market_insight_sectors (
  session_date date not null,
  sector_key text not null check (sector_key ~ '^[a-z0-9_]+$'),
  time_window text not null default '1d' check (time_window in ('1d', '5d', '20d')),
  display_name text not null,
  traded_value numeric check (traded_value is null or traded_value >= 0),
  average_change_pct numeric not null,
  advances integer not null default 0 check (advances >= 0),
  unchanged integer not null default 0 check (unchanged >= 0),
  declines integer not null default 0 check (declines >= 0),
  rs_score numeric check (rs_score is null or rs_score between 0 and 100),
  rotation_state text not null default 'unknown' check (rotation_state in ('leading', 'recovering', 'weakening', 'lagging', 'unknown')),
  strength_ratio numeric check (strength_ratio is null or strength_ratio >= 0),
  momentum_ratio numeric check (momentum_ratio is null or momentum_ratio >= 0),
  effort_pct numeric check (effort_pct is null or effort_pct between 0 and 100),
  result_pct numeric check (result_pct is null or result_pct between -100 and 100),
  effort_result_state text,
  as_of timestamptz not null default now(),
  sync_run_id uuid references public.market_insight_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_date, sector_key, time_window)
);

-- 6. Authenticated read: Leaders & Impact
create table if not exists public.market_insight_leaders (
  session_date date not null,
  category text not null check (category in ('index_up', 'index_down', 'top_volume', 'near_52w_high', 'accumulation', 'cross_ma10', 'foreign_buy', 'foreign_sell')),
  rank smallint not null check (rank between 1 and 50),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  price numeric check (price is null or price >= 0),
  change_pct numeric,
  estimated_index_points numeric,
  metric_value numeric,
  metric_label text,
  as_of timestamptz not null default now(),
  sync_run_id uuid references public.market_insight_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_date, category, rank, ticker)
);

-- Indexes for performance
create index if not exists market_insight_sync_runs_started_idx
  on public.market_insight_sync_runs(started_at desc);

create index if not exists market_insight_sync_runs_session_idx
  on public.market_insight_sync_runs(session_date desc);

create index if not exists market_insight_daily_session_idx
  on public.market_insight_daily(session_date desc);

create index if not exists market_insight_indexes_session_idx
  on public.market_insight_indexes(session_date desc, index_code);

create index if not exists market_insight_sectors_session_idx
  on public.market_insight_sectors(session_date desc, time_window, rs_score desc nulls last);

create index if not exists market_insight_leaders_session_idx
  on public.market_insight_leaders(session_date desc, category, rank asc);

-- Enable RLS on all tables
alter table public.market_insight_sync_runs enable row level security;
alter table public.market_insight_snapshot_staging enable row level security;
alter table public.market_insight_daily enable row level security;
alter table public.market_insight_indexes enable row level security;
alter table public.market_insight_sectors enable row level security;
alter table public.market_insight_leaders enable row level security;

-- Revoke all permissions from anon on all tables
revoke all privileges on table public.market_insight_sync_runs from anon, authenticated;
revoke all privileges on table public.market_insight_snapshot_staging from anon, authenticated;
revoke all privileges on table public.market_insight_daily from anon, authenticated;
revoke all privileges on table public.market_insight_indexes from anon, authenticated;
revoke all privileges on table public.market_insight_sectors from anon, authenticated;
revoke all privileges on table public.market_insight_leaders from anon, authenticated;

-- Service role full access
grant all privileges on table public.market_insight_sync_runs to service_role;
grant all privileges on table public.market_insight_snapshot_staging to service_role;
grant all privileges on table public.market_insight_daily to service_role;
grant all privileges on table public.market_insight_indexes to service_role;
grant all privileges on table public.market_insight_sectors to service_role;
grant all privileges on table public.market_insight_leaders to service_role;

-- Authenticated user SELECT permissions on public read tables
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
  as_of,
  published_at,
  contract_version
) on public.market_insight_daily to authenticated;

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
  as_of
) on public.market_insight_indexes to authenticated;

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
  as_of
) on public.market_insight_sectors to authenticated;

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
  as_of
) on public.market_insight_leaders to authenticated;

-- RLS policies for authenticated users
create policy "Authenticated users can read published market_insight_daily"
  on public.market_insight_daily
  for select
  to authenticated
  using (true);

create policy "Authenticated users can read published market_insight_indexes"
  on public.market_insight_indexes
  for select
  to authenticated
  using (true);

create policy "Authenticated users can read published market_insight_sectors"
  on public.market_insight_sectors
  for select
  to authenticated
  using (true);

create policy "Authenticated users can read published market_insight_leaders"
  on public.market_insight_leaders
  for select
  to authenticated
  using (true);

-- Atomic publication procedure
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

  -- 1. Check staging rows
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
    total_matched_volume, total_traded_value, quality_status, missing_fields,
    as_of, published_at, contract_version, sync_run_id
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
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    entity_key,
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
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'index';

  -- 5. Insert into market_insight_sectors
  insert into public.market_insight_sectors (
    session_date, sector_key, time_window, display_name, traded_value,
    average_change_pct, advances, unchanged, declines, rs_score,
    rotation_state, strength_ratio, momentum_ratio, effort_pct, result_pct, effort_result_state,
    as_of, sync_run_id
  )
  select
    v_run.session_date,
    entity_key,
    coalesce(normalized_payload->>'time_window', '1d'),
    coalesce(normalized_payload->>'display_name', entity_key),
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
    coalesce((normalized_payload->>'as_of')::timestamptz, now()),
    p_sync_run_id
  from public.market_insight_snapshot_staging
  where run_id = p_sync_run_id and category = 'sector';

  -- 6. Insert into market_insight_leaders
  insert into public.market_insight_leaders (
    session_date, category, rank, ticker, price, change_pct,
    estimated_index_points, metric_value, metric_label, as_of, sync_run_id
  )
  select
    v_run.session_date,
    coalesce(normalized_payload->>'category', 'top_volume'),
    coalesce((normalized_payload->>'rank')::smallint, 1),
    entity_key,
    (normalized_payload->>'price')::numeric,
    (normalized_payload->>'change_pct')::numeric,
    (normalized_payload->>'estimated_index_points')::numeric,
    (normalized_payload->>'metric_value')::numeric,
    normalized_payload->>'metric_label',
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
