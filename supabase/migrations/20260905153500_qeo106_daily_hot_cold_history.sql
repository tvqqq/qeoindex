begin;

-- QEO-106: reuse the verified chart cold-manifest boundary for canonical Daily.
-- Existing 1m semantics stay unchanged; 1D adds a second canonical base resolution.
alter table public.chart_ohlcv_cold_manifests
  drop constraint if exists chart_ohlcv_cold_manifests_base_resolution_check;

alter table public.chart_ohlcv_cold_manifests
  add constraint chart_ohlcv_cold_manifests_base_resolution_check
  check (base_resolution in ('1m', '1D')),
  add column if not exists provenance jsonb not null default '{}'::jsonb;

create table if not exists public.chart_daily_history_state (
  ticker text primary key check (ticker ~ '^[A-Z0-9]{2,12}$'),
  earliest_hot_bar timestamptz,
  earliest_cold_bar timestamptz,
  left_edge_status text not null default 'IN_PROGRESS'
    check (left_edge_status in ('IN_PROGRESS','PROVIDER_BOUNDARY','LISTING_BOUNDARY','UNRECOVERABLE','RETRYABLE_ERROR')),
  boundary_time timestamptz,
  provider text,
  last_window_from timestamptz,
  last_window_to timestamptz,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (earliest_hot_bar is null or earliest_hot_bar > '1970-01-01'::timestamptz),
  check (earliest_cold_bar is null or earliest_cold_bar > '1970-01-01'::timestamptz)
);

create index if not exists chart_daily_history_state_status_idx
  on public.chart_daily_history_state (left_edge_status, updated_at);

alter table public.chart_daily_history_state enable row level security;
revoke all privileges on table public.chart_daily_history_state from public, anon, authenticated;
grant all privileges on table public.chart_daily_history_state to service_role;

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

comment on table public.chart_daily_history_state is 'QEO-106 resumable canonical Daily full-history left-edge state across PostgreSQL hot and Storage cold tiers.';
comment on function public.qeo_prune_verified_chart_daily_partition(uuid, text, integer) is 'QEO-106 fail-closed Daily hot prune requiring an exact verified 1D cold manifest and exact PostgreSQL row count.';

commit;
