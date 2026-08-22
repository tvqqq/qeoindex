begin;

revoke select on public.insights_stock_ratings from anon;
revoke select on public.insights_stock_ratings from authenticated;

grant select (
  as_of_date,
  ticker,
  sector,
  exchange,
  price,
  price_change_pct,
  composite_score,
  score_4m,
  canslim_score,
  stock_rs_score,
  sector_rs_score,
  stock_rrg_state,
  sector_rrg_state,
  source,
  fetched_at
) on public.insights_stock_ratings to anon;

grant select (
  as_of_date,
  ticker,
  sector,
  exchange,
  price,
  price_change_pct,
  composite_score,
  score_4m,
  canslim_score,
  stock_rs_score,
  sector_rs_score,
  stock_rrg_state,
  sector_rrg_state,
  source,
  fetched_at
) on public.insights_stock_ratings to authenticated;

commit;;
