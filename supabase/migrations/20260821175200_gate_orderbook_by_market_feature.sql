begin;

drop policy if exists "Authenticated read access to orderbook snapshots"
  on public.stock_orderbook_snapshots;

create policy "Market feature read access to orderbook snapshots"
  on public.stock_orderbook_snapshots
  for select
  to authenticated
  using (
    (select exists (
      select 1
      from public.user_features feature
      where feature.user_id = (select auth.uid())
        and feature.feature_key = 'market_board'
        and feature.enabled = true
    ))
  );

commit;
