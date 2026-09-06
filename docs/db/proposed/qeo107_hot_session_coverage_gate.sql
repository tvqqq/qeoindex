begin;

create or replace function public.qeo_chart_intraday_session_coverage(
  p_tickers text[],
  p_hot_cutoff timestamptz
)
returns table (
  ticker text,
  hot_session_count bigint,
  first_hot_session date,
  last_hot_session date
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
  )
  select
    r.ticker,
    count(distinct (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date)::bigint as hot_session_count,
    min((h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date) as first_hot_session,
    max((h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date) as last_hot_session
  from requested r
  left join public.chart_ohlcv_intraday h
    on h.ticker = r.ticker
   and h.base_resolution = '1m'
   and h.bar_time >= p_hot_cutoff
  group by r.ticker
  order by r.ticker;
$$;

revoke all on function public.qeo_chart_intraday_session_coverage(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_chart_intraday_session_coverage(text[], timestamptz) to service_role;

comment on function public.qeo_chart_intraday_session_coverage(text[], timestamptz) is
  'QEO-107 exact HOT raw-1m trading-session coverage gate. Counts distinct Asia/Ho_Chi_Minh session dates at or after the physical HOT cutoff.';

commit;
