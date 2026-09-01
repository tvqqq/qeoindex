begin;

create table if not exists public.kfsp_universe_candidate_snapshots (
  as_of_date date not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  company_name text,
  exchange text,
  sector text,
  market_cap_billion numeric check (market_cap_billion is null or market_cap_billion >= 0),
  average_volume_50_sessions bigint check (average_volume_50_sessions is null or average_volume_50_sessions >= 0),
  volume_1d numeric check (volume_1d is null or volume_1d >= 0),
  sync_run_id uuid not null,
  fetched_at timestamptz not null default now(),
  primary key (as_of_date, ticker)
);

create index if not exists kfsp_universe_candidate_snapshots_ticker_date_idx
  on public.kfsp_universe_candidate_snapshots(ticker, as_of_date desc);

create index if not exists kfsp_universe_candidate_snapshots_date_market_cap_idx
  on public.kfsp_universe_candidate_snapshots(as_of_date desc, market_cap_billion desc, average_volume_50_sessions desc, ticker);

alter table public.kfsp_universe_candidate_snapshots enable row level security;
revoke all privileges on table public.kfsp_universe_candidate_snapshots from anon, authenticated;
grant all privileges on table public.kfsp_universe_candidate_snapshots to service_role;

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
    from public.kfsp_universe_candidate_snapshots r
    where r.as_of_date = p_source_date
      and r.market_cap_billion > p_min_market_cap_billion
      and r.average_volume_50_sessions > p_min_average_volume_50d
  ),
  recent_activity as (
    select
      r.ticker,
      count(distinct r.as_of_date)::bigint as activity_observation_days,
      count(distinct r.as_of_date) filter (
        where coalesce(r.volume_1d, 0) > 0
      )::bigint as activity_positive_days
    from public.kfsp_universe_candidate_snapshots r
    join activity_dates d on d.activity_date = r.as_of_date
    join latest_candidates c on c.ticker = r.ticker
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

comment on table public.kfsp_universe_candidate_snapshots is
  'Service-role-only full KFSP candidate feed used to discover future canonical Top Stocks entrants. User-facing ratings remain canonical-universe scoped.';

comment on function public.qeo_select_market_universe_candidates(date, numeric, bigint, integer) is
  'Selects Top Stocks candidates from the full KFSP candidate feed using strict market-cap/Avg50 filters plus 5 weekday observations with >=4 positive-volume days.';

commit;
