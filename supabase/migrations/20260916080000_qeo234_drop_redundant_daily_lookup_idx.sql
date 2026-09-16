begin;

-- QEO-234 physical-reclaim preparation.
-- Production transactional benchmark proved the canonical primary key
-- (ticker, timeframe, bar_time) serves bounded latest-Daily reads via a
-- backward index scan within the approved latency gates after this lookup
-- index is absent. Keep the primary key intact; this migration only retires
-- the now-redundant DESC duplicate before any separately authorized rewrite.
drop index if exists public.market_ohlcv_history_lookup_idx;

commit;
