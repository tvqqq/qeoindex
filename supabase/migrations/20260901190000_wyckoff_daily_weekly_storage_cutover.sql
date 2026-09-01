begin;

-- ---------------------------------------------------------------------------
-- Wyckoff operational contract: raw Daily only; Weekly is derived deterministically.
-- Remove obsolete intraday/raw and non-Daily/Weekly derived rows before tightening checks.
-- ---------------------------------------------------------------------------
delete from public.market_ohlcv_history
where timeframe <> '1D';

alter table public.market_ohlcv_history
  drop constraint if exists market_ohlcv_history_timeframe_check;
alter table public.market_ohlcv_history
  add constraint market_ohlcv_history_timeframe_check check (timeframe = '1D');

delete from public.wyckoff_analysis_snapshots
where timeframe not in ('1D', '1W');

alter table public.wyckoff_analysis_snapshots
  drop constraint if exists wyckoff_analysis_snapshots_timeframe_check;
alter table public.wyckoff_analysis_snapshots
  add constraint wyckoff_analysis_snapshots_timeframe_check check (timeframe in ('1D', '1W'));

delete from public.wyckoff_chart_series
where timeframe <> '1D';

alter table public.wyckoff_chart_series
  drop constraint if exists wyckoff_chart_series_timeframe_check;
alter table public.wyckoff_chart_series
  add constraint wyckoff_chart_series_timeframe_check check (timeframe = '1D');

-- A successful full-provider bootstrap is a durable fact. Newly listed tickers with
-- <60 calendar months must not repeat an 8-year provider bootstrap every EOD forever.
create table if not exists public.market_ohlcv_bootstrap_state (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  timeframe text not null check (timeframe = '1D'),
  completed boolean not null default false,
  provider text not null default '',
  first_bar_time timestamptz,
  last_bar_time timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (ticker, timeframe)
);

alter table public.market_ohlcv_bootstrap_state enable row level security;
revoke all privileges on table public.market_ohlcv_bootstrap_state from anon, authenticated;
grant all privileges on table public.market_ohlcv_bootstrap_state to service_role;

-- Existing Daily histories that already represent at least 60 months are known-complete.
insert into public.market_ohlcv_bootstrap_state (
  ticker, timeframe, completed, provider, first_bar_time, last_bar_time, completed_at, updated_at
)
select
  h.ticker,
  '1D',
  true,
  (array_agg(h.provider order by h.bar_time desc))[1],
  min(h.bar_time),
  max(h.bar_time),
  now(),
  now()
from public.market_ohlcv_history h
where h.timeframe = '1D'
group by h.ticker
having count(distinct date_trunc('month', h.bar_time at time zone 'Asia/Ho_Chi_Minh')) >= 60
on conflict (ticker, timeframe) do update
set completed = excluded.completed,
    provider = excluded.provider,
    first_bar_time = excluded.first_bar_time,
    last_bar_time = excluded.last_bar_time,
    completed_at = coalesce(public.market_ohlcv_bootstrap_state.completed_at, excluded.completed_at),
    updated_at = excluded.updated_at;

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
      and h.timeframe = '1D'
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

-- Plan C foundation: range-level cold archive ledger. This does not enable pruning;
-- it records verified archive coverage so a future partition cutover can be fail-closed.
create table if not exists public.market_ohlcv_archive_ranges (
  id uuid primary key default gen_random_uuid(),
  timeframe text not null check (timeframe = '1D'),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  range_start date not null,
  range_end date not null,
  row_count integer not null check (row_count > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  manifest_url text not null,
  archive_format text not null default 'csv.gz',
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (range_end >= range_start),
  unique (ticker, timeframe, range_start, range_end, sha256)
);

alter table public.market_ohlcv_archive_ranges enable row level security;
revoke all privileges on table public.market_ohlcv_archive_ranges from anon, authenticated;
grant all privileges on table public.market_ohlcv_archive_ranges to service_role;

commit;
