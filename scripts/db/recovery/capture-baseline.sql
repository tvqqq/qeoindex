\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Stable, scoped application contract for the two representative destructive classes.
select 'data|portfolio|' || coalesce((
  select json_build_object(
    'ticker', ticker,
    'target_price', target_price,
    'target_price_1', target_price_1,
    'stop_loss', stop_loss,
    'stop_loss_1', stop_loss_1,
    'quantity', quantity,
    'price', price,
    'transaction_date', transaction_date
  )::text
  from public.portfolio_transactions
  where id = '22222222-2222-4222-8222-222222222222'
), 'missing');

select 'data|wyckoff|' || coalesce((
  select json_build_object(
    'universe_key', universe_key,
    'ticker', ticker,
    'exchange', exchange,
    'rank', rank,
    'sector', sector,
    'market_cap_billion', market_cap_billion,
    'effective_date', effective_date,
    'active', active,
    'source', source
  )::text
  from public.wyckoff_universe_memberships
  where universe_key = 'qeo_recovery'
    and ticker = 'QEO'
    and effective_date = date '2026-09-02'
), 'missing');

select 'columns|' || coalesce(string_agg(
  table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
  ',' order by table_name, ordinal_position
), '')
from information_schema.columns
where table_schema = 'public'
  and table_name in ('portfolio_transactions', 'wyckoff_universe_memberships');

select 'constraints|' || coalesce(string_agg(
  c.conrelid::regclass::text || ':' || c.conname || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid, true),
  ',' order by c.conrelid::regclass::text, c.conname
), '')
from pg_constraint c
where c.conrelid in (
  'public.portfolio_transactions'::regclass,
  'public.wyckoff_universe_memberships'::regclass
);

select 'indexes|' || coalesce(string_agg(
  tablename || ':' || indexname || ':' || indexdef,
  ',' order by tablename, indexname
), '')
from pg_indexes
where schemaname = 'public'
  and tablename in ('portfolio_transactions', 'wyckoff_universe_memberships');

select 'rls|' || coalesce(string_agg(
  c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
  ',' order by c.relname
), '')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('portfolio_transactions', 'wyckoff_universe_memberships');

select 'policies|' || coalesce(string_agg(
  tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
  ',' order by tablename, policyname
), '')
from pg_policies
where schemaname = 'public'
  and tablename in ('portfolio_transactions', 'wyckoff_universe_memberships');

select 'privileges|' || coalesce(string_agg(
  table_name || ':' || grantee || ':' || privilege_type,
  ',' order by table_name, grantee, privilege_type
), '')
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('portfolio_transactions', 'wyckoff_universe_memberships')
  and grantee in ('anon', 'authenticated', 'service_role');

select 'functions|' || coalesce(string_agg(
  n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
  ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
), '')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and case
    when p.prokind = 'f' then pg_get_functiondef(p.oid) ~* '(portfolio_transactions|wyckoff_universe_memberships)'
    else false
  end;

select 'types|' || coalesce(string_agg(
  n.nspname || '.' || t.typname || ':' || t.typtype::text,
  ',' order by n.nspname, t.typname
), '')
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname in ('portfolio_transactions', 'wyckoff_universe_memberships');
