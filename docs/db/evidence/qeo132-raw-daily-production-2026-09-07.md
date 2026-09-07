# QEO-132 RAW Daily production evidence — 2026-09-07

## Verified production migration

- Supabase project: `qeoindex` / `glwhhrmejlonhyorvtzm`.
- Repository migration: `20260906169000_qeo132_raw_daily_basis.sql`.
- Production migration: `20260907003316 qeo132_raw_daily_basis`.
- The migration is additive and does not alter, update, delete from, or insert into legacy `market_ohlcv_history`.

## Verified schema and privilege boundary

Production metadata readback after migration verified:

- `market_ohlcv_raw_daily`: RLS enabled; anon/authenticated SELECT denied; service role SELECT allowed; service role INSERT/UPDATE/DELETE denied.
- `market_ohlcv_raw_daily_evidence`: RLS enabled; anon/authenticated SELECT denied; service role SELECT+INSERT allowed; service role UPDATE/DELETE denied.
- `qeo_persist_raw_daily_observation(jsonb, boolean)`: SECURITY DEFINER; fixed `search_path=public, pg_temp`; execute denied to anon/authenticated and allowed to service role.
- append-only evidence trigger is present.
- Both RAW tables contained zero rows immediately after schema promotion.

## Verified rollback-only behavioral smoke

A production transaction was executed and rolled back. It proved:

1. an explicit RAW observation can be persisted and selected canonically;
2. replaying the same raw bar with only `fetched_at` changed reuses the same evidence identity;
3. exact replay does not duplicate evidence;
4. a corrected observation creates a second evidence row but does not move canonical selection unless explicitly requested;
5. explicit correction selection moves canonical to the corrected evidence while preserving the original evidence row unchanged;
6. direct UPDATE and DELETE of evidence are rejected;
7. a non-RAW observation fails atomically;
8. post-rollback counts were zero for fixture rows, total evidence rows, and total canonical rows.

## Production/source reconciliation note

Production already contains `20260906223014 qeo129_adjusted_daily_shadow`, while QEO-129 source remains intentionally unmerged from `main` until QEO-132 lands. The migration drift manifest records that exact temporary state as `PRODUCTION_AHEAD`; it does not import QEO-129 source into this PR and it remains fail-closed for any unreviewed production-only migration.

## Activation boundary

This evidence does **not** authorize bulk StockBiz ingestion and does **not** activate QEO-129 rollout. QEO-132 establishes the auditable RAW Daily storage/read boundary only.
