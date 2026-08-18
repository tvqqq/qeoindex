-- QeoIndex: Supabase pg_cron & pg_net schedule to automatically sync 100 stocks
-- Keeps stock_orderbook_snapshots table in Supabase 100% full even if 0 users visit the site!

-- 1. Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Schedule market sync every 5 minutes during trading hours
-- Trading hours: Monday - Friday, 09:00 - 15:00 ICT (UTC 02:00 - 08:00)
SELECT cron.schedule(
  'qeoindex-sync-universe-5m',
  '*/5 2-8 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://qeoindex.qeoqeo.com/api/market/sync-universe',
      headers:='{"Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 3. Schedule EOD closing snapshot sync at 14:50 ICT (07:50 UTC) to capture final closing prices & trades
SELECT cron.schedule(
  'qeoindex-sync-eod-close',
  '50 7 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://qeoindex.qeoqeo.com/api/market/sync-universe?force=1',
      headers:='{"Content-Type": "application/json"}'::jsonb
    );
  $$
);
