\set ON_ERROR_STOP on

-- Recreated tables inherit Supabase default privileges before pg_restore ACL
-- entries are replayed. Reset the application roles first, then reconstruct
-- exactly the observable pre-destructive grants (including grant option).
select format(
  'revoke all privileges on table %I.%I from anon, authenticated, service_role;',
  table_schema,
  table_name
)
from (values
  ('public', 'portfolio_transactions'),
  ('public', 'wyckoff_universe_memberships')
) as target(table_schema, table_name)
order by table_name;

select format(
  'grant %s on table %I.%I to %I%s;',
  privilege_type,
  table_schema,
  table_name,
  grantee,
  case when is_grantable = 'YES' then ' with grant option' else '' end
)
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('portfolio_transactions', 'wyckoff_universe_memberships')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
