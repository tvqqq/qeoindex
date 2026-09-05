-- QEO-106 follow-up: a zero-volume Daily row returned by a canonical Daily authority
-- (VCI/DNSE) is explicit no-trade evidence. Generic fallback zero-volume remains unresolved.
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

comment on function public.qeo_market_daily_integrity_report() is
  'QEO-106 canonical 200 Daily audit: expected-session continuity, closed-session rejection, canonical-authority no-trade evidence, and unresolved fallback zero-volume rows.';
