begin;

alter table public.kfsp_manual_dispatch_runs
  add column if not exists system_job_run_id uuid references public.system_job_runs(id) on delete set null,
  add column if not exists sync_run_id uuid,
  add column if not exists status text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists final_summary jsonb,
  add column if not exists error_code text,
  add column if not exists error_message text;

update public.kfsp_manual_dispatch_runs
set status = 'succeeded',
    completed_at = coalesce(completed_at, dispatched_at),
    final_summary = coalesce(final_summary, jsonb_build_object('legacy_dispatch', true, 'net_request_id', net_request_id))
where status is null
  and net_request_id is not null;

alter table public.kfsp_manual_dispatch_runs
  drop constraint if exists kfsp_manual_dispatch_runs_status_check,
  add constraint kfsp_manual_dispatch_runs_status_check
    check (status is null or status in ('queued', 'running', 'succeeded', 'failed')),
  drop constraint if exists kfsp_manual_dispatch_runs_final_summary_check,
  add constraint kfsp_manual_dispatch_runs_final_summary_check
    check (final_summary is null or jsonb_typeof(final_summary) = 'object');

create unique index if not exists kfsp_manual_dispatch_runs_system_job_run_uidx
  on public.kfsp_manual_dispatch_runs(system_job_run_id)
  where system_job_run_id is not null;

create unique index if not exists kfsp_manual_dispatch_runs_sync_run_uidx
  on public.kfsp_manual_dispatch_runs(sync_run_id)
  where sync_run_id is not null;

revoke all on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text) from public, anon, authenticated;
drop function if exists public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text);

