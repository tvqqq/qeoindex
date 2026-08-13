create or replace function public.install_stockos_cron()
returns table(job_name text, schedule text)
language plpgsql security definer set search_path = ''
as $$
begin
  perform stockos_internal.require_vault_secret('project_url');
  perform stockos_internal.require_vault_secret('signal_monitor_secret');
  perform stockos_internal.require_vault_secret('outbox_dispatch_secret');
  perform stockos_internal.require_vault_secret('scanner_run_secret');

  perform cron.schedule('stockos-signal-monitor', '* * * * 1-5', 'select stockos_internal.invoke_edge_function(''signal-monitor'', ''signal_monitor_secret'');');
  perform cron.schedule('stockos-telegram-dispatch', '* * * * *', 'select stockos_internal.invoke_edge_function(''telegram-dispatch'', ''outbox_dispatch_secret'');');
  perform cron.schedule('stockos-notion-sync', '* * * * *', 'select stockos_internal.invoke_edge_function(''notion-sync'', ''outbox_dispatch_secret'');');
  perform cron.schedule('stockos-daily-scanner-orchestrator', '0 9 * * 1-5', 'select stockos_internal.invoke_edge_function(''daily-scanner-orchestrator'', ''scanner_run_secret'');');
  perform cron.schedule('stockos-daily-scanner-worker', '* 9-11 * * 1-5', 'select stockos_internal.invoke_edge_function(''daily-scanner-worker'', ''scanner_run_secret'');');

  return query select job.jobname::text, job.schedule::text from cron.job job where job.jobname like 'stockos-%' order by job.jobname;
end;
$$;

create or replace function public.uninstall_stockos_cron()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_job record; v_removed integer := 0;
begin
  for v_job in select job.jobid from cron.job job where job.jobname like 'stockos-%'
  loop perform cron.unschedule(v_job.jobid); v_removed := v_removed + 1; end loop;
  return v_removed;
end;
$$;

revoke all on function public.install_stockos_cron() from public, anon, authenticated;
revoke all on function public.uninstall_stockos_cron() from public, anon, authenticated;
grant execute on function public.install_stockos_cron() to service_role;
grant execute on function public.uninstall_stockos_cron() to service_role;
