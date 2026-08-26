begin;

-- Forward migration: Widen result_pct and effort_pct check constraints on market_insight_sectors
-- Sector percentage changes in high-momentum or cumulative windows can exceed 100%

alter table public.market_insight_sectors
  drop constraint if exists market_insight_sectors_result_pct_check,
  add constraint market_insight_sectors_result_pct_check check (result_pct is null or result_pct between -1000 and 100000);

commit;
