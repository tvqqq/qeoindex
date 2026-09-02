\set ON_ERROR_STOP on

do $$
declare
  v_target numeric;
  v_target_1 numeric;
  v_rls_portfolio boolean;
  v_rls_wyckoff boolean;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio_transactions'
      and column_name = 'target_price'
      and data_type = 'numeric'
  ) then
    raise exception 'QEO-26 restore assertion failed: portfolio_transactions.target_price was not restored';
  end if;

  select target_price, target_price_1
  into v_target, v_target_1
  from public.portfolio_transactions
  where id = '22222222-2222-4222-8222-222222222222';

  if v_target is distinct from 42.50::numeric or v_target_1 is distinct from 42.50::numeric then
    raise exception 'QEO-26 restore assertion failed: portfolio target values were not restored';
  end if;

  if to_regclass('public.wyckoff_universe_memberships') is null then
    raise exception 'QEO-26 restore assertion failed: wyckoff_universe_memberships was not restored';
  end if;

  if not exists (
    select 1
    from public.wyckoff_universe_memberships
    where universe_key = 'qeo_recovery'
      and ticker = 'QEO'
      and effective_date = date '2026-09-02'
      and rank = 1
      and market_cap_billion = 12345
      and source = 'qeo26_synthetic'
  ) then
    raise exception 'QEO-26 restore assertion failed: synthetic QEO membership row was not restored';
  end if;

  select c.relrowsecurity
  into v_rls_portfolio
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'portfolio_transactions';

  select c.relrowsecurity
  into v_rls_wyckoff
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'wyckoff_universe_memberships';

  if v_rls_portfolio is distinct from true or v_rls_wyckoff is distinct from true then
    raise exception 'QEO-26 restore assertion failed: RLS state was not restored';
  end if;
end;
$$;
