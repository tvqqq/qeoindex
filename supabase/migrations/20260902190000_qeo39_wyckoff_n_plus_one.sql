begin;

-- QEO-39: serve bounded per-ticker recent Daily history in one RPC call.
-- The LATERAL lookup lets Postgres use market_ohlcv_history_lookup_idx for each
-- requested ticker instead of ranking/scanning all matching history together.
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
  with requested as (
    select distinct upper(btrim(input.raw_ticker)) as ticker
    from unnest(p_tickers) as input(raw_ticker)
    where upper(btrim(input.raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
  )
  select
    h.ticker,
    h.timeframe,
    h.bar_time,
    h.open,
    h.high,
    h.low,
    h.close,
    h.volume,
    h.provider,
    h.provider_detail,
    h.source_url,
    h.fetched_at
  from requested q
  cross join lateral (
    select
      source.ticker,
      source.timeframe,
      source.bar_time,
      source.open,
      source.high,
      source.low,
      source.close,
      source.volume,
      source.provider,
      source.provider_detail,
      source.source_url,
      source.fetched_at
    from public.market_ohlcv_history source
    where source.ticker = q.ticker
      and source.timeframe = '1D'
    order by source.bar_time desc
    limit greatest(1, least(coalesce(p_limit, 260), 1700))
  ) h
  order by h.ticker, h.timeframe, h.bar_time;
$$;

revoke all on function public.qeo_market_ohlcv_recent(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent(text[], integer) to service_role;

commit;
