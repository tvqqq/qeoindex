-- Reschedule sync-universe-5m to */5 2-7 * * 1-5 (09:00 - 14:55 ICT, Mon - Fri)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m') then
    perform cron.unschedule('sync-universe-5m');
  end if;
end $$;

select cron.schedule(
  'sync-universe-5m',
  '*/5 2-7 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
