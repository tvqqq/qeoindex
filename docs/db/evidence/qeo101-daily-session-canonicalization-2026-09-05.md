# QEO-101 Daily session timestamp canonicalization — 2026-09-05

## Production defect

A completed Daily provider row could carry a provider-specific timestamp instead of the canonical Vietnam session timestamp. Production audit found three non-canonical `1D` rows, all on VAB/Yahoo, including `2026-09-04 07:45:15+00` for the `2026-09-04` session.

Because `market_ohlcv_history` is keyed by `(ticker, timeframe, bar_time)`, a provider timestamp such as `07:45:15+00` could coexist with the canonical `02:00:00+00` row for the same trading session. Provider precedence only handled exact-key updates and therefore could not reconcile those duplicate-session timestamps.

## Root cause

- `modules/market/history/index.ts` returned provider Daily timestamps without one shared canonicalization boundary.
- persistence used provider `bar.time` directly as `bar_time`.
- QEO-101 provider precedence was a `BEFORE UPDATE` trigger, so it only ran after PostgreSQL had already selected an exact unique-key conflict.

## Fix

- normalize all `1D` provider bars to `09:00 Asia/Ho_Chi_Minh` (`02:00 UTC`) at the market-history boundary;
- add a `BEFORE INSERT OR UPDATE` database trigger that canonicalizes Daily `bar_time` before unique-key conflict detection;
- re-upsert legacy non-canonical Daily rows through existing QEO-101 provider precedence, then delete obsolete provider timestamps;
- keep provider ranking unchanged: VCI > DNSE > verified final-close repair > Yahoo/Fallback > VNDirect.

## Production acceptance

Migration applied as `20260905110306_qeo101_daily_session_timestamp_canonicalization`.

After migration:

- canonical frozen universe: 200 members;
- latest completed session `2026-09-04 02:00:00+00`: 200/200 present;
- missing latest-session rows: 0;
- non-canonical Daily rows: 0.

This evidence closes the timestamp/session-key gap independently from QEO-96 realtime work.
