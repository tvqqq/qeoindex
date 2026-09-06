\set ON_ERROR_STOP on

begin;

-- QEO-124 persistence is service-role only and must exist before candidates can be accepted.
do $$
begin
  if to_regprocedure('public.qeo_persist_adjustment_factor_candidate(text,text,text,text,date,text,text,jsonb)') is null then
    raise exception 'missing qeo_persist_adjustment_factor_candidate(text,text,text,text,date,text,text,jsonb)';
  end if;

  if has_function_privilege('anon', 'public.qeo_persist_adjustment_factor_candidate(text,text,text,text,date,text,text,jsonb)', 'execute') then
    raise exception 'anon must not execute adjustment-factor persistence';
  end if;
  if has_function_privilege('authenticated', 'public.qeo_persist_adjustment_factor_candidate(text,text,text,text,date,text,text,jsonb)', 'execute') then
    raise exception 'authenticated must not execute adjustment-factor persistence';
  end if;
  if not has_function_privilege('service_role', 'public.qeo_persist_adjustment_factor_candidate(text,text,text,text,date,text,text,jsonb)', 'execute') then
    raise exception 'service_role must execute adjustment-factor persistence';
  end if;
end
$$;

-- One same-date event set persists as exactly one transition.
do $$
declare
  v_run_id uuid;
  v_replay_id uuid;
  v_version text := 'qeo124-v1:' || repeat('a', 64);
  v_lineage text := repeat('a', 64);
  v_transition_lineage text := repeat('b', 64);
  v_action_id uuid := '00000000-0000-4000-8000-000000000301';
begin
  v_run_id := public.qeo_persist_adjustment_factor_candidate(
    'AAA', v_version, 'qeo124-v1', v_lineage, '2026-01-10', 'candidate', null,
    jsonb_build_array(jsonb_build_object(
      'effective_session', '2026-01-10',
      'reference_session', '2026-01-09',
      'reference_raw_close', 100,
      'step_price_factor', 0.9,
      'step_volume_factor', 1,
      'cumulative_price_factor', 0.9,
      'cumulative_volume_factor', 1,
      'corporate_action_ids', jsonb_build_array(v_action_id::text),
      'event_lineage_hash', v_transition_lineage,
      'formula_inputs', jsonb_build_object('cashDividend', 10)
    ))
  );

  if v_run_id is null then
    raise exception 'candidate persistence returned null run id';
  end if;

  if (select count(*) from public.market_adjustment_factor_runs where id = v_run_id and ticker = 'AAA' and status = 'candidate') <> 1 then
    raise exception 'candidate run was not persisted exactly once';
  end if;
  if (select count(*) from public.market_price_adjustment_factors where run_id = v_run_id) <> 1 then
    raise exception 'same-date event set did not persist exactly one transition';
  end if;

  v_replay_id := public.qeo_persist_adjustment_factor_candidate(
    'AAA', v_version, 'qeo124-v1', v_lineage, '2026-01-12', 'candidate', null,
    jsonb_build_array(jsonb_build_object(
      'effective_session', '2026-01-10',
      'reference_session', '2026-01-09',
      'reference_raw_close', 100,
      'step_price_factor', 0.9,
      'step_volume_factor', 1,
      'cumulative_price_factor', 0.9,
      'cumulative_volume_factor', 1,
      'corporate_action_ids', jsonb_build_array(v_action_id::text),
      'event_lineage_hash', v_transition_lineage,
      'formula_inputs', jsonb_build_object('cashDividend', 10)
    ))
  );

  if v_replay_id <> v_run_id then
    raise exception 'unchanged replay created a second run id';
  end if;
  if (select count(*) from public.market_adjustment_factor_runs where ticker = 'AAA' and factor_version = v_version) <> 1 then
    raise exception 'unchanged replay duplicated candidate run';
  end if;
  if (select count(*) from public.market_price_adjustment_factors where run_id = v_run_id) <> 1 then
    raise exception 'unchanged replay duplicated transition';
  end if;
  if (select as_of_date from public.market_adjustment_factor_runs where id = v_run_id) <> date '2026-01-12' then
    raise exception 'candidate replay did not refresh audit as_of_date';
  end if;
end
$$;

-- Blocked runs are auditable but may never carry factor transitions.
do $$
declare
  v_run_id uuid;
begin
  v_run_id := public.qeo_persist_adjustment_factor_candidate(
    'BBB', 'qeo124-v1:' || repeat('c', 64), 'qeo124-v1', repeat('c', 64),
    '2026-01-10', 'blocked', 'MISSING_REFERENCE_RAW_CLOSE', '[]'::jsonb
  );
  if not exists (
    select 1 from public.market_adjustment_factor_runs
    where id = v_run_id and status = 'blocked' and blocked_reason = 'MISSING_REFERENCE_RAW_CLOSE'
  ) then
    raise exception 'blocked run was not persisted with reason';
  end if;
  if exists (select 1 from public.market_price_adjustment_factors where run_id = v_run_id) then
    raise exception 'blocked run must not carry transitions';
  end if;
end
$$;

-- Candidate persistence must never mutate an already-active run.
do $$
declare
  v_active_id uuid;
  v_failed boolean := false;
begin
  insert into public.market_adjustment_factor_runs (
    ticker, factor_version, engine_version, event_lineage_hash, as_of_date, status
  ) values (
    'CCC', 'qeo124-v1:' || repeat('d', 64), 'qeo124-v1', repeat('d', 64), '2026-01-10', 'active'
  ) returning id into v_active_id;

  begin
    perform public.qeo_persist_adjustment_factor_candidate(
      'CCC', 'qeo124-v1:' || repeat('d', 64), 'qeo124-v1', repeat('d', 64),
      '2026-01-12', 'candidate', null, '[]'::jsonb
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'candidate persistence unexpectedly mutated an active run';
  end if;
  if not exists (
    select 1 from public.market_adjustment_factor_runs
    where id = v_active_id and status = 'active' and as_of_date = date '2026-01-10'
  ) then
    raise exception 'active run changed during rejected candidate persistence';
  end if;
end
$$;

rollback;
