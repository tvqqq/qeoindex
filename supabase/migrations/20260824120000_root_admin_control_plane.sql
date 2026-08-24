begin;

-- ============================================================================
-- 1. Private Control Plane Tables
-- ============================================================================

create table if not exists public.system_settings (
  key text primary key check (key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  value jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  change_reason text not null check (char_length(change_reason) between 8 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (job_key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  provider text not null,
  trigger text not null check (trigger in ('schedule','manual','workflow','external')),
  status text not null check (status in ('queued','running','succeeded','failed','skipped')),
  actor_user_id uuid references auth.users(id) on delete set null,
  provider_run_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.system_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_key text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null check (char_length(reason) between 8 and 240),
  request_id uuid not null,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists system_job_runs_job_started_idx on public.system_job_runs(job_key, started_at desc);
create index if not exists system_job_runs_started_idx on public.system_job_runs(started_at desc);
create index if not exists system_audit_log_created_idx on public.system_audit_log(created_at desc);

-- Trigger for system_settings updated_at
drop trigger if exists system_settings_touch_updated_at on public.system_settings;
create trigger system_settings_touch_updated_at
  before update on public.system_settings
  for each row
  execute function public.qeo_touch_updated_at();

-- Security: RLS enabled, revoke anon & authenticated, grant service_role only
alter table public.system_settings enable row level security;
alter table public.system_job_runs enable row level security;
alter table public.system_audit_log enable row level security;

revoke all privileges on table public.system_settings from anon, authenticated;
revoke all privileges on table public.system_job_runs from anon, authenticated;
revoke all privileges on table public.system_audit_log from anon, authenticated;

grant all privileges on table public.system_settings to service_role;
grant all privileges on table public.system_job_runs to service_role;
grant all privileges on table public.system_audit_log to service_role;
grant usage, select on sequence public.system_audit_log_id_seq to service_role;


-- ============================================================================
-- 2. Atomic Compare-And-Swap Setting RPCs
-- ============================================================================

create or replace function public.qeo_admin_set_system_setting(
  p_key text,
  p_value jsonb,
  p_expected_version bigint,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before record;
  v_after record;
begin
  if p_expected_version = 0 then
    -- Attempt insert
    begin
      insert into public.system_settings (key, value, version, updated_by, change_reason, created_at, updated_at)
      values (p_key, p_value, 1, p_actor_user_id, p_reason, now(), now())
      returning * into v_after;

      insert into public.system_audit_log (
        actor_user_id, action, target_type, target_key, before_value, after_value, reason, request_id, success
      ) values (
        p_actor_user_id, 'setting.create', 'setting', p_key, null, p_value, p_reason, p_request_id, true
      );

      return jsonb_build_object(
        'ok', true,
        'record', jsonb_build_object(
          'key', v_after.key,
          'value', v_after.value,
          'version', v_after.version,
          'updated_at', v_after.updated_at,
          'updated_by', v_after.updated_by,
          'change_reason', v_after.change_reason
        )
      );
    exception when unique_violation then
      select * into v_before from public.system_settings where key = p_key;
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'record', jsonb_build_object(
          'key', v_before.key,
          'value', v_before.value,
          'version', v_before.version,
          'updated_at', v_before.updated_at,
          'updated_by', v_before.updated_by,
          'change_reason', v_before.change_reason
        )
      );
    end;
  else
    -- Update existing
    select * into v_before from public.system_settings where key = p_key for update;

    if not found then
      return jsonb_build_object('ok', false, 'conflict', true, 'record', null);
    end if;

    if v_before.version <> p_expected_version then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'record', jsonb_build_object(
          'key', v_before.key,
          'value', v_before.value,
          'version', v_before.version,
          'updated_at', v_before.updated_at,
          'updated_by', v_before.updated_by,
          'change_reason', v_before.change_reason
        )
      );
    end if;

    update public.system_settings
    set value = p_value,
        version = version + 1,
        updated_by = p_actor_user_id,
        change_reason = p_reason,
        updated_at = now()
    where key = p_key and version = p_expected_version
    returning * into v_after;

    insert into public.system_audit_log (
      actor_user_id, action, target_type, target_key, before_value, after_value, reason, request_id, success
    ) values (
      p_actor_user_id, 'setting.update', 'setting', p_key, v_before.value, p_value, p_reason, p_request_id, true
    );

    return jsonb_build_object(
      'ok', true,
      'record', jsonb_build_object(
        'key', v_after.key,
        'value', v_after.value,
        'version', v_after.version,
        'updated_at', v_after.updated_at,
        'updated_by', v_after.updated_by,
        'change_reason', v_after.change_reason
      )
    );
  end if;
end;
$$;

create or replace function public.qeo_admin_reset_system_setting(
  p_key text,
  p_expected_version bigint,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before record;
begin
  select * into v_before from public.system_settings where key = p_key for update;

  if not found then
    if p_expected_version = 0 then
      return jsonb_build_object('ok', true, 'record', null);
    else
      return jsonb_build_object('ok', false, 'conflict', true, 'record', null);
    end if;
  end if;

  if v_before.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'record', jsonb_build_object(
        'key', v_before.key,
        'value', v_before.value,
        'version', v_before.version,
        'updated_at', v_before.updated_at,
        'updated_by', v_before.updated_by,
        'change_reason', v_before.change_reason
      )
    );
  end if;

  delete from public.system_settings where key = p_key and version = p_expected_version;

  insert into public.system_audit_log (
    actor_user_id, action, target_type, target_key, before_value, after_value, reason, request_id, success
  ) values (
    p_actor_user_id, 'setting.reset', 'setting', p_key, v_before.value, null, p_reason, p_request_id, true
  );

  return jsonb_build_object('ok', true, 'record', null);
end;
$$;

revoke all on function public.qeo_admin_set_system_setting(text, jsonb, bigint, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.qeo_admin_set_system_setting(text, jsonb, bigint, uuid, text, uuid) to service_role;

revoke all on function public.qeo_admin_reset_system_setting(text, bigint, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.qeo_admin_reset_system_setting(text, bigint, uuid, text, uuid) to service_role;


-- ============================================================================
-- 3. Sanitized Supabase Cron Snapshot RPC
-- ============================================================================

create or replace function public.qeo_admin_cron_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'jobId', job.jobid,
      'jobName', job.jobname,
      'schedule', job.schedule,
      'active', job.active,
      'lastStatus', latest.status,
      'lastStartedAt', latest.start_time,
      'lastFinishedAt', latest.end_time
    ) order by job.jobname
  ), '[]'::jsonb)
  into v_result
  from cron.job job
  left join lateral (
    select run.status, run.start_time, run.end_time
    from cron.job_run_details run
    where run.jobid = job.jobid
    order by run.start_time desc
    limit 1
  ) latest on true;

  return v_result;
exception when others then
  return '[]'::jsonb;
end;
$$;

revoke all on function public.qeo_admin_cron_snapshot() from public, anon, authenticated;
grant execute on function public.qeo_admin_cron_snapshot() to service_role;

commit;
