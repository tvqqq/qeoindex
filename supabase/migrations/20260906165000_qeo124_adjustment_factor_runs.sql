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

create or replace function public.qeo_persist_adjustment_factor_candidate(
  p_ticker text,
  p_factor_version text,
  p_engine_version text,
  p_event_lineage_hash text,
  p_as_of_date date,
  p_status text,
  p_blocked_reason text,
  p_transitions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_transition jsonb;
  v_action_ids uuid[];
  v_sorted_action_ids uuid[];
  v_action_count integer;
  v_distinct_action_count integer;
begin
  if p_ticker is null or p_ticker !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'adjustment-factor ticker is invalid';
  end if;
  if p_engine_version is null or btrim(p_engine_version) = '' then
    raise exception 'adjustment-factor engine version is required';
  end if;
  if p_event_lineage_hash is null or p_event_lineage_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'adjustment-factor lineage hash is invalid';
  end if;
  if p_factor_version is distinct from p_engine_version || ':' || p_event_lineage_hash then
    raise exception 'adjustment-factor version does not match engine and lineage identity';
  end if;
  if p_as_of_date is null then
    raise exception 'adjustment-factor as-of date is required';
  end if;
  if p_status not in ('candidate', 'blocked') then
    raise exception 'QEO-124 persistence accepts candidate or blocked runs only';
  end if;
  if (p_status = 'blocked' and (p_blocked_reason is null or btrim(p_blocked_reason) = ''))
    or (p_status = 'candidate' and p_blocked_reason is not null) then
    raise exception 'adjustment-factor blocked reason does not match status';
  end if;
  if jsonb_typeof(p_transitions) <> 'array' then
    raise exception 'adjustment-factor transitions must be a JSON array';
  end if;
  if p_status = 'blocked' and jsonb_array_length(p_transitions) <> 0 then
    raise exception 'blocked adjustment-factor run cannot carry transitions';
  end if;

  insert into public.market_adjustment_factor_runs (
    ticker,
    factor_version,
    engine_version,
    event_lineage_hash,
    as_of_date,
    status,
    blocked_reason,
    computed_at,
    updated_at
  ) values (
    p_ticker,
    p_factor_version,
    p_engine_version,
    p_event_lineage_hash,
    p_as_of_date,
    p_status,
    p_blocked_reason,
    now(),
    now()
  )
  on conflict (ticker, factor_version)
  do update set
    as_of_date = greatest(public.market_adjustment_factor_runs.as_of_date, excluded.as_of_date),
    status = excluded.status,
    blocked_reason = excluded.blocked_reason,
    computed_at = now(),
    updated_at = now()
  where public.market_adjustment_factor_runs.status in ('candidate', 'blocked')
    and public.market_adjustment_factor_runs.engine_version = excluded.engine_version
    and public.market_adjustment_factor_runs.event_lineage_hash = excluded.event_lineage_hash
  returning id into v_run_id;

  if v_run_id is null then
    raise exception 'adjustment-factor run identity is immutable or already activated';
  end if;

  delete from public.market_price_adjustment_factors
  where run_id = v_run_id;

  for v_transition in
    select value from jsonb_array_elements(p_transitions)
  loop
    if jsonb_typeof(v_transition) <> 'object' then
      raise exception 'adjustment-factor transition must be a JSON object';
    end if;
    if jsonb_typeof(v_transition -> 'corporate_action_ids') <> 'array'
      or jsonb_array_length(v_transition -> 'corporate_action_ids') = 0 then
      raise exception 'adjustment-factor transition must include corporate action ids';
    end if;
    if jsonb_typeof(v_transition -> 'formula_inputs') <> 'object' then
      raise exception 'adjustment-factor transition formula inputs must be an object';
    end if;
    if nullif(v_transition ->> 'event_lineage_hash', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'adjustment-factor transition lineage hash is invalid';
    end if;

    select
      array_agg(value::uuid),
      array_agg(value::uuid order by value),
      count(*),
      count(distinct value)
    into v_action_ids, v_sorted_action_ids, v_action_count, v_distinct_action_count
    from jsonb_array_elements_text(v_transition -> 'corporate_action_ids') as ids(value);

    if v_action_count <> v_distinct_action_count then
      raise exception 'adjustment-factor transition contains duplicate corporate action ids';
    end if;
    if v_action_ids is distinct from v_sorted_action_ids then
      raise exception 'adjustment-factor corporate action ids must be sorted';
    end if;

    insert into public.market_price_adjustment_factors (
      run_id,
      ticker,
      effective_session,
      reference_session,
      reference_raw_close,
      step_price_factor,
      step_volume_factor,
      cumulative_price_factor,
      cumulative_volume_factor,
      corporate_action_ids,
      event_lineage_hash,
      formula_inputs,
      computed_at
    ) values (
      v_run_id,
      p_ticker,
      nullif(v_transition ->> 'effective_session', '')::date,
      nullif(v_transition ->> 'reference_session', '')::date,
      nullif(v_transition ->> 'reference_raw_close', '')::numeric,
      nullif(v_transition ->> 'step_price_factor', '')::numeric,
      nullif(v_transition ->> 'step_volume_factor', '')::numeric,
      nullif(v_transition ->> 'cumulative_price_factor', '')::numeric,
      nullif(v_transition ->> 'cumulative_volume_factor', '')::numeric,
      v_action_ids,
      v_transition ->> 'event_lineage_hash',
      v_transition -> 'formula_inputs',
      now()
    );
  end loop;

  return v_run_id;
end
$$;

revoke all on function public.qeo_persist_adjustment_factor_candidate(text, text, text, text, date, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.qeo_persist_adjustment_factor_candidate(text, text, text, text, date, text, text, jsonb)
  to service_role;

comment on table public.market_adjustment_factor_runs is
  'QEO-124 versioned ticker-level adjustment-factor candidates/runs. Derived state only; corporate_actions remain canonical source facts.';
comment on table public.market_price_adjustment_factors is
  'QEO-124 one deterministic combined factor transition per factor run and effective session. Same-date corporate actions are represented by corporate_action_ids.';
comment on column public.market_price_adjustment_factors.formula_inputs is
  'Canonical audit payload for the theoretical ex-price calculation; not a source-of-truth replacement for corporate_actions.';
comment on function public.qeo_persist_adjustment_factor_candidate(text, text, text, text, date, text, text, jsonb) is
  'QEO-124 service-role-only atomic persistence for deterministic candidate/blocked factor runs. Existing active/superseded runs are immutable through this boundary.';

commit;
