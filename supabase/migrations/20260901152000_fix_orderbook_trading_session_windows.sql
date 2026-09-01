begin;

-- Keep the existing scheduler names for Admin/reconciliation compatibility, but
-- dispatch provider HTTP calls only inside the actual VN trading windows.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m') then
    perform cron.unschedule('sync-universe-5m');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m-afternoon') then
    perform cron.unschedule('sync-universe-5m-afternoon');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-eod-1445') then
    perform cron.unschedule('sync-universe-eod-1445');
  end if;
end $$;

-- Morning session: 09:00-11:30 ICT. The cron expression covers the containing
-- UTC hours; the WHERE guard prevents provider calls after the 11:30 close.
select cron.schedule(
  'sync-universe-5m',
  '*/5 2-4 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron", "session": "morning"}'::jsonb,
    timeout_milliseconds := 25000
  )
  where (now() at time zone 'Asia/Ho_Chi_Minh')::time between time '09:00' and time '11:30';
  $cron$
);

-- Afternoon session: 13:00-14:40 ICT. The final 14:45 snapshot is a separate
-- EOD job so the regular 5-minute sync cannot overlap it.
select cron.schedule(
  'sync-universe-5m-afternoon',
  '*/5 6-7 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "supabase_pg_cron", "session": "afternoon"}'::jsonb,
    timeout_milliseconds := 25000
  )
  where (now() at time zone 'Asia/Ho_Chi_Minh')::time between time '13:00' and time '14:40';
  $cron$
);

select cron.schedule(
  'sync-universe-eod-1445',
  '45 7 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "eod_sync", "source": "supabase_pg_cron_eod"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

commit;
