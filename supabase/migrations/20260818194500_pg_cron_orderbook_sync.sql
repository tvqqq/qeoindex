-- Enable pg_net and pg_cron extensions
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Schedule 5-minute sync during market hours (02:00 - 08:59 UTC = 09:00 - 15:59 ICT, Monday - Friday)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m') then
    perform cron.unschedule('sync-universe-5m');
  end if;
end $$;

select cron.schedule(
  'sync-universe-5m',
  '*/5 2-8 * * 1-5',
  $$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Also schedule 14:50 EOD closing sync (07:50 UTC, Monday - Friday)
do $$
begin
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
