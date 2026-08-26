-- Fix market orderbook sync crons to run strictly during trading hours up to 14:45 ICT without overlap
-- 1. Unschedule old jobs
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1450') then
    perform cron.unschedule('sync-universe-eod-1450');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1445') then
    perform cron.unschedule('sync-universe-eod-1445');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m') then
    perform cron.unschedule('sync-universe-5m');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m-afternoon') then
    perform cron.unschedule('sync-universe-5m-afternoon');
  end if;
end $$;

-- 2. Schedule morning & early afternoon 5m sync (09:00 - 13:55 ICT = 02:00 - 06:55 UTC, Mon - Fri)
select cron.schedule(
  'sync-universe-5m',
  '*/5 2-6 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- 3. Schedule late afternoon 5m sync up to 14:40 ICT (14:00 - 14:40 ICT = 07:00 - 07:40 UTC, Mon - Fri)
select cron.schedule(
  'sync-universe-5m-afternoon',
  '0,5,10,15,20,25,30,35,40 7 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- 4. Schedule EOD closing sync at 14:45 ICT upon market close (07:45 UTC, Mon - Fri)
select cron.schedule(
  'sync-universe-eod-1445',
  '45 7 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "eod_sync", "source": "supabase_pg_cron_eod"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
