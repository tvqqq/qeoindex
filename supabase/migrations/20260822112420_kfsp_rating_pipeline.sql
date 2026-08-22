begin;

alter table public.insights_stock_ratings
  add column if not exists company_name text,
  add column if not exists industry_group text,
  add column if not exists is_top100 boolean not null default false,
  add column if not exists top100_rank smallint check (top100_rank is null or top100_rank between 1 and 100),
  add column if not exists average_volume_50_sessions bigint check (average_volume_50_sessions is null or average_volume_50_sessions >= 0),
  add column if not exists market_cap_billion numeric check (market_cap_billion is null or market_cap_billion >= 0),
  add column if not exists kfsp_composite_score numeric check (kfsp_composite_score is null or kfsp_composite_score between 0 and 100),
  add column if not exists kfsp_score_4m numeric check (kfsp_score_4m is null or kfsp_score_4m between 0 and 100),
  add column if not exists kfsp_canslim_score numeric check (kfsp_canslim_score is null or kfsp_canslim_score between 0 and 100),
  add column if not exists kfsp_price_potential text,
  add column if not exists kfsp_stock_rs_score numeric check (kfsp_stock_rs_score is null or kfsp_stock_rs_score between 0 and 100),
  add column if not exists kfsp_sector_rs_score numeric check (kfsp_sector_rs_score is null or kfsp_sector_rs_score between 0 and 100),
  add column if not exists kfsp_stock_rrg_state text,
  add column if not exists kfsp_sector_rrg_state text,
  add column if not exists rs_short numeric,
  add column if not exists rs_medium numeric,
  add column if not exists rsi_14 numeric,
  add column if not exists weekly_change_pct numeric,
  add column if not exists monthly_change_pct numeric,
  add column if not exists beta numeric,
  add column if not exists pe_ttm numeric,
  add column if not exists pb_ttm numeric,
  add column if not exists kfsp_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(kfsp_metrics) = 'object'),
  add column if not exists kfsp_contract_version integer not null default 1 check (kfsp_contract_version > 0),
  add column if not exists sync_run_id uuid;

update public.insights_stock_ratings
set
  kfsp_composite_score = coalesce(kfsp_composite_score, composite_score),
  kfsp_score_4m = coalesce(kfsp_score_4m, score_4m),
  kfsp_canslim_score = coalesce(kfsp_canslim_score, canslim_score),
  kfsp_stock_rs_score = coalesce(kfsp_stock_rs_score, stock_rs_score),
  kfsp_sector_rs_score = coalesce(kfsp_sector_rs_score, sector_rs_score),
  kfsp_stock_rrg_state = coalesce(kfsp_stock_rrg_state, stock_rrg_state),
  kfsp_sector_rrg_state = coalesce(kfsp_sector_rrg_state, sector_rrg_state)
where source = 'kfsp';

comment on column public.insights_stock_ratings.kfsp_metrics is
  'English-keyed KFSP metrics grouped into overview, general, valuation, fundamentals, price_volatility, price_range, liquidity, technical, and kfsp.';
comment on column public.insights_stock_ratings.kfsp_composite_score is
  'QeoIndex average of available KFSP 4M, CANSLIM, stock RS-S, and sector RS-S values; null when every component is absent.';

