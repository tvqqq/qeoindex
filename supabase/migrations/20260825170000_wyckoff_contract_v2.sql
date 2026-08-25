begin;

-- notion-unified-v2: Rank defects are warnings. Ticker identity is authoritative.
alter table public.wyckoff_universe_memberships
  drop constraint if exists wyckoff_universe_memberships_universe_key_rank_effective_date_key,
  drop constraint if exists wyckoff_universe_memberships_rank_check;

alter table public.wyckoff_universe_memberships
  alter column rank drop not null;

-- Persist the staging contract identity so v2 rows cannot be shadowed by same-bar v1 rows.
alter table public.wyckoff_scan_runs
  add column if not exists prompt_version text not null default 'notion-unified-v1';

alter table public.wyckoff_analysis_snapshots
  add column if not exists prompt_version text not null default 'notion-unified-v1';

do $$
declare
  constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  where c.conrelid = 'public.wyckoff_analysis_snapshots'::regclass
    and c.contype = 'u'
    and pg_get_constraintdef(c.oid) ilike '%ticker%timeframe%bar_closed_at%model_version%aggregation_version%'
    and pg_get_constraintdef(c.oid) not ilike '%prompt_version%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.wyckoff_analysis_snapshots drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.wyckoff_analysis_snapshots
  drop constraint if exists wyckoff_snapshot_version_identity;

alter table public.wyckoff_analysis_snapshots
  add constraint wyckoff_snapshot_version_identity
  unique (ticker, timeframe, bar_closed_at, model_version, aggregation_version, prompt_version);

-- Genuine Incomplete snapshots must be representable without fabricated analysis.
alter table public.wyckoff_analysis_snapshots
  drop constraint if exists wyckoff_probability_sum;

alter table public.wyckoff_analysis_snapshots
  alter column phase drop not null,
  alter column wyckoff_state drop not null,
  alter column ta_bias drop not null,
  alter column confidence drop not null,
  alter column bull_probability drop not null,
  alter column base_probability drop not null,
  alter column bear_probability drop not null,
  alter column support drop not null,
  alter column resistance drop not null,
  alter column confirmation drop not null,
  alter column invalidation drop not null,
  alter column what_changed drop not null;

alter table public.wyckoff_analysis_snapshots
  drop constraint if exists wyckoff_complete_contract,
  drop constraint if exists wyckoff_incomplete_contract;

alter table public.wyckoff_analysis_snapshots
  add constraint wyckoff_complete_contract check (
    history_status <> 'complete'
    or (
      history_bar_count >= 60
      and phase is not null
      and wyckoff_state is not null
      and ta_bias is not null
      and confidence is not null
      and bull_probability is not null
      and base_probability is not null
      and bear_probability is not null
      and bull_probability + base_probability + bear_probability = 100
      and support is not null
      and resistance is not null
      and confirmation is not null
      and invalidation is not null
      and what_changed is not null
      and jsonb_typeof(technical) = 'object'
      and jsonb_typeof(markers) = 'array'
      and jsonb_typeof(scenarios) = 'array'
      and jsonb_array_length(scenarios) = 3
    )
  ),
  add constraint wyckoff_incomplete_contract check (
    history_status <> 'incomplete'
    or (
      phase is null
      and wyckoff_state is null
      and ta_bias is null
      and confidence is null
      and bull_probability is null
      and base_probability is null
      and bear_probability is null
      and support is null
      and resistance is null
      and confirmation is null
      and invalidation is null
      and what_changed is null
      and jsonb_typeof(technical) = 'object'
      and technical = '{}'::jsonb
      and jsonb_typeof(markers) = 'array'
      and jsonb_array_length(markers) = 0
      and jsonb_typeof(scenarios) = 'array'
      and jsonb_array_length(scenarios) = 0
      and nullif(btrim(coalesce(evidence->>'missingReason', '')), '') is not null
    )
  );

comment on column public.wyckoff_universe_memberships.rank is
  'Source rank from the canonical universe. notion-unified-v2 permits null, duplicate, or out-of-range source ranks as warnings; ticker identity remains authoritative.';

comment on column public.wyckoff_analysis_snapshots.prompt_version is
  'Staging contract identity. Included in operational uniqueness so same-bar v1 and v2 evidence remain separately auditable.';

comment on table public.wyckoff_analysis_snapshots is
  'notion-unified-v2 operational Wyckoff evidence. Complete rows require >=60 bars and full analysis; genuine Incomplete rows carry missingReason and no fabricated analysis.';

commit;
