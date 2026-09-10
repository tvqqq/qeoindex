begin;

-- QEO-105 freezes each exact published universe transition before provider work.
-- Universe publication stays atomic: the trigger only prepares durable state and
-- enqueues an asynchronous authenticated application request through pg_net.
create table if not exists public.chart_universe_bootstrap_transitions (
  id uuid primary key default gen_random_uuid(),
  universe_key text not null,
  previous_run_id uuid references public.market_universe_runs(id),
  new_run_id uuid not null references public.market_universe_runs(id),
  status text not null default 'pending' check (status in ('pending', 'running', 'retryable', 'partial', 'complete', 'failed')),
  added_tickers text[] not null default '{}'::text[],
  removed_tickers text[] not null default '{}'::text[],
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_dispatch_id text,
  last_dispatch_request_id bigint,
  last_dispatched_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (new_run_id)
);

create table if not exists public.chart_universe_bootstrap_tickers (
  transition_id uuid not null references public.chart_universe_bootstrap_transitions(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'provider_gap', 'retryable', 'failed', 'capacity_stop')),
  daily_status text not null default 'pending' check (daily_status in ('pending', 'running', 'ready', 'retryable', 'failed')),
  intraday_status text not null default 'pending' check (intraday_status in ('pending', 'running', 'ready', 'provider_gap', 'retryable', 'failed', 'capacity_stop')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  daily_rows integer not null default 0 check (daily_rows >= 0),
  daily_last_bar_time timestamptz,
  intraday_hot_sessions integer not null default 0 check (intraday_hot_sessions >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (transition_id, ticker)
);

create index if not exists chart_universe_bootstrap_transitions_status_idx
  on public.chart_universe_bootstrap_transitions(status, updated_at);

alter table public.chart_universe_bootstrap_transitions enable row level security;
alter table public.chart_universe_bootstrap_tickers enable row level security;
revoke all privileges on table public.chart_universe_bootstrap_transitions from anon, authenticated;
revoke all privileges on table public.chart_universe_bootstrap_tickers from anon, authenticated;
grant all privileges on table public.chart_universe_bootstrap_transitions to service_role;
grant all privileges on table public.chart_universe_bootstrap_tickers to service_role;

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

  select coalesce(array_agg(n.ticker order by n.ticker), '{}'::text[])
  into v_added
  from public.market_universe_memberships n
  left join public.market_universe_memberships p
    on p.run_id = v_previous_run_id
   and p.ticker = n.ticker
  where n.run_id = v_new.id
    and p.ticker is null;

  if v_previous_run_id is not null then
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
    'unchangedCount', v_unchanged_count
  );
end;
$$;

create or replace function public.qeo_claim_chart_universe_bootstrap_transition(
  p_transition_id uuid,
  p_dispatch_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transition public.chart_universe_bootstrap_transitions%rowtype;
  v_tickers jsonb;
begin
  if p_dispatch_id is null or p_dispatch_id !~ '^qeo105-[A-Za-z0-9_-]{8,128}$' then
    raise exception 'QEO-105 invalid dispatch id';
  end if;

  select * into v_transition
  from public.chart_universe_bootstrap_transitions
  where id = p_transition_id
  for update;

  if not found then
    raise exception 'QEO-105 transition % not found', p_transition_id;
  end if;

  if v_transition.status = 'complete' then
    return jsonb_build_object('claimed', false, 'reason', 'complete', 'transitionId', v_transition.id);
  end if;

  if v_transition.status = 'running' and v_transition.updated_at >= now() - interval '60 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'active', 'transitionId', v_transition.id);
  end if;

  update public.chart_universe_bootstrap_transitions
  set status = 'running',
      attempt_count = attempt_count + 1,
      last_dispatch_id = p_dispatch_id,
      started_at = coalesce(started_at, now()),
      last_error = null,
      updated_at = now()
  where id = p_transition_id
  returning * into v_transition;

  update public.chart_universe_bootstrap_tickers
  set attempt_count = attempt_count + 1,
      updated_at = now()
  where transition_id = p_transition_id
    and status <> 'ready';

  select coalesce(jsonb_agg(jsonb_build_object(
    'ticker', t.ticker,
    'status', t.status,
    'dailyStatus', t.daily_status,
    'intradayStatus', t.intraday_status,
    'attemptCount', t.attempt_count,
    'dailyRows', t.daily_rows,
    'dailyLastBarTime', t.daily_last_bar_time,
    'intradayHotSessions', t.intraday_hot_sessions,
    'lastError', t.last_error
  ) order by t.ticker), '[]'::jsonb)
  into v_tickers
  from public.chart_universe_bootstrap_tickers t
  where t.transition_id = p_transition_id;

  return jsonb_build_object(
    'claimed', true,
    'transitionId', v_transition.id,
    'universeKey', v_transition.universe_key,
    'previousRunId', v_transition.previous_run_id,
    'newRunId', v_transition.new_run_id,
    'addedTickers', v_transition.added_tickers,
    'removedTickers', v_transition.removed_tickers,
    'unchangedCount', v_transition.unchanged_count,
    'attemptCount', v_transition.attempt_count,
    'tickers', v_tickers
  );
end;
$$;

create or replace function public.qeo_finish_chart_universe_bootstrap_transition(
  p_transition_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_ready integer := 0;
  v_retryable integer := 0;
  v_provider_gap integer := 0;
  v_failed integer := 0;
  v_capacity_stop integer := 0;
  v_status text;
begin
  perform 1
  from public.chart_universe_bootstrap_transitions
  where id = p_transition_id
  for update;

  if not found then
    raise exception 'QEO-105 transition % not found', p_transition_id;
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'ready')::integer,
    count(*) filter (where status = 'retryable')::integer,
    count(*) filter (where status = 'provider_gap')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'capacity_stop')::integer
  into v_total, v_ready, v_retryable, v_provider_gap, v_failed, v_capacity_stop
  from public.chart_universe_bootstrap_tickers
  where transition_id = p_transition_id;

  v_status := case
    when v_total = v_ready then 'complete'
    when v_retryable > 0 or v_capacity_stop > 0 then 'retryable'
    when v_provider_gap > 0 or v_failed > 0 then 'partial'
    else 'partial'
  end;

  update public.chart_universe_bootstrap_transitions
  set status = v_status,
      completed_at = case when v_status = 'complete' then now() else null end,
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      updated_at = now()
  where id = p_transition_id;

  return jsonb_build_object(
    'transitionId', p_transition_id,
    'status', v_status,
    'totalTickers', v_total,
    'readyTickers', v_ready,
    'retryableTickers', v_retryable,
    'providerGapTickers', v_provider_gap,
    'failedTickers', v_failed,
    'capacityStopTickers', v_capacity_stop
  );
