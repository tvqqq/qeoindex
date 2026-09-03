begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1445') then
    perform cron.unschedule('sync-universe-eod-1445');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1450') then
    perform cron.unschedule('sync-universe-eod-1450');
  end if;
end $$;

select cron.schedule(
  'sync-universe-eod-1450',
  '50 7 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "eod_sync", "source": "supabase_pg_cron_eod"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

commit;
