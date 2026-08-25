begin;

create or replace function public.qeo_verify_eod_scheduler_secret(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cron_secret text;
begin
  if nullif(btrim(coalesce(p_secret, '')), '') is null then
    return false;
  end if;

  select s.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_cron_secret'
  limit 1;

  if nullif(btrim(coalesce(v_cron_secret, '')), '') is null then
    return false;
  end if;

  return v_cron_secret = p_secret;
end;
$$;

revoke all on function public.qeo_verify_eod_scheduler_secret(text) from public, anon, authenticated;
grant execute on function public.qeo_verify_eod_scheduler_secret(text) to service_role;

comment on function public.qeo_verify_eod_scheduler_secret(text) is
  'Service-role-only verification boundary for the Supabase Vault scheduler credential. Returns only a boolean and never exposes the decrypted secret.';

create or replace function public.qeo_trigger_eod_pipeline()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select s.decrypted_secret
  into v_app_url
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_app_url'
  limit 1;

  if nullif(btrim(v_app_url), '') is null then
    raise exception 'qeoindex_app_url is not configured in Supabase Vault';
  end if;

  select s.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_cron_secret'
  limit 1;

  if nullif(btrim(v_cron_secret), '') is null then
    raise exception 'qeoindex_cron_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := rtrim(v_app_url, '/') || '/api/qeoindex/eod',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_pg_cron',
      'job', 'qeoindex.eod_pipeline'
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_eod_pipeline() from public, anon, authenticated;
grant execute on function public.qeo_trigger_eod_pipeline() to service_role;

comment on function public.qeo_trigger_eod_pipeline() is
  'Triggers the unified QeoIndex EOD durable workflow. Reads qeoindex_app_url and qeoindex_cron_secret from Supabase Vault at execution time; no scheduler credential is stored in migration text.';

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'qeoindex-eod-pipeline-1515-ict'
  ) then
    perform cron.unschedule('qeoindex-eod-pipeline-1515-ict');
  end if;
end $$;

select cron.schedule(
  'qeoindex-eod-pipeline-1515-ict',
  '15 8 * * 1-5',
  $cron$
  select public.qeo_trigger_eod_pipeline();
  $cron$
);

commit;
