begin;

drop policy if exists "Allow public read access to orderbook snapshots"
  on public.stock_orderbook_snapshots;

drop policy if exists "Allow service role full access to orderbook snapshots"
  on public.stock_orderbook_snapshots;

revoke all on public.stock_orderbook_snapshots from anon;
revoke all on public.stock_orderbook_snapshots from authenticated;
grant select on public.stock_orderbook_snapshots to authenticated;

create policy "Authenticated read access to orderbook snapshots"
  on public.stock_orderbook_snapshots
  for select
  to authenticated
  using (true);

create index if not exists watchlist_items_watchlist_owner_idx
  on public.watchlist_items (watchlist_id, user_id);

commit;
;
