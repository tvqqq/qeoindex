begin;

-- Repair UNIQUE (universe_key, rank, effective_date) regardless of PostgreSQL's
-- generated 63-byte constraint-name truncation. notion-unified-v2 treats source
-- Rank anomalies as warnings; ticker identity remains authoritative.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.wyckoff_universe_memberships'::regclass
      and c.contype = 'u'
      and replace(pg_get_constraintdef(c.oid), ' ', '') = 'UNIQUE(universe_key,rank,effective_date)'
  loop
    execute format('alter table public.wyckoff_universe_memberships drop constraint %I', constraint_name);
  end loop;
end $$;

comment on column public.wyckoff_universe_memberships.rank is
  'Source rank from the canonical universe. notion-unified-v2 permits null, duplicate, or out-of-range source ranks as warnings; ticker identity remains authoritative.';

commit;
