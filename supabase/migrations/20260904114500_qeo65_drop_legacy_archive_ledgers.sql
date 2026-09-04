-- QEO-65: remove archive-ledger objects that are no longer part of the EOD v4 runtime.
-- Production dependency proof on 2026-09-04 established:
-- - eod_archive_checkpoints: 0 rows, no FK/view/trigger/policy/cron consumers;
-- - market_ohlcv_archive_ranges: 0 rows, no FK/view/trigger/policy/cron consumers;
-- - qeo_archive_retention_preflight(date) is the only remaining database function
--   that references the old eod_archive_checkpoints/Drive+Notion retention model.
--
-- This migration is intentionally explicit and does not use CASCADE.

begin;

drop function if exists public.qeo_archive_retention_preflight(date);
drop table if exists public.eod_archive_checkpoints;
drop table if exists public.market_ohlcv_archive_ranges;

commit;
