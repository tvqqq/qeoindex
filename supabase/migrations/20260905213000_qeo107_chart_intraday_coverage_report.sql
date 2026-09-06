begin;

create or replace function public.qeo_chart_intraday_coverage(
  p_tickers text[],
  p_hot_cutoff timestamptz
)
returns table (
  ticker text,
  hot_row_count bigint,
  hot_first_bar_time timestamptz,
  hot_last_bar_time timestamptz,
  cold_manifest_count bigint,
  cold_row_count bigint,
  cold_first_bar_time timestamptz,
  cold_last_bar_time timestamptz,
  derived_hourly_row_count bigint,
  derived_first_bar_time timestamptz,
  derived_last_bar_time timestamptz,
  successful_request_count bigint,
  provider_gap_count bigint,
  retryable_failure_count bigint,
  failed_attempt_count bigint,
  last_attempt_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct upper(trim(value)) as ticker
    from unnest(coalesce(p_tickers, array[]::text[])) value
    where upper(trim(value)) ~ '^[A-Z0-9]{2,12}$'
  ),
  hot as (
    select
      h.ticker,
      count(*)::bigint as row_count,
      min(h.bar_time) as first_bar_time,
      max(h.bar_time) as last_bar_time
    from public.chart_ohlcv_intraday h
    join requested r on r.ticker = h.ticker
    where h.base_resolution = '1m'
      and h.bar_time >= p_hot_cutoff
    group by h.ticker
  ),
  cold as (
    select
      m.ticker,
      count(*)::bigint as manifest_count,
      coalesce(sum(m.row_count), 0)::bigint as row_count,
      min(m.range_start) as first_bar_time,
      max(m.range_end) as last_bar_time
    from public.chart_ohlcv_cold_manifests m
    join requested r on r.ticker = m.ticker
    where m.base_resolution = '1m'
      and m.verified_at is not null
    group by m.ticker
  ),
  derived as (
    select
      h.ticker,
      count(*)::bigint as row_count,
      min(h.bar_time) as first_bar_time,
      max(h.bar_time) as last_bar_time
    from public.chart_ohlcv_derived_hourly h
    join requested r on r.ticker = h.ticker
    where h.resolution = '1h'
    group by h.ticker
  ),
  attempts as (
    select
      p.ticker,
      count(*) filter (where p.row_count > 0 and p.detail ->> 'outcome' = 'success')::bigint as successful_request_count,
      count(*) filter (where p.detail ->> 'outcome' = 'provider_gap')::bigint as provider_gap_count,
      count(*) filter (where p.detail ->> 'outcome' = 'retryable_failure')::bigint as retryable_failure_count,
      count(*) filter (where p.detail ->> 'outcome' = 'failed')::bigint as failed_attempt_count,
      max(p.fetched_at) as last_attempt_at
    from public.chart_ohlcv_provenance_batches p
    join requested r on r.ticker = p.ticker
    where p.base_resolution = '1m'
      and p.detail ->> 'workflow' = 'QEO-107'
    group by p.ticker
  )
  select
    r.ticker,
    coalesce(h.row_count, 0)::bigint,
    h.first_bar_time,
    h.last_bar_time,
    coalesce(c.manifest_count, 0)::bigint,
    coalesce(c.row_count, 0)::bigint,
    c.first_bar_time,
    c.last_bar_time,
    coalesce(d.row_count, 0)::bigint,
    d.first_bar_time,
    d.last_bar_time,
    coalesce(a.successful_request_count, 0)::bigint,
    coalesce(a.provider_gap_count, 0)::bigint,
    coalesce(a.retryable_failure_count, 0)::bigint,
    coalesce(a.failed_attempt_count, 0)::bigint,
    a.last_attempt_at
  from requested r
  left join hot h on h.ticker = r.ticker
  left join cold c on c.ticker = r.ticker
  left join derived d on d.ticker = r.ticker
  left join attempts a on a.ticker = r.ticker
  order by r.ticker;
$$;

revoke all on function public.qeo_chart_intraday_coverage(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_chart_intraday_coverage(text[], timestamptz) to service_role;

comment on function public.qeo_chart_intraday_coverage(text[], timestamptz) is
  'QEO-107 canonical 1m Hot/Cold + derived-hourly coverage report with explicit bootstrap provider-gap/failure telemetry.';

commit;
