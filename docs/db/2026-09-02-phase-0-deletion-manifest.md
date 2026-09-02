# QEO-17 — DB Refactor Phase 0 deletion manifest

Captured: 2026-09-02 08:56:02 ICT  
Production project: `glwhhrmejlonhyorvtzm`

> Phase 0 is non-destructive. No destructive rehearsal is allowed on production from this document. Later production evidence supersedes stale point-in-time statements below where explicitly called out.

## DROP gate

A future candidate can move to `DROP` only when all are true:

1. Canonical replacement is explicit.
2. Repository search proves zero active app/API/lib/Edge/cron/generated-type/test consumers, excluding migration-history-only references.
3. Production dependency search proves zero active view/function/RPC/trigger dependencies.
4. Data parity/backfill assertions pass.
5. QEO-26 non-production destructive + restore rehearsal passes.
6. Rollback procedure is documented for the exact migration.
7. CI prevents the deleted contract from being reintroduced.

States for future candidates: `DROP`, `DEPRECATE`, `KEEP`, `NEEDS_EVIDENCE`.

## Production baseline

The original Phase-0 capture observed 47 public base tables. Row/storage values below are point-in-time telemetry, not current invariants.

| Table | Estimated rows | Total bytes | Note |
| --- | ---: | ---: | --- |
| `market_ohlcv_history` | 357,834 | 143,532,032 | KEEP; canonical raw Daily history |
| `insights_stock_ratings` | 200 | 8,880,128 | Hot rating read model at original capture |
| `kfsp_ttai_quarterly_history` | 5,572 | 5,005,312 | KEEP; provider history/evidence |
| `stock_orderbook_snapshots` | 200 | 2,990,080 | KEEP; live/final market read model |
| `kfsp_universe_candidate_snapshots` | 1,752 | 1,466,368 | KEEP; current candidate feed |
| `market_insight_snapshot_staging` | 724 | 1,089,536 | KEEP; staging lifecycle |

Empty rows are not deletion evidence.

## Consumer/deletion manifest

| Candidate | Canonical replacement | Current evidence | State / action |
| --- | --- | --- | --- |
| `wyckoff_universe_memberships` | `market_universe_memberships` | Active readers/writers still existed at Phase-0 capture. | `DEPRECATE`; QEO-19 must cut over consumers and pass QEO-26 before drop. |
| `kfsp_provider_tokens` | Vault/runtime secret access | Active Edge consumers still existed at Phase-0 capture. | `DEPRECATE`; QEO-19 must finish Vault cutover before drop. |
| `insights_stock_ratings.score_4m` | `kfsp_score_4m` | **Correction 2026-09-02:** production migration `20260902020424_kfsp_rating_storage_refactor` is applied; legacy column is absent. | `DROP APPLIED`; do not replay. |
| `insights_stock_ratings.canslim_score` | `kfsp_canslim_score` | Same production-applied migration; legacy column absent. | `DROP APPLIED`; do not replay. |
| `insights_stock_ratings.stock_rs_score` | `kfsp_stock_rs_score` | Same production-applied migration; legacy column absent. | `DROP APPLIED`; do not replay. |
| `insights_stock_ratings.sector_rs_score` | `kfsp_sector_rs_score` | Same production-applied migration; legacy column absent. | `DROP APPLIED`; do not replay. |
| `portfolio_transactions.target_price` | `target_price_1/2/3` | API still writes compatibility value from `target_price_1`. | `DEPRECATE`; QEO-20 cutover + QEO-26 required before future drop. |
| `portfolio_transactions.stop_loss` | `stop_loss_1/2/3` | API still writes compatibility value from `stop_loss_1`. | `DEPRECATE`; QEO-20 cutover + QEO-26 required before future drop. |
| `portfolio_transactions.tags` | Possible `setup_tags` + `mistake_tags` split | Semantic equivalence not proven. | `NEEDS_EVIDENCE`. |
| `market_ai_conclusions.lease_until` | `lease_expires_at` | Production RPC compatibility references existed at Phase-0 capture. | `DEPRECATE`; rewrite/verify RPCs + QEO-26 before future drop. |

