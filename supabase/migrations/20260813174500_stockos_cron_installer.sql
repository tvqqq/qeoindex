create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists stockos_internal;
revoke all on schema stockos_internal from public, anon, authenticated;

create function stockos_internal.require_vault_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select secret.decrypted_secret into v_secret
  from vault.decrypted_secrets secret
  where secret.name = p_name;

  if coalesce(v_secret, '') = '' then
    raise exception 'Required Vault secret % is missing', p_name;
  end if;
  return v_secret;
end;
$$;

create function stockos_internal.invoke_edge_function(p_function_name text, p_secret_name text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := stockos_internal.require_vault_secret('project_url') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || stockos_internal.require_vault_secret(p_secret_name)
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 10000
  );
$$;

create function public.install_stockos_cron()
returns table(job_name text, schedule text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform stockos_internal.require_vault_secret('project_url');
  perform stockos_internal.require_vault_secret('signal_monitor_secret');
  perform stockos_internal.require_vault_secret('outbox_dispatch_secret');

  perform cron.schedule(
    'stockos-signal-monitor', '* * * * 1-5',
    'select stockos_internal.invoke_edge_function(''signal-monitor'', ''signal_monitor_secret'');'
  );
  perform cron.schedule(
    'stockos-telegram-dispatch', '* * * * *',
    'select stockos_internal.invoke_edge_function(''telegram-dispatch'', ''outbox_dispatch_secret'');'
  );
  perform cron.schedule(
    'stockos-notion-sync', '* * * * *',
    'select stockos_internal.invoke_edge_function(''notion-sync'', ''outbox_dispatch_secret'');'
  );

  return query
  select job.jobname::text, job.schedule::text
  from cron.job job
  where job.jobname in ('stockos-signal-monitor', 'stockos-telegram-dispatch', 'stockos-notion-sync')
  order by job.jobname;
end;
$$;

create function public.uninstall_stockos_cron()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_removed integer := 0;
begin
  for v_job in
    select job.jobid from cron.job job
    where job.jobname in ('stockos-signal-monitor', 'stockos-telegram-dispatch', 'stockos-notion-sync')
  loop
    perform cron.unschedule(v_job.jobid);
    v_removed := v_removed + 1;
  end loop;
  return v_removed;
end;
$$;

revoke all on function stockos_internal.require_vault_secret(text) from public, anon, authenticated;
revoke all on function stockos_internal.invoke_edge_function(text, text) from public, anon, authenticated;
revoke all on function public.install_stockos_cron() from public, anon, authenticated;
revoke all on function public.uninstall_stockos_cron() from public, anon, authenticated;
grant execute on function public.install_stockos_cron() to service_role;
grant execute on function public.uninstall_stockos_cron() to service_role;

