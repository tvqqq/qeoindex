begin;

-- QEO-105 rollout hardening.
-- The first observed published universe is a baseline, not a 200-ticker
-- universe-change event. QEO-107 already owns initial canonical bootstrap.
create or replace function public.qeo_prepare_chart_universe_bootstrap_transition(
  p_new_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.market_universe_runs%rowtype;
  v_previous_run_id uuid;
  v_transition_id uuid;
  v_existing_previous_run_id uuid;
  v_added text[] := '{}'::text[];
  v_removed text[] := '{}'::text[];
  v_unchanged_count integer := 0;
begin
  select * into v_new
  from public.market_universe_runs
  where id = p_new_run_id
    and status = 'published'
    and published_at is not null;

  if not found then
    raise exception 'QEO-105 new universe run % is not published', p_new_run_id;
  end if;

  select r.id into v_previous_run_id
  from public.market_universe_runs r
  where r.universe_key = v_new.universe_key
    and r.status = 'published'
    and r.published_at is not null
    and r.id <> v_new.id
    and r.published_at < v_new.published_at
  order by r.published_at desc, r.created_at desc
  limit 1;

  if v_previous_run_id is null then
    v_added := '{}'::text[];
    v_removed := '{}'::text[];
    select count(*)::integer
    into v_unchanged_count
    from public.market_universe_memberships
    where run_id = v_new.id;
  else
    select coalesce(array_agg(n.ticker order by n.ticker), '{}'::text[])
    into v_added
    from public.market_universe_memberships n
    left join public.market_universe_memberships p
      on p.run_id = v_previous_run_id
     and p.ticker = n.ticker
    where n.run_id = v_new.id
      and p.ticker is null;

    select coalesce(array_agg(p.ticker order by p.ticker), '{}'::text[])
    into v_removed
    from public.market_universe_memberships p
    left join public.market_universe_memberships n
      on n.run_id = v_new.id
     and n.ticker = p.ticker
    where p.run_id = v_previous_run_id
      and n.ticker is null;

    select count(*)::integer
    into v_unchanged_count
    from public.market_universe_memberships n
    join public.market_universe_memberships p
      on p.run_id = v_previous_run_id
     and p.ticker = n.ticker
    where n.run_id = v_new.id;
  end if;

  insert into public.chart_universe_bootstrap_transitions (
    universe_key,
    previous_run_id,
    new_run_id,
    status,
    added_tickers,
    removed_tickers,
    unchanged_count,
    completed_at
  ) values (
    v_new.universe_key,
    v_previous_run_id,
    v_new.id,
    case when cardinality(v_added) = 0 then 'complete' else 'pending' end,
    v_added,
    v_removed,
    v_unchanged_count,
    case when cardinality(v_added) = 0 then now() else null end
  )
  on conflict (new_run_id) do nothing
  returning id into v_transition_id;

  if v_transition_id is null then
    select id, previous_run_id
    into v_transition_id, v_existing_previous_run_id
    from public.chart_universe_bootstrap_transitions
    where new_run_id = v_new.id;

    if v_existing_previous_run_id is distinct from v_previous_run_id then
      raise exception 'QEO-105 frozen previous run mismatch for new run %', v_new.id;
    end if;
  end if;

  insert into public.chart_universe_bootstrap_tickers (transition_id, ticker)
  select v_transition_id, ticker
  from unnest(v_added) ticker
  on conflict (transition_id, ticker) do nothing;

  return jsonb_build_object(
    'transitionId', v_transition_id,
    'universeKey', v_new.universe_key,
    'previousRunId', v_previous_run_id,
    'newRunId', v_new.id,
    'addedTickers', v_added,
    'removedTickers', v_removed,
    'addedCount', cardinality(v_added),
    'removedCount', cardinality(v_removed),
    'unchangedCount', v_unchanged_count,
    'baseline', v_previous_run_id is null
  );
end;
$$;

-- Dispatch directly to the isolated machine route. Do not couple universe
-- bootstrap to the broader EOD/QEO-150 scheduler endpoint.
create or replace function public.qeo_dispatch_chart_universe_bootstrap_transition(
  p_transition_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transition public.chart_universe_bootstrap_transitions%rowtype;
  v_app_url text;
  v_secret text;
  v_request_id bigint;
begin
  select * into v_transition
  from public.chart_universe_bootstrap_transitions
  where id = p_transition_id;

  if not found then
    raise exception 'QEO-105 transition % not found', p_transition_id;
  end if;
  if v_transition.status = 'complete' then
    return null;
  end if;

  select s.decrypted_secret into v_app_url
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_app_url'
  limit 1;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_cron_secret'
  limit 1;

  if coalesce(btrim(v_app_url), '') = '' or coalesce(btrim(v_secret), '') = '' then
    raise exception 'QEO-105 dispatch Vault configuration is incomplete';
  end if;

  select net.http_post(
    url := rtrim(v_app_url, '/') || '/api/qeoindex/chart-universe-bootstrap?transitionId=' || p_transition_id::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_market_universe_publish',
      'job', 'qeoindex.chart_universe_bootstrap',
      'transitionId', p_transition_id
    ),
    timeout_milliseconds := 55000
  ) into v_request_id;

  update public.chart_universe_bootstrap_transitions
  set last_dispatch_request_id = v_request_id,
      last_dispatched_at = now(),
      updated_at = now()
  where id = p_transition_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_prepare_chart_universe_bootstrap_transition(uuid) from public, anon, authenticated;
revoke all on function public.qeo_dispatch_chart_universe_bootstrap_transition(uuid) from public, anon, authenticated;
grant execute on function public.qeo_prepare_chart_universe_bootstrap_transition(uuid) to service_role;
grant execute on function public.qeo_dispatch_chart_universe_bootstrap_transition(uuid) to service_role;

commit;
