-- Exclude suspended and restricted-weekly stocks from the canonical monthly universe.
-- A candidate must have KFSP observations for the latest 5 weekdays and positive
-- daily matched volume on at least 4 of those observations. This intentionally
-- tolerates one zero-volume weekday while rejecting stale/suspended and weekly-only names.

create or replace function public.qeo_select_market_universe_candidates(
  p_source_date date,
  p_min_market_cap_billion numeric,
  p_min_average_volume_50d bigint,
  p_max_size integer default 200
)
returns table (
  ticker text,
  company_name text,
  exchange text,
  sector text,
  market_cap_billion numeric,
  average_volume_50_sessions bigint,
  as_of_date date,
  activity_observation_days bigint,
  activity_positive_days bigint,
  eligible_candidate_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with activity_dates as (
    select d::date as activity_date
    from generate_series(
      p_source_date::timestamp - interval '10 days',
      p_source_date::timestamp,
      interval '1 day'
    ) as d
    where extract(isodow from d) between 1 and 5
    order by d desc
    limit 5
  ),
  latest_candidates as (
    select
      r.ticker,
      r.company_name,
      r.exchange,
      r.sector,
      r.market_cap_billion,
      r.average_volume_50_sessions,
      r.as_of_date
    from public.insights_stock_ratings r
    where r.is_published = true
      and r.source = 'kfsp'
      and r.as_of_date = p_source_date
      and r.market_cap_billion > p_min_market_cap_billion
      and r.average_volume_50_sessions > p_min_average_volume_50d
  ),
  recent_activity as (
    select
      r.ticker,
      count(distinct r.as_of_date)::bigint as activity_observation_days,
      count(distinct r.as_of_date) filter (
        where coalesce((r.kfsp_metrics -> 'liquidity' ->> 'volume_1d')::numeric, 0) > 0
      )::bigint as activity_positive_days
    from public.insights_stock_ratings r
    join activity_dates d on d.activity_date = r.as_of_date
    join latest_candidates c on c.ticker = r.ticker
    where r.is_published = true
      and r.source = 'kfsp'
    group by r.ticker
  ),
  eligible as (
    select
      c.ticker,
      c.company_name,
      c.exchange,
      c.sector,
      c.market_cap_billion,
      c.average_volume_50_sessions,
      c.as_of_date,
      a.activity_observation_days,
      a.activity_positive_days
    from latest_candidates c
    join recent_activity a on a.ticker = c.ticker
    where a.activity_observation_days = 5
      and a.activity_positive_days >= 4
  ),
  ranked as (
    select
      e.*,
      count(*) over ()::bigint as eligible_candidate_count
    from eligible e
  )
  select
    r.ticker,
    r.company_name,
    r.exchange,
    r.sector,
    r.market_cap_billion,
    r.average_volume_50_sessions,
    r.as_of_date,
    r.activity_observation_days,
    r.activity_positive_days,
    r.eligible_candidate_count
  from ranked r
  order by
    r.market_cap_billion desc,
    r.average_volume_50_sessions desc,
    r.ticker asc
  limit greatest(1, least(coalesce(p_max_size, 200), 200));
$$;

revoke all on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) from public;
revoke all on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) from anon;
revoke all on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) from authenticated;
grant execute on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) to service_role;

comment on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) is
  'Selects canonical Top Stocks candidates using strict market-cap/Avg50 filters plus recent daily-trading activity: 5 weekday observations, >=4 with volume_1d > 0.';
