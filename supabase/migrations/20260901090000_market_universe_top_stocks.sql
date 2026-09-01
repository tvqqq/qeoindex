begin;

create table if not exists public.market_universe_runs (
  id uuid primary key default gen_random_uuid(),
  universe_key text not null check (universe_key ~ '^[a-z0-9_]+$'),
  status text not null default 'running' check (status in ('running', 'published', 'failed')),
  source text not null default 'kfsp',
  source_as_of_date date not null,
  max_size smallint not null default 200 check (max_size between 1 and 200),
  min_market_cap_billion numeric not null check (min_market_cap_billion > 0),
  min_average_volume_50d bigint not null check (min_average_volume_50d > 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  selected_count integer not null default 0 check (selected_count between 0 and 200),
  started_at timestamptz not null default now(),
  published_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.market_universe_memberships (
  run_id uuid not null references public.market_universe_runs(id) on delete cascade,
  universe_key text not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  rank smallint not null check (rank between 1 and 200),
  company_name text,
  exchange text,
  sector text,
  market_cap_billion numeric not null check (market_cap_billion > 0),
  average_volume_50d bigint not null check (average_volume_50d > 0),
  source_as_of_date date not null,
  logo_path text not null check (length(btrim(logo_path)) > 0),
  logo_kind text not null check (logo_kind in ('official', 'generated_fallback')),
  detail_complete boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (run_id, ticker),
  unique (run_id, rank)
);

create index if not exists market_universe_runs_current_idx
  on public.market_universe_runs(universe_key, published_at desc)
  where status = 'published';

create index if not exists market_universe_memberships_rank_idx
  on public.market_universe_memberships(run_id, rank);

alter table public.market_universe_runs enable row level security;
alter table public.market_universe_memberships enable row level security;

revoke all privileges on table public.market_universe_runs from anon, authenticated;
revoke all privileges on table public.market_universe_memberships from anon, authenticated;
grant all privileges on table public.market_universe_runs to service_role;
grant all privileges on table public.market_universe_memberships to service_role;

create or replace function public.qeo_current_market_universe(
  p_universe_key text default 'vn_top_stocks'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.market_universe_runs%rowtype;
  v_stocks jsonb;
begin
  select * into v_run
  from public.market_universe_runs
  where universe_key = p_universe_key
    and status = 'published'
    and published_at is not null
  order by published_at desc, created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'ticker', m.ticker,
      'rank', m.rank,
      'companyName', m.company_name,
      'exchange', m.exchange,
      'sector', m.sector,
      'marketCapBillion', m.market_cap_billion,
      'averageVolume50d', m.average_volume_50d,
      'sourceAsOfDate', m.source_as_of_date,
      'logoPath', m.logo_path,
      'logoKind', m.logo_kind,
      'detailComplete', m.detail_complete
    ) order by m.rank
  ), '[]'::jsonb)
  into v_stocks
  from public.market_universe_memberships m
  where m.run_id = v_run.id;

  return jsonb_build_object(
    'key', v_run.universe_key,
    'runId', v_run.id,
    'updatedAt', v_run.published_at,
    'sourceAsOfDate', v_run.source_as_of_date,
    'selectedCount', v_run.selected_count,
    'candidateCount', v_run.candidate_count,
    'maxSize', v_run.max_size,
    'filters', jsonb_build_object(
      'minMarketCapBillion', v_run.min_market_cap_billion,
      'minAverageVolume50d', v_run.min_average_volume_50d
    ),
    'stocks', v_stocks
  );
end;
$$;

revoke all on function public.qeo_current_market_universe(text) from public, anon, authenticated;
grant execute on function public.qeo_current_market_universe(text) to service_role;

create or replace function public.qeo_publish_market_universe_run(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.market_universe_runs%rowtype;
  v_count integer;
  v_incomplete integer;
  v_rank_min integer;
  v_rank_max integer;
begin
  select * into v_run
  from public.market_universe_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'Universe run % not found', p_run_id;
  end if;
  if v_run.status <> 'running' then
    raise exception 'Universe run % must be running before publish (status=%)', p_run_id, v_run.status;
  end if;

  select count(*),
         count(*) filter (where not detail_complete or logo_path is null or btrim(logo_path) = ''),
         min(rank),
         max(rank)
  into v_count, v_incomplete, v_rank_min, v_rank_max
  from public.market_universe_memberships
  where run_id = p_run_id;

  if v_count = 0 then
    raise exception 'Universe run % has zero memberships', p_run_id;
  end if;
  if v_count > v_run.max_size or v_count > 200 then
    raise exception 'Universe run % exceeds maximum membership count', p_run_id;
  end if;
  if v_incomplete <> 0 then
    raise exception 'Universe run % contains % incomplete membership rows', p_run_id, v_incomplete;
  end if;
  if v_rank_min <> 1 or v_rank_max <> v_count then
    raise exception 'Universe run % ranks must be contiguous 1..%', p_run_id, v_count;
  end if;

  update public.market_universe_runs
  set status = 'published',
      selected_count = v_count,
      published_at = now(),
      error_code = null,
      error_message = null
  where id = p_run_id
  returning * into v_run;

  return public.qeo_current_market_universe(v_run.universe_key);
end;
$$;

revoke all on function public.qeo_publish_market_universe_run(uuid) from public, anon, authenticated;
grant execute on function public.qeo_publish_market_universe_run(uuid) to service_role;

commit;
