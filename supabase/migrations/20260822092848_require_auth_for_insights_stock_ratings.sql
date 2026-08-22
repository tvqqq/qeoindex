begin;

alter table public.insights_stock_ratings
  add column if not exists is_published boolean not null default false;

comment on column public.insights_stock_ratings.is_published is
  'Set true only after a complete daily provider batch has been validated.';

create index if not exists insights_stock_ratings_published_date_score_idx
  on public.insights_stock_ratings(as_of_date desc, composite_score desc, ticker)
  where is_published;

revoke select (
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
) on public.insights_stock_ratings from anon;

revoke all privileges on table public.insights_stock_ratings from anon;

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
  fetched_at,
  is_published
) on public.insights_stock_ratings to authenticated;

drop policy if exists insights_stock_ratings_public_read
  on public.insights_stock_ratings;
drop policy if exists insights_stock_ratings_authenticated_read
  on public.insights_stock_ratings;

create policy insights_stock_ratings_authenticated_read
on public.insights_stock_ratings
for select
to authenticated
using (is_published);

commit;
