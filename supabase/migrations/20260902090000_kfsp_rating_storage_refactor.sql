-- QEO-27: contract the hot KFSP rating read model while preserving
-- bounded, private provider evidence for operational debugging.

create table if not exists public.kfsp_rating_raw_evidence (
  sync_run_id uuid not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  fetched_at timestamptz not null,
  expires_at timestamptz not null check (expires_at >= fetched_at),
  created_at timestamptz not null default now(),
  primary key (sync_run_id, ticker)
);

create index if not exists kfsp_rating_raw_evidence_expires_idx
  on public.kfsp_rating_raw_evidence(expires_at);

alter table public.kfsp_rating_raw_evidence enable row level security;
revoke all on public.kfsp_rating_raw_evidence from public, anon, authenticated;
grant select, insert, update, delete on public.kfsp_rating_raw_evidence to service_role;

-- Preserve the currently published provider payload before removing it from
-- the hot read model. Historical rows without a sync_run_id are intentionally
-- not synthesized because there is no durable run identity to attach them to.
insert into public.kfsp_rating_raw_evidence (
  sync_run_id,
  ticker,
  as_of_date,
  raw_payload,
  fetched_at,
  expires_at
)
select
  sync_run_id,
  ticker,
  as_of_date,
  raw_payload,
  fetched_at,
  fetched_at + interval '30 days'
from public.insights_stock_ratings
where source = 'kfsp'
  and is_published
  and sync_run_id is not null
  and raw_payload <> '{}'::jsonb
on conflict (sync_run_id, ticker) do update
set as_of_date = excluded.as_of_date,
    raw_payload = excluded.raw_payload,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;

-- Replace the publisher before removing the legacy columns. Staging remains the
-- transaction boundary that carries provider raw payload into bounded evidence.
create or replace function public.publish_kfsp_rating_snapshot(
  p_sync_run_id uuid,
  p_minimum_rows integer default 50
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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

  insert into public.kfsp_rating_raw_evidence (
    sync_run_id,
    ticker,
    as_of_date,
    raw_payload,
    fetched_at,
    expires_at
  )
  select
    sync_run_id,
    ticker,
    as_of_date,
    raw_payload,
    fetched_at,
    fetched_at + interval '30 days'
  from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id
  on conflict (sync_run_id, ticker) do update
  set as_of_date = excluded.as_of_date,
      raw_payload = excluded.raw_payload,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at;

  delete from public.insights_stock_ratings
  where as_of_date = v_run.as_of_date
    and source = 'kfsp';

  insert into public.insights_stock_ratings (
    as_of_date,
    ticker,
    company_name,
    sector,
    exchange,
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
    sync_run_id,
    source,
    source_url,
    fetched_at,
    is_published
  )
  select
    as_of_date,
    ticker,
    company_name,
    sector,
    exchange,
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
    v_run.contract_version,
    p_sync_run_id,
    'kfsp',
    'https://kfsp.vn/watchlist',
    fetched_at,
    true
  from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  update public.kfsp_rating_sync_runs
  set status = 'completed',
      staged_row_count = v_count,
      published_row_count = v_count,
      completed_at = now()
  where id = p_sync_run_id;

  delete from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  delete from public.kfsp_rating_raw_evidence
  where expires_at < now();

  return v_count;
end;
$function$;

-- Recreate score indexes against the one canonical score name before dropping
-- the legacy composite_score column they previously depended on.
drop index if exists public.insights_stock_ratings_date_score_idx;
drop index if exists public.insights_stock_ratings_published_date_score_idx;

create index insights_stock_ratings_date_score_idx
  on public.insights_stock_ratings(as_of_date desc, kfsp_composite_score desc, ticker);

create index insights_stock_ratings_published_date_score_idx
  on public.insights_stock_ratings(as_of_date desc, kfsp_composite_score desc, ticker)
  where is_published;

alter table public.insights_stock_ratings
  drop column if exists composite_score,
  drop column if exists score_4m,
  drop column if exists canslim_score,
  drop column if exists stock_rs_score,
  drop column if exists sector_rs_score,
  drop column if exists stock_rrg_state,
  drop column if exists sector_rrg_state,
  drop column if exists industry_group,
  drop column if exists raw_payload;

-- Preserve the authenticated read-only boundary. The dropped column grants
-- disappear with their columns; the canonical public projection is explicit.
revoke all on public.insights_stock_ratings from anon;
grant select (
  as_of_date,
  ticker,
  company_name,
  sector,
  exchange,
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
  fetched_at,
  is_published,
  source
) on public.insights_stock_ratings to authenticated;
