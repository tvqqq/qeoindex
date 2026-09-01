-- stock_orderbook_snapshots is a current-state operational table. Keep it aligned
-- to the newly published canonical universe so delisted/suspended names cannot
-- linger after a monthly membership refresh.

create or replace function public.qeo_prune_noncanonical_orderbook_snapshots(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if not exists (
    select 1
    from public.market_universe_runs r
    where r.id = p_run_id
      and r.universe_key = 'vn_top_stocks'
      and r.status = 'published'
  ) then
    raise exception 'Canonical published universe run not found: %', p_run_id;
  end if;

  delete from public.stock_orderbook_snapshots s
  where not exists (
    select 1
    from public.market_universe_memberships m
    where m.run_id = p_run_id
      and m.universe_key = 'vn_top_stocks'
      and upper(m.ticker) = upper(s.symbol)
  );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.qeo_prune_noncanonical_orderbook_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.qeo_prune_noncanonical_orderbook_snapshots(uuid) to service_role;

create or replace function public.qeo_prune_orderbook_after_universe_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.universe_key = 'vn_top_stocks'
     and new.status = 'published'
     and (old.status is distinct from new.status or old.published_at is distinct from new.published_at) then
    perform public.qeo_prune_noncanonical_orderbook_snapshots(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qeo_prune_orderbook_after_universe_publish on public.market_universe_runs;
create trigger trg_qeo_prune_orderbook_after_universe_publish
after update of status, published_at on public.market_universe_runs
for each row
execute function public.qeo_prune_orderbook_after_universe_publish();

-- Clean current operational residue immediately on migration application.
do $$
declare
  v_run_id uuid;
begin
  select r.id
    into v_run_id
  from public.market_universe_runs r
  where r.universe_key = 'vn_top_stocks'
    and r.status = 'published'
  order by r.published_at desc nulls last, r.created_at desc
  limit 1;

  if v_run_id is not null then
    perform public.qeo_prune_noncanonical_orderbook_snapshots(v_run_id);
  end if;
end;
$$;
