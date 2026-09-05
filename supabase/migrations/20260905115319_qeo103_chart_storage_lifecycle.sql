begin;

alter table public.chart_ohlcv_cold_manifests
  add column if not exists format_version smallint not null default 1 check (format_version = 1),
  add column if not exists byte_count bigint check (byte_count is null or byte_count > 0);

create table if not exists public.chart_ohlcv_derived_hourly (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  resolution text not null default '1h' check (resolution = '1h'),
  bar_time timestamptz not null,
  open double precision not null check (open > 0),
  high double precision not null check (high > 0),
  low double precision not null check (low > 0),
  close double precision not null check (close > 0),
  volume double precision not null check (volume >= 0),
  source_manifest_id uuid not null references public.chart_ohlcv_cold_manifests(id) on delete restrict,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_range_start timestamptz not null,
  source_range_end timestamptz not null,
  source_raw_row_count integer not null check (source_raw_row_count > 0),
  aggregation_version text not null default 'vn-session-v1' check (aggregation_version = 'vn-session-v1'),
  generated_at timestamptz not null default now(),
  primary key (ticker, resolution, bar_time),
  check (source_range_end >= source_range_start),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create index if not exists chart_ohlcv_derived_hourly_lookup_idx
  on public.chart_ohlcv_derived_hourly (ticker, resolution, bar_time desc);
create index if not exists chart_ohlcv_derived_hourly_manifest_idx
  on public.chart_ohlcv_derived_hourly (source_manifest_id);

alter table public.chart_ohlcv_derived_hourly enable row level security;
revoke all privileges on table public.chart_ohlcv_derived_hourly from public, anon, authenticated;
grant all privileges on table public.chart_ohlcv_derived_hourly to service_role;

create or replace function public.qeo_prune_verified_chart_intraday_partition(
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
    raise exception 'QEO-103 prune requires a positive expected row count';
  end if;

  select * into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;

  if not found then raise exception 'QEO-103 prune manifest not found: %', p_manifest_id; end if;

  if v_manifest.base_resolution <> '1m'
     or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.row_count <> p_expected_row_count then
    raise exception 'QEO-103 prune manifest verification mismatch: %', p_manifest_id;
  end if;

  if not exists (
    select 1 from public.chart_ohlcv_derived_hourly h
    where h.source_manifest_id = p_manifest_id
      and h.ticker = v_manifest.ticker
      and h.source_sha256 = v_manifest.sha256
  ) then
    raise exception 'QEO-103 derived hourly cache missing for manifest: %', p_manifest_id;
  end if;

  select count(*) into v_hot_rows
  from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker
    and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;

  if v_hot_rows <> p_expected_row_count then
    raise exception 'QEO-103 hot row-count mismatch before prune: manifest %, expected %, found %', p_manifest_id, p_expected_row_count, v_hot_rows;
  end if;

  delete from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker
    and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;
  get diagnostics v_deleted = row_count;

  if v_deleted <> p_expected_row_count then
    raise exception 'QEO-103 atomic prune mismatch: manifest %, expected %, deleted %', p_manifest_id, p_expected_row_count, v_deleted;
  end if;

  return jsonb_build_object('status','pruned','manifestId',p_manifest_id,'ticker',v_manifest.ticker,'rangeStart',v_manifest.range_start,'rangeEnd',v_manifest.range_end,'deletedRows',v_deleted,'sha256',v_manifest.sha256);
end;
$function$;

revoke all on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer) to service_role;

comment on table public.chart_ohlcv_derived_hourly is 'QEO-103 rebuildable 1h cache derived deterministically from verified canonical raw 1m cold manifests. Never canonical.';
comment on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer) is 'QEO-103 fail-closed service-role prune requiring verified cold manifest, derived 1h cache, and exact hot row count.';

commit;
