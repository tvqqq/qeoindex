begin;

-- ---------------------------------------------------------------------------
-- KFSP rating snapshots are source/detail evidence, not a universe membership.
-- Rewrite the atomic publisher first so the legacy flags can be removed safely.
-- ---------------------------------------------------------------------------
create or replace function public.publish_kfsp_rating_snapshot(
  p_sync_run_id uuid,
  p_minimum_rows integer default 50
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
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
    price, price_change_pct,
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
    price, price_change_pct,
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
  set status = 'completed',
      staged_row_count = v_count,
      published_row_count = v_count,
      completed_at = now()
  where id = p_sync_run_id;

  delete from public.kfsp_rating_staging
  where sync_run_id = p_sync_run_id;

  return v_count;
end;
$$;

-- Remove the deprecated Top100 materialization from both staging and published ratings.
drop index if exists public.insights_stock_ratings_published_top100_score_idx;
alter table public.insights_stock_ratings drop constraint if exists insights_stock_ratings_top100_rank_check;
alter table public.kfsp_rating_staging drop constraint if exists kfsp_rating_staging_top100_rank_check;
alter table public.insights_stock_ratings drop column if exists is_top100;
alter table public.insights_stock_ratings drop column if exists top100_rank;
alter table public.kfsp_rating_staging drop column if exists is_top100;
alter table public.kfsp_rating_staging drop column if exists top100_rank;

-- Canonical Wyckoff defaults: no new row can silently inherit hose_top100.
alter table public.wyckoff_scan_runs alter column universe_key set default 'vn_top_stocks';
alter table public.wyckoff_universe_memberships alter column universe_key set default 'vn_top_stocks';

-- ---------------------------------------------------------------------------
-- Clean-slate derived data. These tables can be deterministically rebuilt from
-- KFSP + persistent OHLCV + the freshly published canonical universe.
-- ---------------------------------------------------------------------------
truncate table
  public.ai_council_confirmations,
  public.ai_council_llm_debates,
  public.ai_council_llm_evidence,
  public.ai_council_llm_research_contexts,
  public.ai_council_outcomes,
  public.ai_council_votes,
  public.ai_council_runs
restart identity cascade;

truncate table
  public.wyckoff_analysis_snapshots,
  public.wyckoff_chart_series,
  public.wyckoff_universe_memberships,
  public.wyckoff_scan_runs
restart identity cascade;

-- Current market/orderbook projections are rebuilt immediately after cutover.
truncate table public.stock_orderbook_snapshots restart identity cascade;

-- Keep the already-published vn_top_stocks snapshot live during the destructive
-- cutover. After the fresh monthly publisher succeeds, release automation deletes
-- superseded market_universe runs. This avoids an empty-universe production window.

-- Remove stale cached/derived TTAI synchronization state only; provider quarterly history remains
-- source evidence and is not a Top100 membership materialization.
truncate table public.kfsp_ttai_sync_state restart identity cascade;

commit;
