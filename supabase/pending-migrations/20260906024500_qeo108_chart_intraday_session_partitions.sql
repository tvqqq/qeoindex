begin;

-- QEO-108 destructive storage cutover is intentionally quarantined until a
-- non-production rehearsal proves copy/checksum parity and rollback behavior.
lock table public.chart_ohlcv_intraday in access exclusive mode;

do $$
begin
  if to_regclass('public.chart_ohlcv_intraday_qeo108_legacy') is not null then
    raise exception 'QEO-108 cutover blocked: rollback shadow chart_ohlcv_intraday_qeo108_legacy already exists';
  end if;
  if exists (
    select 1 from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    raise exception 'QEO-108 cutover blocked: chart_ohlcv_intraday is already partitioned';
  end if;
end;
$$;

create table public.chart_ohlcv_intraday_qeo108_new (
  ticker text not null,
  base_resolution text not null,
  bar_time timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null,
  provenance_batch_id uuid null references public.chart_ohlcv_provenance_batches(id) on delete set null,
  fetched_at timestamptz not null default now(),
  constraint chart_ohlcv_intraday_qeo108_new_resolution_check check (base_resolution = '1m'),
  constraint chart_ohlcv_intraday_qeo108_new_ticker_check check (ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint chart_ohlcv_intraday_qeo108_new_open_check check (open > 0),
  constraint chart_ohlcv_intraday_qeo108_new_high_check check (high > 0),
  constraint chart_ohlcv_intraday_qeo108_new_low_check check (low > 0),
  constraint chart_ohlcv_intraday_qeo108_new_close_check check (close > 0),
  constraint chart_ohlcv_intraday_qeo108_new_volume_check check (volume >= 0),
  constraint chart_ohlcv_intraday_qeo108_new_high_ohlc_check check (high >= greatest(open, close, low)),
  constraint chart_ohlcv_intraday_qeo108_new_low_ohlc_check check (low <= least(open, close, high)),
  constraint chart_ohlcv_intraday_qeo108_new_pkey primary key (ticker, base_resolution, bar_time)
) partition by range (bar_time);

alter table public.chart_ohlcv_intraday_qeo108_new enable row level security;
revoke all on table public.chart_ohlcv_intraday_qeo108_new from public, anon, authenticated;
grant select, insert, update, delete on table public.chart_ohlcv_intraday_qeo108_new to service_role;

-- Create only partitions that contain source rows. Bounds are Vietnam local
-- calendar dates, so every child maps to one physical market session/date.
do $$
declare
  v_date date;
  v_name text;
  v_from timestamptz;
  v_to timestamptz;
begin
  for v_date in
    select distinct (bar_time at time zone 'Asia/Ho_Chi_Minh')::date
    from public.chart_ohlcv_intraday
    order by 1
  loop
    v_name := 'chart_ohlcv_intraday_' || to_char(v_date, 'YYYYMMDD');
    v_from := v_date::timestamp at time zone 'Asia/Ho_Chi_Minh';
    v_to := (v_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
    execute format(
      'create table public.%I partition of public.chart_ohlcv_intraday_qeo108_new for values from (%L) to (%L)',
      v_name, v_from, v_to
    );
    execute format('alter table public.%I enable row level security', v_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_name);
  end loop;
end;
$$;

-- Copy then validate identity and data before the atomic name swap.
do $$
declare
  v_source_rows bigint;
  v_target_rows bigint;
  v_source_min timestamptz;
  v_target_min timestamptz;
  v_source_max timestamptz;
  v_target_max timestamptz;
  v_source_checksum text;
  v_target_checksum text;
begin
  select count(*), min(bar_time), max(bar_time),
    md5(coalesce(string_agg(
      md5(concat_ws('|', ticker, base_resolution, bar_time::text, open::text, high::text, low::text,
        close::text, volume::text, coalesce(provenance_batch_id::text, ''), fetched_at::text)),
      '' order by ticker, base_resolution, bar_time
    ), ''))
  into v_source_rows, v_source_min, v_source_max, v_source_checksum
  from public.chart_ohlcv_intraday;

  insert into public.chart_ohlcv_intraday_qeo108_new
    (ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at)
  select ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at
  from public.chart_ohlcv_intraday
  order by ticker, base_resolution, bar_time;

  select count(*), min(bar_time), max(bar_time),
    md5(coalesce(string_agg(
      md5(concat_ws('|', ticker, base_resolution, bar_time::text, open::text, high::text, low::text,
        close::text, volume::text, coalesce(provenance_batch_id::text, ''), fetched_at::text)),
      '' order by ticker, base_resolution, bar_time
    ), ''))
  into v_target_rows, v_target_min, v_target_max, v_target_checksum
  from public.chart_ohlcv_intraday_qeo108_new;

  if v_source_rows <> v_target_rows then
    raise exception 'QEO-108 row-count mismatch during partition cutover: source %, target %', v_source_rows, v_target_rows;
  end if;
  if v_source_min is distinct from v_target_min or v_source_max is distinct from v_target_max then
    raise exception 'QEO-108 range mismatch during partition cutover: source [% - %], target [% - %]',
      v_source_min, v_source_max, v_target_min, v_target_max;
  end if;
  if v_source_checksum is distinct from v_target_checksum then
    raise exception 'QEO-108 checksum mismatch during partition cutover: source %, target %', v_source_checksum, v_target_checksum;
  end if;
end;
$$;

alter table public.chart_ohlcv_intraday rename to chart_ohlcv_intraday_qeo108_legacy;
alter table public.chart_ohlcv_intraday_qeo108_new rename to chart_ohlcv_intraday;

-- Preserve rollback evidence. The legacy shadow, including its original DESC
-- lookup index, is intentionally retained until post-cutover acceptance.
alter table public.chart_ohlcv_intraday enable row level security;
revoke all on table public.chart_ohlcv_intraday from public, anon, authenticated;
grant select, insert, update, delete on table public.chart_ohlcv_intraday to service_role;

create or replace function public.qeo_ensure_chart_intraday_session_partition(p_trading_date date)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_name text;
  v_from timestamptz;
  v_to timestamptz;
  v_child regclass;
begin
  if p_trading_date is null or p_trading_date < date '2000-01-01' or p_trading_date > current_date + 7 then
    raise exception 'QEO-108 invalid intraday partition date: %', p_trading_date;
  end if;
  if not exists (
    select 1 from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    return jsonb_build_object('status', 'legacy_unpartitioned', 'tradingDate', p_trading_date);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qeo108-chart-session:' || p_trading_date::text, 0));
  v_name := 'chart_ohlcv_intraday_' || to_char(p_trading_date, 'YYYYMMDD');
  v_child := to_regclass('public.' || v_name);
  if v_child is not null then
    if not exists (
      select 1 from pg_inherits
      where inhparent = 'public.chart_ohlcv_intraday'::regclass and inhrelid = v_child
    ) then
      raise exception 'QEO-108 partition name collision: %', v_name;
    end if;
    return jsonb_build_object('status', 'exists', 'tradingDate', p_trading_date, 'partition', v_name);
  end if;

  v_from := p_trading_date::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (p_trading_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  execute format(
    'create table public.%I partition of public.chart_ohlcv_intraday for values from (%L) to (%L)',
    v_name, v_from, v_to
  );
  execute format('alter table public.%I enable row level security', v_name);
  execute format('revoke all on table public.%I from public, anon, authenticated', v_name);
  execute format('grant select, insert, update, delete on table public.%I to service_role', v_name);
  return jsonb_build_object('status', 'created', 'tradingDate', p_trading_date, 'partition', v_name);
end;
$$;

create or replace function public.qeo_drop_empty_chart_intraday_session_partition(p_trading_date date)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_name text;
  v_child regclass;
  v_rows bigint;
begin
  if p_trading_date is null then
    raise exception 'QEO-108 session partition drop requires a trading date';
  end if;
  v_name := 'chart_ohlcv_intraday_' || to_char(p_trading_date, 'YYYYMMDD');
  v_child := to_regclass('public.' || v_name);
  if v_child is null then
    return jsonb_build_object('status', 'absent', 'tradingDate', p_trading_date);
  end if;
  if not exists (
    select 1 from pg_inherits
    where inhparent = 'public.chart_ohlcv_intraday'::regclass and inhrelid = v_child
  ) then
    raise exception 'QEO-108 refused to drop non-child relation: %', v_name;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qeo108-chart-session:' || p_trading_date::text, 0));
  execute format('select count(*) from public.%I', v_name) into v_rows;
  if v_rows <> 0 then
    return jsonb_build_object('status', 'blocked', 'tradingDate', p_trading_date, 'remainingRows', v_rows);
  end if;

  execute format('alter table public.chart_ohlcv_intraday detach partition public.%I', v_name);
  execute format('drop table public.%I', v_name);
  return jsonb_build_object('status', 'dropped', 'tradingDate', p_trading_date, 'remainingRows', 0);
end;
$$;

create or replace function public.qeo_chart_storage_capacity()
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_database_bytes bigint;
  v_hot_heap_bytes bigint := 0;
  v_hot_index_bytes bigint := 0;
  v_hot_rows bigint := 0;
  v_partition_count bigint := 0;
  v_oldest date;
  v_newest date;
begin
  v_database_bytes := pg_database_size(current_database());
  v_hot_heap_bytes := pg_relation_size('public.chart_ohlcv_intraday'::regclass);
  v_hot_index_bytes := pg_indexes_size('public.chart_ohlcv_intraday'::regclass);

  select
    v_hot_heap_bytes + coalesce(sum(pg_relation_size(c.oid)), 0),
    v_hot_index_bytes + coalesce(sum(pg_indexes_size(c.oid)), 0),
    count(*)::bigint
  into v_hot_heap_bytes, v_hot_index_bytes, v_partition_count
  from pg_inherits i
  join pg_class c on c.oid = i.inhrelid
  where i.inhparent = 'public.chart_ohlcv_intraday'::regclass;

  select count(*)::bigint,
    min((bar_time at time zone 'Asia/Ho_Chi_Minh')::date),
    max((bar_time at time zone 'Asia/Ho_Chi_Minh')::date)
  into v_hot_rows, v_oldest, v_newest
  from public.chart_ohlcv_intraday;

  return jsonb_build_object(
    'databaseBytes', v_database_bytes,
    'hotHeapBytes', v_hot_heap_bytes,
    'hotIndexBytes', v_hot_index_bytes,
    'hotTotalBytes', v_hot_heap_bytes + v_hot_index_bytes,
    'hotRows', v_hot_rows,
    'partitionCount', v_partition_count,
    'oldestHotSession', v_oldest,
    'newestHotSession', v_newest
  );
end;
$$;

-- Rebind relation dependencies to the new canonical partitioned parent.
create or replace function public.qeo_chart_intraday_coverage(p_tickers text[], p_hot_cutoff timestamptz)
returns table(
  ticker text, hot_row_count bigint, hot_first_bar_time timestamptz, hot_last_bar_time timestamptz,
  cold_manifest_count bigint, cold_row_count bigint, cold_first_bar_time timestamptz, cold_last_bar_time timestamptz,
  derived_hourly_row_count bigint, derived_first_bar_time timestamptz, derived_last_bar_time timestamptz,
  successful_request_count bigint, provider_gap_count bigint, retryable_failure_count bigint,
  failed_attempt_count bigint, last_attempt_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with requested as (
    select distinct upper(trim(value)) as ticker
    from unnest(coalesce(p_tickers, array[]::text[])) value
    where upper(trim(value)) ~ '^[A-Z0-9]{2,12}$'
  ),
  hot as (
    select h.ticker, count(*)::bigint as row_count, min(h.bar_time) as first_bar_time, max(h.bar_time) as last_bar_time
    from public.chart_ohlcv_intraday h join requested r on r.ticker = h.ticker
    where h.base_resolution = '1m' and h.bar_time >= p_hot_cutoff group by h.ticker
  ),
  cold as (
    select m.ticker, count(*)::bigint as manifest_count, coalesce(sum(m.row_count), 0)::bigint as row_count, min(m.range_start) as first_bar_time, max(m.range_end) as last_bar_time
    from public.chart_ohlcv_cold_manifests m join requested r on r.ticker = m.ticker
    where m.base_resolution = '1m' and m.verified_at is not null group by m.ticker
  ),
  derived as (
    select h.ticker, count(*)::bigint as row_count, min(h.bar_time) as first_bar_time, max(h.bar_time) as last_bar_time
    from public.chart_ohlcv_derived_hourly h join requested r on r.ticker = h.ticker
    where h.resolution = '1h' group by h.ticker
  ),
  attempts as (
    select p.ticker,
      count(*) filter (where p.row_count > 0 and p.detail ->> 'outcome' = 'success')::bigint as successful_request_count,
      count(*) filter (where p.detail ->> 'outcome' = 'provider_gap')::bigint as provider_gap_count,
      count(*) filter (where p.detail ->> 'outcome' = 'retryable_failure')::bigint as retryable_failure_count,
      count(*) filter (where p.detail ->> 'outcome' = 'failed')::bigint as failed_attempt_count,
      max(p.fetched_at) as last_attempt_at
    from public.chart_ohlcv_provenance_batches p join requested r on r.ticker = p.ticker
    where p.base_resolution = '1m' and p.detail ->> 'workflow' = 'QEO-107' group by p.ticker
  )
  select r.ticker,
    coalesce(h.row_count, 0)::bigint, h.first_bar_time, h.last_bar_time,
    coalesce(c.manifest_count, 0)::bigint, coalesce(c.row_count, 0)::bigint, c.first_bar_time, c.last_bar_time,
    coalesce(d.row_count, 0)::bigint, d.first_bar_time, d.last_bar_time,
    coalesce(a.successful_request_count, 0)::bigint, coalesce(a.provider_gap_count, 0)::bigint,
    coalesce(a.retryable_failure_count, 0)::bigint, coalesce(a.failed_attempt_count, 0)::bigint, a.last_attempt_at
  from requested r
  left join hot h on h.ticker = r.ticker
  left join cold c on c.ticker = r.ticker
  left join derived d on d.ticker = r.ticker
  left join attempts a on a.ticker = r.ticker
  order by r.ticker;
$$;

create or replace function public.qeo_prune_verified_chart_intraday_partition(
  p_manifest_id uuid,
  p_expected_sha256 text,
  p_expected_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_hot_rows bigint := 0;
  v_deleted bigint := 0;
begin
  if p_expected_row_count is null or p_expected_row_count <= 0 then
    raise exception 'QEO-103 prune requires a positive expected row count';
  end if;
  select * into v_manifest from public.chart_ohlcv_cold_manifests where id = p_manifest_id for update;
  if not found then raise exception 'QEO-103 prune manifest not found: %', p_manifest_id; end if;
  if v_manifest.base_resolution <> '1m' or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256 or v_manifest.row_count <> p_expected_row_count then
    raise exception 'QEO-103 prune manifest verification mismatch: %', p_manifest_id;
  end if;
  if not exists (
    select 1 from public.chart_ohlcv_derived_hourly h
    where h.source_manifest_id = p_manifest_id and h.ticker = v_manifest.ticker and h.source_sha256 = v_manifest.sha256
  ) then
    raise exception 'QEO-103 derived hourly cache missing for manifest: %', p_manifest_id;
  end if;
  select count(*) into v_hot_rows from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start and h.bar_time <= v_manifest.range_end;
  if v_hot_rows <> p_expected_row_count then
    raise exception 'QEO-103 hot row-count mismatch before prune: manifest %, expected %, found %', p_manifest_id, p_expected_row_count, v_hot_rows;
  end if;
  delete from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start and h.bar_time <= v_manifest.range_end;
  get diagnostics v_deleted = row_count;
  if v_deleted <> p_expected_row_count then
    raise exception 'QEO-103 atomic prune mismatch: manifest %, expected %, deleted %', p_manifest_id, p_expected_row_count, v_deleted;
  end if;
  return jsonb_build_object('status', 'pruned', 'manifestId', p_manifest_id, 'ticker', v_manifest.ticker,
    'rangeStart', v_manifest.range_start, 'rangeEnd', v_manifest.range_end, 'deletedRows', v_deleted, 'sha256', v_manifest.sha256);
end;
$$;

revoke all on function public.qeo_ensure_chart_intraday_session_partition(date) from public, anon, authenticated;
grant execute on function public.qeo_ensure_chart_intraday_session_partition(date) to service_role;
revoke all on function public.qeo_drop_empty_chart_intraday_session_partition(date) from public, anon, authenticated;
grant execute on function public.qeo_drop_empty_chart_intraday_session_partition(date) to service_role;
revoke all on function public.qeo_chart_storage_capacity() from public;
revoke all on function public.qeo_chart_storage_capacity() from anon, authenticated;
grant execute on function public.qeo_chart_storage_capacity() to service_role;
revoke all on function public.qeo_chart_intraday_coverage(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_chart_intraday_coverage(text[], timestamptz) to service_role;
revoke all on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer) to service_role;

commit;
