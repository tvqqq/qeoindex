begin;

-- QEO-39 follow-up: keep each PostgREST response below the API row cap by
-- returning one grouped result row per requested ticker. Nested Daily bars use
-- compact positional arrays to avoid repeating JSON keys/ticker/timeframe for
-- every bar while preserving the same bounded history and indexed LATERAL read.
-- Tuple order:
-- [bar_time, open, high, low, close, volume, provider, provider_detail, source_url, fetched_at]
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
        jsonb_build_array(
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
        ) order by h.bar_time
      ) filter (where h.bar_time is not null),
      '[]'::jsonb
    ) as rows
  from requested q
  left join lateral (
    select
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
