-- QEO-138 — Risk Profile, Discipline Profile and versioned Money Management Plan.
-- Additive only. Existing portfolios and Trades intentionally receive no fabricated profile,
-- plan or plan-provenance rows; portfolio_trades.money_management_plan_id remains NULL until
-- an explicit application action attaches a saved plan to a planned Trade.

begin;

create table public.portfolio_risk_profile_attempts (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,

  market_risk_points smallint not null check (market_risk_points in (5, 10, 15)),
  active_return_12m_points smallint not null check (active_return_12m_points in (5, 10, 15)),
  win_ratio_points smallint not null check (win_ratio_points in (5, 10, 15)),
  personal_risk_tolerance_points smallint not null check (personal_risk_tolerance_points in (5, 10, 15)),
  experience_points smallint not null check (experience_points in (5, 10, 15)),
  payoff_ratio_points smallint not null check (payoff_ratio_points in (5, 10, 15)),

  total_score smallint generated always as ((
    market_risk_points
    + active_return_12m_points
    + win_ratio_points
    + personal_risk_tolerance_points
    + experience_points
    + payoff_ratio_points
  )::smallint) stored,
  score_band text generated always as (
    case
      when (
        market_risk_points
        + active_return_12m_points
        + win_ratio_points
        + personal_risk_tolerance_points
        + experience_points
        + payoff_ratio_points
      ) < 50 then 'low'
      when (
        market_risk_points
        + active_return_12m_points
        + win_ratio_points
        + personal_risk_tolerance_points
        + experience_points
        + payoff_ratio_points
      ) < 70 then 'middle'
      else 'high'
    end
  ) stored,

  metric_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metric_evidence) = 'object'),
  created_at timestamptz not null default now(),

  unique (id, portfolio_id, user_id),
  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade
);

create table public.portfolio_discipline_profile_attempts (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,

  punctuality_points smallint not null check (punctuality_points in (5, 10, 15)),
  diet_self_control_points smallint not null check (diet_self_control_points in (5, 10, 15)),
  record_keeping_points smallint not null check (record_keeping_points in (5, 10, 15)),
  office_clutter_points smallint not null check (office_clutter_points in (5, 10, 15)),
  bills_expenses_points smallint not null check (bills_expenses_points in (5, 10, 15)),
  exercise_routine_points smallint not null check (exercise_routine_points in (5, 10, 15)),

  total_score smallint generated always as ((
    punctuality_points
    + diet_self_control_points
    + record_keeping_points
    + office_clutter_points
    + bills_expenses_points
    + exercise_routine_points
  )::smallint) stored,
  score_band text generated always as (
    case
      when (
        punctuality_points
        + diet_self_control_points
        + record_keeping_points
        + office_clutter_points
        + bills_expenses_points
        + exercise_routine_points
      ) < 50 then 'low'
      when (
        punctuality_points
        + diet_self_control_points
        + record_keeping_points
        + office_clutter_points
        + bills_expenses_points
        + exercise_routine_points
      ) < 70 then 'middle'
      else 'high'
    end
  ) stored,

  created_at timestamptz not null default now(),

  unique (id, portfolio_id, user_id),
  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade
);