create or replace function public.qeo_dispatch_kfsp_job(
  p_job_key text,
  p_request_id uuid,
  p_reason text,
  p_tickers text[] default null,
  p_force boolean default false,
  p_requested_by text default null,
  p_actor_user_id uuid default null,
  p_max_duration_minutes integer default 15
)
returns table (
  request_id uuid,
  job_key text,
  net_request_id bigint,
  system_job_run_id uuid,
  sync_run_id uuid,
  status text,
  dispatched_at timestamptz,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.kfsp_manual_dispatch_runs%rowtype;
  v_secret text;
  v_url text;
  v_body jsonb;
  v_tickers text[];
  v_net_request_id bigint;
  v_requested_by text;
  v_active_run_id uuid;
begin
  if p_job_key not in ('kfsp.rating_daily', 'kfsp.ttai_history') then
    raise exception 'Unsupported KFSP job key: %', p_job_key;
  end if;
  if p_request_id is null then
    raise exception 'p_request_id is required for idempotent dispatch';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'p_reason is required';
  end if;
  if p_max_duration_minutes is null or p_max_duration_minutes < 1 or p_max_duration_minutes > 240 then
    raise exception 'p_max_duration_minutes must be between 1 and 240';
  end if;

  -- Serialize all manual dispatch decisions for the same KFSP job so active-run
  -- conflict detection and request-id idempotency stay race-safe.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('qeo_dispatch_kfsp_job:' || p_job_key));

  v_requested_by := coalesce(nullif(btrim(p_requested_by), ''), auth.uid()::text, session_user, current_user);

  if p_job_key = 'kfsp.ttai_history' then
    select coalesce(array_agg(t order by ord), '{}'::text[])
    into v_tickers
    from (
      select upper(btrim(raw_ticker)) as t, min(ord) as ord
      from unnest(coalesce(p_tickers, '{}'::text[])) with ordinality as x(raw_ticker, ord)
      where upper(btrim(raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
      group by upper(btrim(raw_ticker))
    ) normalized;

    if cardinality(v_tickers) = 0 or cardinality(v_tickers) > 50 then
      raise exception 'TTAI manual dispatch requires 1..50 unique valid tickers';
    end if;

    v_url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-ttai-history-sync';
    v_body := jsonb_build_object(
      'source', 'manual_recovery_rpc',
      'request_id', p_request_id,
      'reason', btrim(p_reason),
      'tickers', to_jsonb(v_tickers),
      'force', p_force
    );
  else
    if cardinality(coalesce(p_tickers, '{}'::text[])) > 0 then
      raise exception 'Rating manual dispatch does not accept p_tickers';
    end if;

    v_url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-rating-sync';
    v_body := jsonb_build_object(
      'source', 'manual_recovery_rpc',
      'request_id', p_request_id,
      'reason', btrim(p_reason)
    );
  end if;

  select r.*
  into v_existing
  from public.kfsp_manual_dispatch_runs r
  where r.request_id = p_request_id;

  if found then
    if v_existing.job_key <> p_job_key
       or v_existing.reason <> btrim(p_reason)
       or v_existing.request_body <> v_body then
      raise exception 'KFSP_REQUEST_ID_CONFLICT';
    end if;

    return query
    select
      v_existing.request_id,
      v_existing.job_key,
      v_existing.net_request_id,
      v_existing.system_job_run_id,
      v_existing.sync_run_id,
      v_existing.status,
      v_existing.dispatched_at,
      true;
    return;
  end if;

  select r.id
  into v_active_run_id
  from public.system_job_runs r
  where r.job_key = p_job_key
    and r.trigger = 'manual'
    and r.status in ('queued', 'running')
    and r.id <> p_request_id
    and r.started_at > now() - pg_catalog.make_interval(mins => p_max_duration_minutes)
  order by r.started_at desc
  limit 1;

  if v_active_run_id is not null then
    raise exception 'KFSP_ACTIVE_RUN_CONFLICT:%', v_active_run_id;
  end if;

  insert into public.system_job_runs (
    id, job_key, provider, trigger, status, actor_user_id, started_at, summary
  ) values (
    p_request_id,
    p_job_key,
    'supabase_pg_net',
    'manual',
    'queued',
    p_actor_user_id,
    now(),
    jsonb_build_object('state', 'queued', 'request_id', p_request_id)
  );

  insert into public.kfsp_manual_dispatch_runs (
    request_id, job_key, reason, requested_by, request_body,
    system_job_run_id, status
  ) values (
    p_request_id, p_job_key, btrim(p_reason), v_requested_by, v_body,
    p_request_id, 'queued'
  );

  select s.decrypted_secret
  into v_secret
  from vault.decrypted_secrets s
  where s.name = 'kfsp_sync_secret'
  limit 1;

  if nullif(btrim(v_secret), '') is null then
    raise exception 'kfsp_sync_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-KFSP-Sync-Secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 55000
  ) into v_net_request_id;

  update public.kfsp_manual_dispatch_runs r
  set net_request_id = v_net_request_id
  where r.request_id = p_request_id;

  return query
  select p_request_id, p_job_key, v_net_request_id, p_request_id, null::uuid, 'queued'::text, r.dispatched_at, false
  from public.kfsp_manual_dispatch_runs r
  where r.request_id = p_request_id;
end;
$$;

create or replace function public.qeo_begin_kfsp_manual_lifecycle(
  p_request_id uuid,
  p_job_key text,
  p_sync_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.kfsp_manual_dispatch_runs%rowtype;
begin
  if p_request_id is null or p_sync_run_id is null or p_request_id <> p_sync_run_id then
    raise exception 'KFSP_MANUAL_CORRELATION_INVALID';
  end if;

  select r.* into v_dispatch
  from public.kfsp_manual_dispatch_runs r
  where r.request_id = p_request_id
  for update;

  if not found or v_dispatch.job_key <> p_job_key or v_dispatch.system_job_run_id <> p_request_id then
    raise exception 'KFSP_MANUAL_DISPATCH_NOT_FOUND';
  end if;

  if v_dispatch.status in ('succeeded', 'failed') then
    return jsonb_build_object('duplicate', true, 'status', v_dispatch.status, 'request_id', p_request_id, 'sync_run_id', v_dispatch.sync_run_id);
  end if;

  if v_dispatch.sync_run_id is not null and v_dispatch.sync_run_id <> p_sync_run_id then
    raise exception 'KFSP_MANUAL_SYNC_RUN_CONFLICT';
  end if;

  update public.kfsp_manual_dispatch_runs r
  set sync_run_id = p_sync_run_id,
      status = 'running',
      started_at = coalesce(r.started_at, now()),
      error_code = null,
      error_message = null
  where r.request_id = p_request_id;

  update public.system_job_runs r
  set status = 'running',
      provider_run_id = p_sync_run_id::text,
      summary = jsonb_build_object('state', 'running', 'request_id', p_request_id, 'sync_run_id', p_sync_run_id)
  where r.id = p_request_id
    and r.job_key = p_job_key
    and r.status in ('queued', 'running');

  if not found then
    raise exception 'KFSP_SYSTEM_JOB_CORRELATION_MISSING';
  end if;

  return jsonb_build_object('duplicate', false, 'status', 'running', 'request_id', p_request_id, 'sync_run_id', p_sync_run_id);
end;
$$;

create or replace function public.qeo_finalize_kfsp_manual_lifecycle(
  p_request_id uuid,
  p_job_key text,
  p_success boolean,
  p_summary jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.kfsp_manual_dispatch_runs%rowtype;
  v_status text;
  v_finished_at timestamptz := now();
  v_summary jsonb;
begin
  if p_request_id is null or p_success is null then
    raise exception 'KFSP_MANUAL_FINALIZE_INVALID';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'KFSP_MANUAL_SUMMARY_INVALID';
  end if;

  select r.* into v_dispatch
  from public.kfsp_manual_dispatch_runs r
  where r.request_id = p_request_id
  for update;

  if not found or v_dispatch.job_key <> p_job_key or v_dispatch.system_job_run_id <> p_request_id then
    raise exception 'KFSP_MANUAL_DISPATCH_NOT_FOUND';
  end if;
  if v_dispatch.sync_run_id is null or v_dispatch.sync_run_id <> p_request_id then
    raise exception 'KFSP_MANUAL_SYNC_RUN_MISSING';
  end if;

  v_status := case when p_success then 'succeeded' else 'failed' end;
  v_summary := p_summary || jsonb_build_object(
    'state', v_status,
    'request_id', p_request_id,
    'sync_run_id', v_dispatch.sync_run_id
  );

  update public.kfsp_manual_dispatch_runs r
  set status = v_status,
      completed_at = v_finished_at,
      final_summary = v_summary,
      error_code = case when p_success then null else left(coalesce(p_error_code, 'KFSP_PROVIDER_FAILED'), 100) end,
      error_message = case when p_success then null else left(coalesce(p_error_message, 'KFSP provider execution failed.'), 500) end
  where r.request_id = p_request_id;

  update public.system_job_runs r
  set status = v_status,
      provider_run_id = v_dispatch.sync_run_id::text,
      finished_at = v_finished_at,
      duration_ms = greatest(0, floor(extract(epoch from (v_finished_at - r.started_at)) * 1000)::bigint),
      summary = v_summary,
      error_code = case when p_success then null else left(coalesce(p_error_code, 'KFSP_PROVIDER_FAILED'), 100) end,
      error_message = case when p_success then null else left(coalesce(p_error_message, 'KFSP provider execution failed.'), 1000) end
  where r.id = p_request_id
    and r.job_key = p_job_key;

  if not found then
    raise exception 'KFSP_SYSTEM_JOB_CORRELATION_MISSING';
  end if;

  return jsonb_build_object('status', v_status, 'request_id', p_request_id, 'sync_run_id', v_dispatch.sync_run_id);
end;
$$;

revoke all on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.qeo_begin_kfsp_manual_lifecycle(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.qeo_finalize_kfsp_manual_lifecycle(uuid, text, boolean, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text, uuid, integer) to service_role;
grant execute on function public.qeo_begin_kfsp_manual_lifecycle(uuid, text, uuid) to service_role;
grant execute on function public.qeo_finalize_kfsp_manual_lifecycle(uuid, text, boolean, jsonb, text, text) to service_role;

comment on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text, uuid, integer) is
  'Race-safe one-shot KFSP manual dispatcher. Creates queued system telemetry, enforces idempotency/active-run conflict, and keeps Vault credentials server-side.';
comment on function public.qeo_begin_kfsp_manual_lifecycle(uuid, text, uuid) is
  'Atomically binds a manual KFSP request to its deterministic provider sync run and transitions dispatch/system telemetry to running.';
comment on function public.qeo_finalize_kfsp_manual_lifecycle(uuid, text, boolean, jsonb, text, text) is
  'Atomically finalizes correlated KFSP dispatch/system telemetry from the actual provider outcome.';

commit;
