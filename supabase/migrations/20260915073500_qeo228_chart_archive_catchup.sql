begin;

-- QEO-228 restores archive throughput for the canonical chart universe.
-- The legacy EOD retention phase intentionally keeps a small global bound;
-- this dedicated post-EOD workflow fans out targeted, fail-closed archive
-- work per ticker so a ~200-ticker session cannot outgrow a 48-partition run.
-- The route only dispatches the durable workflow and returns immediately.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'qeoindex-chart-archive-catchup-1535-ict'
  ) then
    perform cron.unschedule('qeoindex-chart-archive-catchup-1535-ict');
  end if;
end $$;

select cron.schedule(
  'qeoindex-chart-archive-catchup-1535-ict',
  '35 8 * * 1-5',
  $cron$
  select net.http_post(
    url := rtrim((
      select s.decrypted_secret
      from vault.decrypted_secrets s
      where s.name = 'qeoindex_app_url'
      limit 1
    ), '/') || '/api/qeoindex/chart-archive-catchup',
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
      'job', 'qeoindex.chart_archive_catchup'
    ),
    timeout_milliseconds := 55000
  );
  $cron$
);

commit;
