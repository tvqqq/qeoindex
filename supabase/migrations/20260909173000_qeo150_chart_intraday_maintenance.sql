begin;

-- QEO-150 routine completed-session reconciliation.
-- 14:50 ICT is four minutes after the configured 14:46 chart session close,
-- leaving the bounded workflow inside the <=30 minute reconciliation SLA.
-- The cron command reads existing Vault values at execution time; no secret is
-- stored in migration text. Rollback disables only this maintenance job.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'qeoindex-chart-intraday-maintenance-1450-ict'
  ) then
    perform cron.unschedule('qeoindex-chart-intraday-maintenance-1450-ict');
  end if;
end $$;

select cron.schedule(
  'qeoindex-chart-intraday-maintenance-1450-ict',
  '50 7 * * 1-5',
  $cron$
  select net.http_post(
    url := rtrim((
      select s.decrypted_secret
      from vault.decrypted_secrets s
      where s.name = 'qeoindex_app_url'
      limit 1
    ), '/') || '/api/qeoindex/eod?mode=chart-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select s.decrypted_secret
        from vault.decrypted_secrets s
        where s.name = 'qeoindex_cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'source', 'supabase_pg_cron',
      'job', 'qeoindex.chart_intraday_maintenance'
    ),
    timeout_milliseconds := 55000
  );
  $cron$
);

commit;
