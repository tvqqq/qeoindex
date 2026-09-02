\set ON_ERROR_STOP on

do $$
declare
  v_synthetic_target numeric;
  v_target_1 numeric;
  v_rls_portfolio boolean;
  v_rls_fixture boolean;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio_transactions'
      and column_name = 'qeo_recovery_legacy_target'
      and data_type = 'numeric'
  ) then
    raise exception 'QEO-26 restore assertion failed: synthetic compatibility column was not restored';
  end if;

  select qeo_recovery_legacy_target, target_price_1
  into v_synthetic_target, v_target_1
  from public.portfolio_transactions
  where id = '22222222-2222-4222-8222-222222222222';

  if v_synthetic_target is distinct from 42.50::numeric or v_target_1 is distinct from 42.50::numeric then
    raise exception 'QEO-26 restore assertion failed: portfolio recovery target values were not restored';
  end if;

  if to_regclass('public.qeo_recovery_table_fixture') is null then
    raise exception 'QEO-26 restore assertion failed: qeo_recovery_table_fixture was not restored';
  end if;

  if not exists (
    select 1
    from public.qeo_recovery_table_fixture
    where fixture_key = 'qeo26-table-drop'
      and ticker = 'QEO'
      and rank = 1
      and payload ->> 'kind' = 'synthetic'
      and (payload ->> 'market_cap_billion')::numeric = 12345
  ) then
    raise exception 'QEO-26 restore assertion failed: synthetic QEO table fixture was not restored';
  end if;

  select c.relrowsecurity
  into v_rls_portfolio
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'portfolio_transactions';

  select c.relrowsecurity
  into v_rls_fixture
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'qeo_recovery_table_fixture';

  if v_rls_portfolio is distinct from true or v_rls_fixture is distinct from true then
    raise exception 'QEO-26 restore assertion failed: RLS state was not restored';
  end if;
end;
$$;