create table public.portfolio_money_management_plans (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  risk_profile_attempt_id uuid,
  discipline_profile_attempt_id uuid,
  schema_version integer not null default 1 check (schema_version > 0),

  default_trade_risk_percent numeric(7,4) not null
    check (default_trade_risk_percent > 0 and default_trade_risk_percent <= 100),
  advanced_risk_override_acknowledged boolean not null default false,
  max_active_risk_percent numeric(7,4) not null
    check (max_active_risk_percent > 0 and max_active_risk_percent <= 100),

  drawdown_reduce_enabled boolean not null default false,
  drawdown_reduce_threshold_percent numeric(7,4)
    check (
      drawdown_reduce_threshold_percent is null
      or (drawdown_reduce_threshold_percent > 0 and drawdown_reduce_threshold_percent <= 100)
    ),
  risk_reduction_factor numeric(7,6)
    check (risk_reduction_factor is null or (risk_reduction_factor > 0 and risk_reduction_factor < 1)),

  drawdown_pause_enabled boolean not null default false,
  drawdown_pause_threshold_percent numeric(7,4)
    check (
      drawdown_pause_threshold_percent is null
      or (drawdown_pause_threshold_percent > 0 and drawdown_pause_threshold_percent <= 100)
    ),

  consecutive_stop_outs_enabled boolean not null default false,
  consecutive_stop_outs_threshold integer
    check (consecutive_stop_outs_threshold is null or consecutive_stop_outs_threshold > 0),
  rolling_trade_loss_enabled boolean not null default false,
  rolling_trade_count integer
    check (rolling_trade_count is null or rolling_trade_count > 0),

  holiday_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(holiday_rules) = 'object'),
  execution_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(execution_rules) = 'object'),
  scale_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scale_rules) = 'object'),
  diversification_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(diversification_rules) = 'object'),
  risk_capital_policy jsonb not null default '{"mode":"disabled"}'::jsonb
    check (jsonb_typeof(risk_capital_policy) = 'object'),
  notes text,
  created_at timestamptz not null default now(),

  unique (portfolio_id, version),
  unique (id, portfolio_id, user_id),

  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade,
  foreign key (risk_profile_attempt_id, portfolio_id, user_id)
    references public.portfolio_risk_profile_attempts(id, portfolio_id, user_id)
    on delete restrict,
  foreign key (discipline_profile_attempt_id, portfolio_id, user_id)
    references public.portfolio_discipline_profile_attempts(id, portfolio_id, user_id)
    on delete restrict,

  check (default_trade_risk_percent <= 2 or advanced_risk_override_acknowledged),
  check (max_active_risk_percent >= default_trade_risk_percent),
  check (
    (not drawdown_reduce_enabled and drawdown_reduce_threshold_percent is null and risk_reduction_factor is null)
    or (
      drawdown_reduce_enabled
      and drawdown_reduce_threshold_percent is not null
      and risk_reduction_factor is not null
    )
  ),
  check (
    (not drawdown_pause_enabled and drawdown_pause_threshold_percent is null)
    or (drawdown_pause_enabled and drawdown_pause_threshold_percent is not null)
  ),
  check (
    not (drawdown_reduce_enabled and drawdown_pause_enabled)
    or drawdown_pause_threshold_percent >= drawdown_reduce_threshold_percent
  ),
  check (
    (not consecutive_stop_outs_enabled and consecutive_stop_outs_threshold is null)
    or (consecutive_stop_outs_enabled and consecutive_stop_outs_threshold is not null)
  ),
  check (
    (not rolling_trade_loss_enabled and rolling_trade_count is null)
    or (rolling_trade_loss_enabled and rolling_trade_count is not null)
  )
);

alter table public.portfolio_trades
  add column money_management_plan_id uuid;

alter table public.portfolio_trades
  add constraint portfolio_trades_money_management_plan_identity_fkey
  foreign key (money_management_plan_id, portfolio_id, user_id)
  references public.portfolio_money_management_plans(id, portfolio_id, user_id)
  on delete restrict;

create index portfolio_risk_profile_attempts_portfolio_owner_idx
  on public.portfolio_risk_profile_attempts(portfolio_id, user_id, created_at desc);

create index portfolio_discipline_profile_attempts_portfolio_owner_idx
  on public.portfolio_discipline_profile_attempts(portfolio_id, user_id, created_at desc);

create index portfolio_money_management_plans_portfolio_owner_idx
  on public.portfolio_money_management_plans(portfolio_id, user_id, version desc);

create index portfolio_money_management_plans_risk_profile_fk_idx
  on public.portfolio_money_management_plans(risk_profile_attempt_id, portfolio_id, user_id);

create index portfolio_money_management_plans_discipline_profile_fk_idx
  on public.portfolio_money_management_plans(discipline_profile_attempt_id, portfolio_id, user_id);

create index portfolio_trades_money_management_plan_fk_idx
  on public.portfolio_trades(money_management_plan_id, portfolio_id, user_id);

alter table public.portfolio_risk_profile_attempts enable row level security;
alter table public.portfolio_discipline_profile_attempts enable row level security;
alter table public.portfolio_money_management_plans enable row level security;

-- Default privileges can be broader than this append-only history contract.
revoke all on table public.portfolio_risk_profile_attempts from anon, authenticated;
revoke all on table public.portfolio_discipline_profile_attempts from anon, authenticated;
revoke all on table public.portfolio_money_management_plans from anon, authenticated;

