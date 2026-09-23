begin;

alter table public.market_ohlcv_history
  alter column provider_detail drop not null,
  alter column source_url drop not null;

create or replace function public.qeo_market_ohlcv_provenance_consistency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registry_row public.market_ohlcv_provenance%rowtype;
begin
  if new.provenance_id is null then
    return new;
  end if;

  select * into registry_row
  from public.market_ohlcv_provenance
  where id = new.provenance_id;

  if not found then
    raise exception 'Daily OHLCV provenance_id % does not exist', new.provenance_id;
  end if;

  if new.provider is distinct from registry_row.provider
    or (new.provider_detail is not null and new.provider_detail is distinct from registry_row.provider_detail)
    or (new.source_url is not null and new.source_url is distinct from registry_row.source_url)
  then
    raise exception 'Daily OHLCV provenance mismatch for %.% at %', new.ticker, new.timeframe, new.bar_time;
  end if;

  return new;
end;
$$;

revoke all on function public.qeo_market_ohlcv_provenance_consistency_guard() from public, anon, authenticated;

create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  history.ticker,
  history.timeframe,
  history.bar_time,
  history.open,
  history.high,
  history.low,
  history.close,
  history.volume,
  history.provider,
  case when history.provenance_id is null then history.provider_detail else registry.provider_detail end as provider_detail,
  case when history.provenance_id is null then history.source_url else registry.source_url end as source_url,
  history.fetched_at,
  history.provenance_id,
  (
    history.provenance_id is not null
    and registry.id is not null
    and history.provider = registry.provider
    and (history.provider_detail is null or history.provider_detail = registry.provider_detail)
    and (history.source_url is null or history.source_url = registry.source_url)
  ) as provenance_consistent
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry on registry.id = history.provenance_id;

revoke all privileges on table public.market_ohlcv_history_compat from public, anon, authenticated;
grant select on table public.market_ohlcv_history_compat to service_role;

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
    h.ticker, h.timeframe, h.bar_time, h.open, h.high, h.low, h.close, h.volume,
    h.provider, h.provider_detail, h.source_url, h.fetched_at
  from requested q
  cross join lateral (
    select
      source.ticker, source.timeframe, source.bar_time, source.open, source.high, source.low,
      source.close, source.volume, source.provider, source.provider_detail, source.source_url, source.fetched_at
    from public.market_ohlcv_history_compat source
    where source.ticker = q.ticker
      and source.timeframe = '1D'
      and source.provenance_consistent is true
    order by source.bar_time desc
    limit greatest(1, least(coalesce(p_limit, 260), 1700))
  ) h
  order by h.ticker, h.timeframe, h.bar_time;
$$;

revoke all on function public.qeo_market_ohlcv_recent(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent(text[], integer) to service_role;

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
  from public.market_ohlcv_history_compat h
  join universe u on u.ticker = h.ticker
  left join public.market_trading_sessions s
    on s.session_date = (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date
  where h.timeframe = '1D' and h.provenance_consistent is true
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
      where is_trading_day and volume = 0 and (
        provider in ('VCI', 'DNSE') or (
          provider = 'Fallback' and source_url = 'internal://stock_orderbook_snapshots'
          and provider_detail ilike 'Verified final market-close repair%'
        )
      )
    )::bigint as verified_no_trade_rows,
    count(*) filter (
      where is_trading_day and volume = 0 and not (
        provider in ('VCI', 'DNSE') or (
          provider = 'Fallback' and source_url = 'internal://stock_orderbook_snapshots'
          and provider_detail ilike 'Verified final market-close repair%'
        )
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

create or replace function public.qeo_market_daily_integrity_report_scoped(p_tickers text[])
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
with requested as (
  select distinct upper(trim(value)) as ticker
  from unnest(coalesce(p_tickers, array[]::text[])) as value
  where trim(value) ~ '^[A-Za-z0-9]{2,12}$'
), universe as (
  select upper(stock->>'ticker') as ticker, upper(coalesce(stock->>'exchange', '')) as exchange
  from jsonb_array_elements(public.qeo_current_market_universe()->'stocks') stock
  join requested r on r.ticker = upper(stock->>'ticker')
), daily as (
  select h.ticker,
    (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date as session_date,
    h.volume, h.provider, h.provider_detail, h.source_url,
    coalesce(s.is_trading_day, extract(isodow from (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date) between 1 and 5) as is_trading_day
  from public.market_ohlcv_history_compat h
  join universe u on u.ticker = h.ticker
  left join public.market_trading_sessions s
    on s.session_date = (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date
  where h.timeframe = '1D' and h.provenance_consistent is true
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
      where is_trading_day and volume = 0 and (
        provider in ('VCI', 'DNSE') or (
          provider = 'Fallback' and source_url = 'internal://stock_orderbook_snapshots'
          and provider_detail ilike 'Verified final market-close repair%'
        )
      )
    )::bigint as verified_no_trade_rows,
    count(*) filter (
      where is_trading_day and volume = 0 and not (
        provider in ('VCI', 'DNSE') or (
          provider = 'Fallback' and source_url = 'internal://stock_orderbook_snapshots'
          and provider_detail ilike 'Verified final market-close repair%'
        )
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

revoke all on function public.qeo_market_daily_integrity_report_scoped(text[]) from public, anon, authenticated;
grant execute on function public.qeo_market_daily_integrity_report_scoped(text[]) to service_role;

commit;