## Explicit KEEP guardrail

Do not delete merely because empty/low-row-count:

- `market_ohlcv_archive_ranges`
- `market_insight_snapshot_staging`
- `ai_council_confirmations`
- `ai_council_agent_stats`
- sync-state/staging/checkpoint tables with defined operational lifecycle
- `kfsp_ttai_quarterly_history` and provider evidence required for historical reconstruction

## Migration ledger reconciliation

Canonical machine-readable mapping: `supabase/migration-equivalence.json`.  
Reviewed production ledger evidence: `docs/db/evidence/production-migration-ledger-2026-09-02.json`.  
Verification command: `pnpm db:drift:verify`.

Supabase-applied migrations can receive a production ledger timestamp different from an original repository filename. Timestamp mismatch alone is never permission to replay SQL. The verifier permits exact historical equality implicitly and requires an explicit reviewed mapping for version drift.

Important corrections after the original Phase-0 capture:

- `clean_rebuild_market_snapshot_trigger` exists in production at `20260902011529`; its function exists and remains service-role-only.
- `restrict_orderbook_prune_trigger_execute` exists in production at `20260902011846`; the public SECURITY DEFINER execute boundary is corrected.
- `kfsp_rating_storage_refactor` exists in production at `20260902020424`; production schema confirms the rating aliases/raw payload were removed and `kfsp_rating_raw_evidence` exists with service-role-only table access.
- Therefore `kfsp_rating_storage_refactor` is **not quarantined** anymore. QEO-25 reconciles source to the already-applied production version to prevent a second application.

The former hand-maintained mapping table is intentionally removed as an authority. `supabase/migration-equivalence.json` is the reviewed mapping contract and the fail-closed verifier rejects unexplained source/ledger deltas.

## QEO-24 production security evidence

Production verifies:

- `anon` EXECUTE on `qeo_prune_orderbook_after_universe_publish()` = `false`
- `authenticated` EXECUTE = `false`
- `service_role` EXECUTE = `true`
- security advisor no longer reports the public-executable SECURITY DEFINER warning

## QEO-27 production correction

The original Phase-0 note said the destructive rating migration had not run. That statement is superseded by current production evidence:

- production ledger: `20260902020424_kfsp_rating_storage_refactor`;
- legacy rating aliases and `raw_payload` are absent from `insights_stock_ratings`;
- `kfsp_rating_raw_evidence` exists;
- `publish_kfsp_rating_snapshot(uuid, integer)` exists;
- `anon` and `authenticated` cannot select the raw-evidence table; `service_role` can.

QEO-25 source reconciliation must preserve that production-applied version and must not execute the migration again.

## QEO-26 rollback gate

QEO-26 remains mandatory for **future** destructive refactors. The rehearsal must run in disposable non-production infrastructure, never production.

Because the rating legacy columns are already gone in production, the representative rehearsal is updated to use destructive classes that still exist in the current source contract:

1. a legacy compatibility column such as `portfolio_transactions.target_price`;
2. the legacy bridge table `wyckoff_universe_memberships`;
3. synthetic/redacted representative rows only;
4. backup validation before destructive SQL;
5. assert the destructive state actually occurred;
6. restore and verify row/schema/constraint/index/function/view/grant/RLS/type parity.

The approved baseline implementation uses a disposable local Supabase/Postgres environment. A billable hosted Supabase development branch is optional only if a hosted-only behavior later requires it.

## Phase handoff

1. QEO-25: keep source migration history aligned with the production ledger and fail closed on unexplained drift.
2. QEO-26: prove the recovery mechanism for future destructive changes using local non-production infrastructure.
3. QEO-19/QEO-20: perform their own consumer cutover/parity checks before any future table/column drop.
4. QEO-21/QEO-22: use measured storage/query evidence, not row-count heuristics.
5. QEO-23: run the final full migration replay, smoke matrix, generated types and schema-drift CI acceptance.
