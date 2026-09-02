begin;

-- QEO-39 follow-up: keep each PostgREST response below the API row cap by
-- returning one grouped JSON result row per requested ticker while preserving
-- the same bounded per-ticker Daily history and indexed LATERAL lookup.
create or replace function public.qeo_market_ohlcv_recent_grouped(
  p_tickers text[],
  p_limit integer default 260
)
returns table (
  ticker text,
  rows jsonb
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
    q.ticker,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ticker', h.ticker,
          'timeframe', h.timeframe,
          'bar_time', h.bar_time,
          'open', h.open,
          'high', h.high,
          'low', h.low,
          'close', h.close,
          'volume', h.volume,
          'provider', h.provider,
          'provider_detail', h.provider_detail,
          'source_url', h.source_url,
          'fetched_at', h.fetched_at
        ) order by h.bar_time
      ) filter (where h.ticker is not null),
      '[]'::jsonb
    ) as rows
  from requested q
  left join lateral (
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
  ) h on true
  group by q.ticker
  order by q.ticker;
$$;

revoke all on function public.qeo_market_ohlcv_recent_grouped(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent_grouped(text[], integer) to service_role;

commit;
