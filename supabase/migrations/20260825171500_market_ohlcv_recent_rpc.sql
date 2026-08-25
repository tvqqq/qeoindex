begin;

create or replace function public.qeo_market_ohlcv_recent(p_tickers text[], p_limit integer default 260)
returns table (
  ticker text,
  timeframe text,
  bar_time timestamptz,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  provider text,
  provider_detail text,
  source_url text,
  fetched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      h.*,
      row_number() over (partition by h.ticker, h.timeframe order by h.bar_time desc) as rn
    from public.market_ohlcv_history h
    where h.ticker = any(p_tickers)
      and h.timeframe in ('1D', '1H')
  )
  select
    r.ticker,
    r.timeframe,
    r.bar_time,
    r.open,
    r.high,
    r.low,
    r.close,
    r.volume,
    r.provider,
    r.provider_detail,
    r.source_url,
    r.fetched_at
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_limit, 260), 260))
  order by r.ticker, r.timeframe, r.bar_time;
$$;

revoke all on function public.qeo_market_ohlcv_recent(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent(text[], integer) to service_role;

commit;