grant select, insert on table public.portfolio_risk_profile_attempts to authenticated;
grant select, insert on table public.portfolio_discipline_profile_attempts to authenticated;
grant select, insert on table public.portfolio_money_management_plans to authenticated;

create policy portfolio_risk_profile_attempts_select_own
  on public.portfolio_risk_profile_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_risk_profile_attempts_insert_own
  on public.portfolio_risk_profile_attempts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy portfolio_discipline_profile_attempts_select_own
  on public.portfolio_discipline_profile_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_discipline_profile_attempts_insert_own
  on public.portfolio_discipline_profile_attempts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy portfolio_money_management_plans_select_own
  on public.portfolio_money_management_plans
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_money_management_plans_insert_own
  on public.portfolio_money_management_plans
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Version allocation is serialized per portfolio inside the same transaction as the insert.
-- The function is SECURITY INVOKER so normal RLS/ownership rules remain authoritative.
create or replace function public.qeo_create_portfolio_money_management_plan(
  p_portfolio_id uuid,
  p_payload jsonb
)
returns public.portfolio_money_management_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_version integer;
  v_row public.portfolio_money_management_plans;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_portfolio_id::text, 138)
  );

  select coalesce(max(version), 0) + 1
    into v_version
    from public.portfolio_money_management_plans
   where portfolio_id = p_portfolio_id
     and user_id = v_user_id;

  insert into public.portfolio_money_management_plans (
    portfolio_id,
    user_id,
    version,
    risk_profile_attempt_id,
    discipline_profile_attempt_id,
    schema_version,
    default_trade_risk_percent,
    advanced_risk_override_acknowledged,
    max_active_risk_percent,
    drawdown_reduce_enabled,
    drawdown_reduce_threshold_percent,
    risk_reduction_factor,
    drawdown_pause_enabled,
    drawdown_pause_threshold_percent,
    consecutive_stop_outs_enabled,
    consecutive_stop_outs_threshold,
    rolling_trade_loss_enabled,
    rolling_trade_count,
    holiday_rules,
    execution_rules,
    scale_rules,
    diversification_rules,
    risk_capital_policy,
    notes
  ) values (
    p_portfolio_id,
    v_user_id,
    v_version,
    nullif(p_payload ->> 'risk_profile_attempt_id', '')::uuid,
    nullif(p_payload ->> 'discipline_profile_attempt_id', '')::uuid,
    coalesce(nullif(p_payload ->> 'schema_version', '')::integer, 1),
    (p_payload ->> 'default_trade_risk_percent')::numeric,
    coalesce((p_payload ->> 'advanced_risk_override_acknowledged')::boolean, false),
    (p_payload ->> 'max_active_risk_percent')::numeric,
    coalesce((p_payload ->> 'drawdown_reduce_enabled')::boolean, false),
    nullif(p_payload ->> 'drawdown_reduce_threshold_percent', '')::numeric,
    nullif(p_payload ->> 'risk_reduction_factor', '')::numeric,
    coalesce((p_payload ->> 'drawdown_pause_enabled')::boolean, false),
    nullif(p_payload ->> 'drawdown_pause_threshold_percent', '')::numeric,
    coalesce((p_payload ->> 'consecutive_stop_outs_enabled')::boolean, false),
    nullif(p_payload ->> 'consecutive_stop_outs_threshold', '')::integer,
    coalesce((p_payload ->> 'rolling_trade_loss_enabled')::boolean, false),
    nullif(p_payload ->> 'rolling_trade_count', '')::integer,
    coalesce(p_payload -> 'holiday_rules', '{}'::jsonb),
    coalesce(p_payload -> 'execution_rules', '{}'::jsonb),
    coalesce(p_payload -> 'scale_rules', '{}'::jsonb),
    coalesce(p_payload -> 'diversification_rules', '{}'::jsonb),
    coalesce(p_payload -> 'risk_capital_policy', '{"mode":"disabled"}'::jsonb),
    nullif(pg_catalog.btrim(p_payload ->> 'notes'), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.qeo_create_portfolio_money_management_plan(uuid, jsonb) from public, anon;
grant execute on function public.qeo_create_portfolio_money_management_plan(uuid, jsonb) to authenticated;

commit;