create table if not exists public.kfsp_rating_sync_runs (
  id uuid primary key,
  as_of_date date not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  provider text not null default 'kfsp',
  provider_row_count integer not null default 0 check (provider_row_count >= 0),
  staged_row_count integer not null default 0 check (staged_row_count >= 0),
  published_row_count integer not null default 0 check (published_row_count >= 0),
  token_refreshed boolean not null default false,
  contract_version integer not null default 1,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.kfsp_provider_tokens (
  provider text primary key check (provider = 'kfsp'),
  access_token text not null,
  expires_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfsp_rating_staging (
  sync_run_id uuid not null references public.kfsp_rating_sync_runs(id) on delete cascade,
  as_of_date date not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  company_name text,
  sector text,
  industry_group text,
  exchange text,
  is_top100 boolean not null default false,
  top100_rank smallint check (top100_rank is null or top100_rank between 1 and 100),
  price numeric check (price is null or price >= 0),
  price_change_pct numeric,
  average_volume_50_sessions bigint check (average_volume_50_sessions is null or average_volume_50_sessions >= 0),
  market_cap_billion numeric check (market_cap_billion is null or market_cap_billion >= 0),
  kfsp_composite_score numeric check (kfsp_composite_score is null or kfsp_composite_score between 0 and 100),
  kfsp_score_4m numeric check (kfsp_score_4m is null or kfsp_score_4m between 0 and 100),
  kfsp_canslim_score numeric check (kfsp_canslim_score is null or kfsp_canslim_score between 0 and 100),
  kfsp_price_potential text,
  kfsp_stock_rs_score numeric check (kfsp_stock_rs_score is null or kfsp_stock_rs_score between 0 and 100),
  kfsp_sector_rs_score numeric check (kfsp_sector_rs_score is null or kfsp_sector_rs_score between 0 and 100),
  kfsp_stock_rrg_state text,
  kfsp_sector_rrg_state text,
  rs_short numeric,
  rs_medium numeric,
  rsi_14 numeric,
  weekly_change_pct numeric,
  monthly_change_pct numeric,
  beta numeric,
  pe_ttm numeric,
  pb_ttm numeric,
  kfsp_metrics jsonb not null check (jsonb_typeof(kfsp_metrics) = 'object'),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  fetched_at timestamptz not null,
  primary key (sync_run_id, ticker)
);

alter table public.kfsp_rating_sync_runs enable row level security;
alter table public.kfsp_provider_tokens enable row level security;
alter table public.kfsp_rating_staging enable row level security;

revoke all privileges on table public.kfsp_rating_sync_runs from anon, authenticated;
revoke all privileges on table public.kfsp_provider_tokens from anon, authenticated;
revoke all privileges on table public.kfsp_rating_staging from anon, authenticated;
grant all privileges on table public.kfsp_rating_sync_runs to service_role;
grant all privileges on table public.kfsp_provider_tokens to service_role;
grant all privileges on table public.kfsp_rating_staging to service_role;

create index if not exists insights_stock_ratings_published_sector_score_idx
  on public.insights_stock_ratings(as_of_date desc, sector, kfsp_composite_score desc, ticker)
  where is_published and source = 'kfsp';

create index if not exists insights_stock_ratings_published_top100_score_idx
  on public.insights_stock_ratings(as_of_date desc, kfsp_composite_score desc, ticker)
  where is_published and source = 'kfsp' and is_top100;

create index if not exists kfsp_rating_sync_runs_started_idx
  on public.kfsp_rating_sync_runs(started_at desc);

revoke select on public.insights_stock_ratings from authenticated;
grant select (
  as_of_date,
  ticker,
  company_name,
  sector,
  industry_group,
  exchange,
  is_top100,
  top100_rank,
  price,
  price_change_pct,
  average_volume_50_sessions,
  market_cap_billion,
  kfsp_composite_score,
  kfsp_score_4m,
  kfsp_canslim_score,
  kfsp_price_potential,
  kfsp_stock_rs_score,
  kfsp_sector_rs_score,
  kfsp_stock_rrg_state,
  kfsp_sector_rrg_state,
  rs_short,
  rs_medium,
  rsi_14,
  weekly_change_pct,
  monthly_change_pct,
  beta,
  pe_ttm,
  pb_ttm,
  kfsp_metrics,
  kfsp_contract_version,
  source,
  fetched_at,
  is_published
) on public.insights_stock_ratings to authenticated;

create or replace function public.publish_kfsp_rating_snapshot(
  p_sync_run_id uuid,
  p_minimum_rows integer default 50
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.kfsp_rating_sync_runs%rowtype;
  v_count integer;
begin
  select * into v_run
  from public.kfsp_rating_sync_runs
  where id = p_sync_run_id
  for update;

  if not found or v_run.status <> 'running' then
    raise exception 'KFSP sync run is missing or is not running';
  end if;

  select count(*) into v_count
  from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  if v_count < greatest(p_minimum_rows, 1) then
    raise exception 'KFSP snapshot rejected: % rows is below minimum %', v_count, p_minimum_rows;
  end if;

  if exists (
    select 1
    from public.kfsp_rating_staging
    where sync_run_id = p_sync_run_id
      and kfsp_composite_score is null
      and kfsp_score_4m is null
      and kfsp_canslim_score is null
      and kfsp_stock_rs_score is null
  ) then
    raise exception 'KFSP snapshot rejected: one or more rows contain no score';
  end if;

  delete from public.insights_stock_ratings
  where as_of_date = v_run.as_of_date
    and source = 'kfsp';

  insert into public.insights_stock_ratings (
    as_of_date, ticker, company_name, sector, industry_group, exchange,
    is_top100, top100_rank, price, price_change_pct,
    average_volume_50_sessions, market_cap_billion,
    composite_score, score_4m, canslim_score, stock_rs_score, sector_rs_score,
    stock_rrg_state, sector_rrg_state,
    kfsp_composite_score, kfsp_score_4m, kfsp_canslim_score, kfsp_price_potential,
    kfsp_stock_rs_score, kfsp_sector_rs_score, kfsp_stock_rrg_state, kfsp_sector_rrg_state,
    rs_short, rs_medium, rsi_14, weekly_change_pct, monthly_change_pct, beta, pe_ttm, pb_ttm,
    kfsp_metrics, kfsp_contract_version, sync_run_id,
    source, source_url, raw_payload, fetched_at, is_published
  )
  select
    as_of_date, ticker, company_name, sector, industry_group, exchange,
    is_top100, top100_rank, price, price_change_pct,
    average_volume_50_sessions, market_cap_billion,
    kfsp_composite_score, kfsp_score_4m, kfsp_canslim_score,
    kfsp_stock_rs_score, kfsp_sector_rs_score, kfsp_stock_rrg_state, kfsp_sector_rrg_state,
    kfsp_composite_score, kfsp_score_4m, kfsp_canslim_score, kfsp_price_potential,
    kfsp_stock_rs_score, kfsp_sector_rs_score, kfsp_stock_rrg_state, kfsp_sector_rrg_state,
    rs_short, rs_medium, rsi_14, weekly_change_pct, monthly_change_pct, beta, pe_ttm, pb_ttm,
    kfsp_metrics, v_run.contract_version, p_sync_run_id,
    'kfsp', 'https://kfsp.vn/watchlist', raw_payload, fetched_at, true
  from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  update public.kfsp_rating_sync_runs
  set
    status = 'completed',
    staged_row_count = v_count,
    published_row_count = v_count,
    completed_at = now()
  where id = p_sync_run_id;

  delete from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  return v_count;
end;
$$;

revoke all on function public.publish_kfsp_rating_snapshot(uuid, integer) from public, anon, authenticated;
grant execute on function public.publish_kfsp_rating_snapshot(uuid, integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kfsp-rating-daily-7am-ict') then
    perform cron.unschedule('kfsp-rating-daily-7am-ict');
  end if;
end $$;

select cron.schedule(
  'kfsp-rating-daily-7am-ict',
  '0 0 * * *',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-rating-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-KFSP-Sync-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'kfsp_sync_secret' limit 1),
        ''
      )
    ),
    body := jsonb_build_object('source', 'supabase_pg_cron'),
    timeout_milliseconds := 55000
  );
  $cron$
);

commit;
