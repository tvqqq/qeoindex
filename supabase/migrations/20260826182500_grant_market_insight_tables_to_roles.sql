begin;

-- Grant SELECT on market insight read tables to both authenticated and anon roles
-- so that Next.js server components can read published post-market data seamlessly.

grant select on table public.market_insight_daily to authenticated, anon;
grant select on table public.market_insight_indexes to authenticated, anon;
grant select on table public.market_insight_sectors to authenticated, anon;
grant select on table public.market_insight_leaders to authenticated, anon;
grant select on table public.market_insight_sync_runs to authenticated, anon;

-- Ensure RLS policies allow SELECT for anon and authenticated
drop policy if exists "Authenticated users can read published market_insight_daily" on public.market_insight_daily;
drop policy if exists "Anon users can read published market_insight_daily" on public.market_insight_daily;
create policy "Allow read published market_insight_daily"
  on public.market_insight_daily
  for select
  to authenticated, anon
  using (true);

drop policy if exists "Authenticated users can read published market_insight_indexes" on public.market_insight_indexes;
drop policy if exists "Anon users can read published market_insight_indexes" on public.market_insight_indexes;
create policy "Allow read published market_insight_indexes"
  on public.market_insight_indexes
  for select
  to authenticated, anon
  using (true);

drop policy if exists "Authenticated users can read published market_insight_sectors" on public.market_insight_sectors;
drop policy if exists "Anon users can read published market_insight_sectors" on public.market_insight_sectors;
create policy "Allow read published market_insight_sectors"
  on public.market_insight_sectors
  for select
  to authenticated, anon
  using (true);

drop policy if exists "Authenticated users can read published market_insight_leaders" on public.market_insight_leaders;
drop policy if exists "Anon users can read published market_insight_leaders" on public.market_insight_leaders;
create policy "Allow read published market_insight_leaders"
  on public.market_insight_leaders
  for select
  to authenticated, anon
  using (true);

drop policy if exists "Authenticated users can read market_insight_sync_runs" on public.market_insight_sync_runs;
drop policy if exists "Anon users can read market_insight_sync_runs" on public.market_insight_sync_runs;
create policy "Allow read market_insight_sync_runs"
  on public.market_insight_sync_runs
  for select
  to authenticated, anon
  using (true);

commit;
