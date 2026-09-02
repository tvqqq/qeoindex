\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio_transactions'
      and column_name = 'target_price'
  ) then
    raise exception 'QEO-26 destructive assertion failed: portfolio_transactions.target_price still exists';
  end if;

  if to_regclass('public.wyckoff_universe_memberships') is not null then
    raise exception 'QEO-26 destructive assertion failed: wyckoff_universe_memberships still exists';
  end if;
end;
$$;
