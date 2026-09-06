begin;

create table public.market_adjustment_factor_runs (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  factor_version text not null,
  engine_version text not null,
  event_lineage_hash text not null,
  as_of_date date not null,
  status text not null default 'candidate',
  blocked_reason text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_adjustment_factor_runs_ticker_check
    check (ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint market_adjustment_factor_runs_factor_version_check
    check (btrim(factor_version) <> ''),
  constraint market_adjustment_factor_runs_engine_version_check
    check (btrim(engine_version) <> ''),
  constraint market_adjustment_factor_runs_lineage_hash_check
    check (event_lineage_hash ~ '^[a-f0-9]{64}$'),
  constraint market_adjustment_factor_runs_status_check
    check (status in ('candidate', 'active', 'superseded', 'blocked')),
  constraint market_adjustment_factor_runs_blocked_reason_check
    check (
      (status = 'blocked' and blocked_reason is not null and btrim(blocked_reason) <> '')
      or (status <> 'blocked' and blocked_reason is null)
    ),
  unique (ticker, factor_version),
  unique (id, ticker)
);

create unique index market_adjustment_factor_runs_one_active_ticker_idx
  on public.market_adjustment_factor_runs (ticker)
  where status = 'active';

create index market_adjustment_factor_runs_ticker_status_idx
  on public.market_adjustment_factor_runs (ticker, status, computed_at desc);

create table public.market_price_adjustment_factors (
  run_id uuid not null,
  ticker text not null,
  effective_session date not null,
  reference_session date not null,
  reference_raw_close numeric not null,
  step_price_factor numeric not null,
  step_volume_factor numeric not null,
  cumulative_price_factor numeric not null,
  cumulative_volume_factor numeric not null,
  corporate_action_ids uuid[] not null,
  event_lineage_hash text not null,
  formula_inputs jsonb not null,
  computed_at timestamptz not null default now(),
  constraint market_price_adjustment_factors_run_fk
    foreign key (run_id, ticker)
    references public.market_adjustment_factor_runs (id, ticker)
    on delete cascade,
  constraint market_price_adjustment_factors_reference_order_check
    check (reference_session < effective_session),
  constraint market_price_adjustment_factors_reference_raw_close_check
    check (reference_raw_close > 0),
  constraint market_price_adjustment_factors_step_price_factor_check
    check (step_price_factor > 0),
  constraint market_price_adjustment_factors_step_volume_factor_check
    check (step_volume_factor > 0),
  constraint market_price_adjustment_factors_cumulative_price_factor_check
    check (cumulative_price_factor > 0),
  constraint market_price_adjustment_factors_cumulative_volume_factor_check
    check (cumulative_volume_factor > 0),
  constraint market_price_adjustment_factors_action_ids_check
    check (cardinality(corporate_action_ids) > 0),
  constraint market_price_adjustment_factors_lineage_hash_check
    check (event_lineage_hash ~ '^[a-f0-9]{64}$'),
  constraint market_price_adjustment_factors_formula_inputs_check
    check (jsonb_typeof(formula_inputs) = 'object'),
  unique (run_id, effective_session)
);

create index market_price_adjustment_factors_ticker_session_idx
  on public.market_price_adjustment_factors (ticker, effective_session desc);

alter table public.market_adjustment_factor_runs enable row level security;
alter table public.market_price_adjustment_factors enable row level security;

revoke all privileges on table public.market_adjustment_factor_runs from public, anon, authenticated;
revoke all privileges on table public.market_price_adjustment_factors from public, anon, authenticated;

grant select, insert, update on table public.market_adjustment_factor_runs to service_role;
grant select, insert, update, delete on table public.market_price_adjustment_factors to service_role;

comment on table public.market_adjustment_factor_runs is
  'QEO-124 versioned ticker-level adjustment-factor candidates/runs. Derived state only; corporate_actions remain canonical source facts.';
comment on table public.market_price_adjustment_factors is
  'QEO-124 one deterministic combined factor transition per factor run and effective session. Same-date corporate actions are represented by corporate_action_ids.';
comment on column public.market_price_adjustment_factors.formula_inputs is
  'Canonical audit payload for the theoretical ex-price calculation; not a source-of-truth replacement for corporate_actions.';

commit;
