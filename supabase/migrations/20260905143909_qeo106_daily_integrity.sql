-- QEO-106: canonical Daily integrity for the 200-stock production universe.
create table if not exists public.market_trading_sessions (
  session_date date primary key,
  is_trading_day boolean not null,
  source text not null,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.market_trading_sessions is
  'QEO-106 authoritative Vietnam cash-market session calendar used by canonical Daily OHLCV integrity checks.';

alter table public.market_trading_sessions enable row level security;
revoke all on public.market_trading_sessions from anon, authenticated;

with calendar as (
  select day::date as session_date
  from generate_series(date '2018-01-01', date '2026-12-31', interval '1 day') as day
), holidays as (
  select unnest(array[
    '2018-01-01','2018-02-14','2018-02-15','2018-02-16','2018-02-19','2018-02-20','2018-04-25','2018-04-30','2018-05-01','2018-09-03','2018-12-31',
    '2019-01-01','2019-02-04','2019-02-05','2019-02-06','2019-02-07','2019-02-08','2019-04-15','2019-04-29','2019-04-30','2019-05-01','2019-09-02',
    '2020-01-01','2020-01-23','2020-01-24','2020-01-27','2020-01-28','2020-01-29','2020-04-02','2020-04-30','2020-05-01','2020-09-02',
    '2021-01-01','2021-02-10','2021-02-11','2021-02-12','2021-02-15','2021-02-16','2021-04-21','2021-04-30','2021-05-03','2021-09-02','2021-09-03',
    '2022-01-03','2022-01-31','2022-02-01','2022-02-02','2022-02-03','2022-02-04','2022-04-11','2022-05-02','2022-05-03','2022-09-01','2022-09-02',
    '2023-01-02','2023-01-20','2023-01-23','2023-01-24','2023-01-25','2023-01-26','2023-05-01','2023-05-02','2023-05-03','2023-09-01','2023-09-04',
    '2024-01-01','2024-02-08','2024-02-09','2024-02-12','2024-02-13','2024-02-14','2024-04-18','2024-04-29','2024-04-30','2024-05-01','2024-09-02','2024-09-03',
    '2025-01-01','2025-01-27','2025-01-28','2025-01-29','2025-01-30','2025-01-31','2025-04-07','2025-04-30','2025-05-01','2025-05-02','2025-09-01','2025-09-02',
    '2026-01-01','2026-01-02','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-04-27','2026-04-30','2026-05-01','2026-08-31','2026-09-01','2026-09-02'
  ]::date[]) as session_date
)
insert into public.market_trading_sessions (session_date, is_trading_day, source, note, updated_at)
select
  c.session_date,
  extract(isodow from c.session_date) between 1 and 5 and h.session_date is null,
  'HNX/VNX official annual trading-holiday notices 2018-2026',
  case
    when extract(isodow from c.session_date) in (6, 7) then 'WEEKEND'
    when h.session_date is not null then 'OFFICIAL_MARKET_HOLIDAY'
    else null
  end,
  now()
from calendar c
left join holidays h using (session_date)
on conflict (session_date) do update set
  is_trading_day = excluded.is_trading_day,
  source = excluded.source,
  note = excluded.note,
  updated_at = excluded.updated_at;

create table if not exists public.market_ohlcv_daily_quarantine (
  ticker text not null,
  timeframe text not null,
  bar_time timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null,
  provider text not null,
  provider_detail text not null,
  source_url text not null,
  fetched_at timestamptz not null,
  quarantine_reason text not null,
  quarantined_at timestamptz not null default now(),
  primary key (ticker, timeframe, bar_time)
);

comment on table public.market_ohlcv_daily_quarantine is
  'QEO-106 immutable evidence copy of canonical Daily rows removed because their local Vietnam session date is a proven market-closed date.';

alter table public.market_ohlcv_daily_quarantine enable row level security;
revoke all on public.market_ohlcv_daily_quarantine from anon, authenticated;

insert into public.market_ohlcv_daily_quarantine (
  ticker, timeframe, bar_time, open, high, low, close, volume,
  provider, provider_detail, source_url, fetched_at,
  quarantine_reason, quarantined_at
)
select
  h.ticker, h.timeframe, h.bar_time, h.open, h.high, h.low, h.close, h.volume,
  h.provider, h.provider_detail, h.source_url, h.fetched_at,
  'NON_TRADING_SESSION', now()
from public.market_ohlcv_history h
join public.market_trading_sessions s
  on s.session_date = (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date
where h.timeframe = '1D'
  and s.is_trading_day = false
on conflict (ticker, timeframe, bar_time) do nothing;

delete from public.market_ohlcv_history h
using public.market_trading_sessions s
where h.timeframe = '1D'
  and s.session_date = (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date
  and s.is_trading_day = false;

create or replace function public.qeo_guard_daily_ohlcv_trading_session()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session_date date;
  v_is_trading_day boolean;
begin
  if new.timeframe is distinct from '1D' then
    return new;
  end if;

  v_session_date := (new.bar_time at time zone 'Asia/Ho_Chi_Minh')::date;
  select s.is_trading_day into v_is_trading_day
  from public.market_trading_sessions s
  where s.session_date = v_session_date;

  if found and v_is_trading_day = false then
    raise warning 'QEO-106 rejected Daily OHLCV on non-trading session ticker=% session_date=% provider=%',
      new.ticker, v_session_date, new.provider;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists qeo_market_ohlcv_daily_session_guard on public.market_ohlcv_history;
create trigger qeo_market_ohlcv_daily_session_guard
before insert or update on public.market_ohlcv_history
for each row
execute function public.qeo_guard_daily_ohlcv_trading_session();

comment on function public.qeo_guard_daily_ohlcv_trading_session() is
  'QEO-106 persistence boundary: silently skips canonical Daily writes whose Vietnam session date is an authoritative market-closed date.';

create or replace function public.qeo_market_daily_integrity_report()
returns table (
  ticker text,
  exchange text,
  first_session date,
  last_session date,
  valid_daily_rows bigint,
  expected_sessions bigint,
  missing_expected_sessions bigint,
  missing_session_dates date[],
  non_trading_persisted_rows bigint,
  verified_no_trade_rows bigint,
  unclassified_zero_volume_rows bigint,
  status text
)
language sql
stable
set search_path = public, pg_temp
as $$
with universe as (
  select upper(stock->>'ticker') as ticker, upper(coalesce(stock->>'exchange', '')) as exchange
  from jsonb_array_elements(public.qeo_current_market_universe()->'stocks') stock
), daily as (
  select h.ticker,
    (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date as session_date,
    h.volume, h.provider, h.provider_detail, h.source_url,
    coalesce(s.is_trading_day, extract(isodow from (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date) between 1 and 5) as is_trading_day
  from public.market_ohlcv_history h
  join universe u on u.ticker = h.ticker
  left join public.market_trading_sessions s
    on s.session_date = (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date
  where h.timeframe = '1D'
), bounds as (
  select u.ticker, u.exchange,
    min(d.session_date) filter (where d.is_trading_day) as first_session,
    max(d.session_date) filter (where d.is_trading_day) as last_session
  from universe u left join daily d on d.ticker = u.ticker
  group by u.ticker, u.exchange
), expected as (
  select b.ticker, s.session_date
  from bounds b
  join public.market_trading_sessions s
    on s.is_trading_day = true and s.session_date between b.first_session and b.last_session
), missing as (
  select e.ticker, e.session_date
  from expected e
  left join daily d on d.ticker = e.ticker and d.session_date = e.session_date and d.is_trading_day = true
  where d.ticker is null
), expected_counts as (
  select ticker, count(*)::bigint as expected_sessions from expected group by ticker
), missing_counts as (
  select ticker, count(*)::bigint as missing_expected_sessions,
    array_agg(session_date order by session_date) as missing_session_dates
  from missing group by ticker
), daily_counts as (
  select ticker,
    count(*) filter (where is_trading_day)::bigint as valid_daily_rows,
    count(*) filter (where not is_trading_day)::bigint as non_trading_persisted_rows,
    count(*) filter (
      where is_trading_day and volume = 0 and provider = 'Fallback'
        and source_url = 'internal://stock_orderbook_snapshots'
        and provider_detail ilike 'Verified final market-close repair%'
    )::bigint as verified_no_trade_rows,
    count(*) filter (
      where is_trading_day and volume = 0 and not (
        provider = 'Fallback' and source_url = 'internal://stock_orderbook_snapshots'
        and provider_detail ilike 'Verified final market-close repair%'
      )
    )::bigint as unclassified_zero_volume_rows
  from daily group by ticker
)
select b.ticker, b.exchange, b.first_session, b.last_session,
  coalesce(d.valid_daily_rows, 0), coalesce(e.expected_sessions, 0),
  coalesce(m.missing_expected_sessions, 0), coalesce(m.missing_session_dates, array[]::date[]),
  coalesce(d.non_trading_persisted_rows, 0), coalesce(d.verified_no_trade_rows, 0),
  coalesce(d.unclassified_zero_volume_rows, 0),
  case
    when b.first_session is null then 'NO_DATA'
    when coalesce(d.non_trading_persisted_rows, 0) > 0 then 'INVALID_NON_TRADING'
    when coalesce(m.missing_expected_sessions, 0) > 0 then 'MISSING_EXPECTED'
    when coalesce(d.unclassified_zero_volume_rows, 0) > 0 then 'REVIEW_ZERO_VOLUME'
    else 'PASS'
  end as status
from bounds b
left join expected_counts e using (ticker)
left join missing_counts m using (ticker)
left join daily_counts d using (ticker)
order by b.ticker;
$$;

revoke all on function public.qeo_market_daily_integrity_report() from public, anon, authenticated;
grant execute on function public.qeo_market_daily_integrity_report() to service_role;

comment on function public.qeo_market_daily_integrity_report() is
  'QEO-106 canonical 200 Daily audit: expected-session continuity, non-trading persistence, verified no-trade evidence, and unresolved zero-volume rows.';
