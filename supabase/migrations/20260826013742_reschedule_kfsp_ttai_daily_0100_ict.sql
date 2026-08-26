begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-hourly') then
    perform cron.unschedule('kfsp-ttai-history-hourly');
  end if;

  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-daily-1am-ict') then
    perform cron.unschedule('kfsp-ttai-history-daily-1am-ict');
  end if;
end $$;

select cron.schedule(
  'kfsp-ttai-history-daily-1am-ict',
  '0 18 * * *',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-ttai-history-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-KFSP-Sync-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'kfsp_sync_secret' limit 1),
        ''
      )
    ),
    body := jsonb_build_object('source', 'supabase_pg_cron'),
    timeout_milliseconds := 55000
  );
  $cron$
);

commit;
