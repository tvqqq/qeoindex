-- QEO-64: final EOD v4 scheduler cutover.
--
-- Same-session KFSP Rating, TTAI and final market-close collection are now
-- internal phases of qeoindex-eod-pipeline-1515-ict. Retire their standalone
-- pg_cron owners while keeping intraday AM/PM market synchronization intact.
-- Recreate the canonical EOD scheduler so applying this migration repeatedly
-- still results in exactly one active post-market orchestrator.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kfsp-rating-daily-7am-ict') then
    perform cron.unschedule('kfsp-rating-daily-7am-ict');
  end if;

  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-daily-1am-ict') then
    perform cron.unschedule('kfsp-ttai-history-daily-1am-ict');
  end if;

  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-daily-0710-ict') then
    perform cron.unschedule('kfsp-ttai-history-daily-0710-ict');
  end if;

  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-hourly') then
    perform cron.unschedule('kfsp-ttai-history-hourly');
  end if;

  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1445') then
    perform cron.unschedule('sync-universe-eod-1445');
  end if;

  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1450') then
    perform cron.unschedule('sync-universe-eod-1450');
  end if;

  if exists (select 1 from cron.job where jobname = 'qeoindex-eod-pipeline-1515-ict') then
    perform cron.unschedule('qeoindex-eod-pipeline-1515-ict');
  end if;

  perform cron.schedule(
    'qeoindex-eod-pipeline-1515-ict',
    '15 8 * * 1-5',
    $cron$select public.qeo_trigger_eod_pipeline();$cron$
  );
end
$$;