end;
$$;

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
    url := rtrim(v_app_url, '/') || '/api/qeoindex/eod?mode=chart-universe-bootstrap&transitionId=' || p_transition_id::text,
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

create or replace function public.qeo_after_market_universe_publish_chart_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_transition_id uuid;
begin
  if new.status = 'published'
     and new.published_at is not null
     and (old.status is distinct from new.status or old.published_at is distinct from new.published_at) then
    begin
      v_payload := public.qeo_prepare_chart_universe_bootstrap_transition(new.id);
      v_transition_id := (v_payload ->> 'transitionId')::uuid;
      if coalesce((v_payload ->> 'addedCount')::integer, 0) > 0 then
        perform public.qeo_dispatch_chart_universe_bootstrap_transition(v_transition_id);
      end if;
    exception when others then
      -- Universe publication is authoritative and must not be rolled back by a
      -- chart-provider or dispatch problem. Retry cron/operator can recover it.
      raise warning 'QEO-105 post-publish handoff failed for run %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists qeo_market_universe_publish_chart_bootstrap on public.market_universe_runs;
create trigger qeo_market_universe_publish_chart_bootstrap
after update of status, published_at on public.market_universe_runs
for each row
execute function public.qeo_after_market_universe_publish_chart_bootstrap();

revoke all on function public.qeo_prepare_chart_universe_bootstrap_transition(uuid) from public, anon, authenticated;
revoke all on function public.qeo_claim_chart_universe_bootstrap_transition(uuid, text) from public, anon, authenticated;
revoke all on function public.qeo_finish_chart_universe_bootstrap_transition(uuid, text) from public, anon, authenticated;
revoke all on function public.qeo_dispatch_chart_universe_bootstrap_transition(uuid) from public, anon, authenticated;
grant execute on function public.qeo_prepare_chart_universe_bootstrap_transition(uuid) to service_role;
grant execute on function public.qeo_claim_chart_universe_bootstrap_transition(uuid, text) to service_role;
grant execute on function public.qeo_finish_chart_universe_bootstrap_transition(uuid, text) to service_role;
grant execute on function public.qeo_dispatch_chart_universe_bootstrap_transition(uuid) to service_role;

-- Retry only transitions that never claimed, explicitly requested retry, or
-- were left running beyond the workflow stale lease. Provider-gap partials stay
-- explicit for operator/manual retry rather than being hammered hourly.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qeoindex-chart-universe-bootstrap-retry') then
    perform cron.unschedule('qeoindex-chart-universe-bootstrap-retry');
  end if;
end $$;

select cron.schedule(
  'qeoindex-chart-universe-bootstrap-retry',
  '17 * * * *',
  $cron$
  select public.qeo_dispatch_chart_universe_bootstrap_transition(t.id)
  from public.chart_universe_bootstrap_transitions t
  where t.attempt_count < 5
    and (
      t.status in ('pending', 'retryable')
      or (t.status = 'running' and t.updated_at < now() - interval '60 minutes')
    )
    and (t.last_dispatched_at is null or t.last_dispatched_at < now() - interval '30 minutes')
  order by t.created_at
  limit 4;
  $cron$
);

commit;
