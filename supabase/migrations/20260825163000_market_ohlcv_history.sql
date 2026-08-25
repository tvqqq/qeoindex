begin;

create table if not exists public.market_ohlcv_history (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  timeframe text not null check (timeframe in ('1D','1H')),
  bar_time timestamptz not null,
  open double precision not null check (open > 0),
  high double precision not null check (high > 0),
  low double precision not null check (low > 0),
  close double precision not null check (close > 0),
  volume double precision not null check (volume >= 0),
  provider text not null,
  provider_detail text not null,
  source_url text not null,
  fetched_at timestamptz not null,
  primary key (ticker, timeframe, bar_time)
);

create index if not exists market_ohlcv_history_lookup_idx
  on public.market_ohlcv_history (ticker, timeframe, bar_time desc);

alter table public.market_ohlcv_history enable row level security;
revoke all privileges on table public.market_ohlcv_history from anon, authenticated;
grant all privileges on table public.market_ohlcv_history to service_role;

create or replace function public.qeo_market_ohlcv_coverage(p_tickers text[])
returns table (
  ticker text,
  timeframe text,
  row_count bigint,
  first_bar_time timestamptz,
  last_bar_time timestamptz,
  distinct_months bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    h.ticker,
    h.timeframe,
    count(*)::bigint as row_count,
    min(h.bar_time) as first_bar_time,
    max(h.bar_time) as last_bar_time,
    case
      when h.timeframe = '1D' then count(distinct date_trunc('month', h.bar_time at time zone 'Asia/Ho_Chi_Minh'))::bigint
      else 0::bigint
    end as distinct_months
  from public.market_ohlcv_history h
  where h.ticker = any(p_tickers)
  group by h.ticker, h.timeframe
  order by h.ticker, h.timeframe;
$$;

revoke all on function public.qeo_market_ohlcv_coverage(text[]) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_coverage(text[]) to service_role;

commit;
