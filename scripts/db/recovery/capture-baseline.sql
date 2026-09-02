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

select 'data|fixture|' || coalesce((
  select json_build_object(
    'fixture_key', fixture_key,
    'ticker', ticker,
    'rank', rank,
    'payload', payload
  )::text
  from public.qeo_recovery_table_fixture
  where fixture_key = 'qeo26-table-drop'
    and ticker = 'QEO'
), 'missing');

select 'columns|' || coalesce(string_agg(
  table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
  ',' order by table_name, ordinal_position
), '')
from information_schema.columns
where table_schema = 'public'
  and table_name in ('portfolio_transactions', 'qeo_recovery_table_fixture');

select 'constraints|' || coalesce(string_agg(
  c.conrelid::regclass::text || ':' || c.conname || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid, true),
  ',' order by c.conrelid::regclass::text, c.conname
), '')
from pg_constraint c
where c.conrelid in (
  'public.portfolio_transactions'::regclass,
  'public.qeo_recovery_table_fixture'::regclass
);

select 'indexes|' || coalesce(string_agg(
  tablename || ':' || indexname || ':' || indexdef,
  ',' order by tablename, indexname
), '')
from pg_indexes
where schemaname = 'public'
  and tablename in ('portfolio_transactions', 'qeo_recovery_table_fixture');

select 'rls|' || coalesce(string_agg(
  c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
  ',' order by c.relname
), '')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('portfolio_transactions', 'qeo_recovery_table_fixture');

select 'policies|' || coalesce(string_agg(
  tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
  ',' order by tablename, policyname
), '')
from pg_policies
where schemaname = 'public'
  and tablename in ('portfolio_transactions', 'qeo_recovery_table_fixture');

select 'privileges|' || coalesce(string_agg(
  table_name || ':' || grantee || ':' || privilege_type,
  ',' order by table_name, grantee, privilege_type
), '')
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('portfolio_transactions', 'qeo_recovery_table_fixture')
  and grantee in ('anon', 'authenticated', 'service_role');

select 'functions|' || coalesce(string_agg(
  n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
  ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
), '')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and case
    when p.prokind = 'f' then pg_get_functiondef(p.oid) ~* '(portfolio_transactions|qeo_recovery_table_fixture)'
    else false
  end;

select 'types|' || coalesce(string_agg(
  n.nspname || '.' || t.typname || ':' || t.typtype::text,
  ',' order by n.nspname, t.typname
), '')
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname in ('portfolio_transactions', 'qeo_recovery_table_fixture');
