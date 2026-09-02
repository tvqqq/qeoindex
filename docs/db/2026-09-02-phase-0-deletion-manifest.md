# QEO-17 — DB Refactor Phase 0 deletion manifest

Captured: 2026-09-02 08:56:02 ICT  
Production project: `glwhhrmejlonhyorvtzm`  
Scope: consumer/dependency map, migration-ledger reconciliation, deletion gate, rollback prerequisites.

> Phase 0 is non-destructive. No `DROP TABLE`, `DROP COLUMN`, or destructive rehearsal is allowed on production from this document.

## 1. Gate definition

A candidate can move to `DROP` only when all of the following are true:

1. Canonical replacement is explicit.
2. Repository search proves zero active app/API/lib/Edge/cron/generated-type/test consumers, excluding migration-history-only references.
3. Production dependency search proves zero active views/functions/RPC/triggers depending on the object.
4. Data parity/backfill assertions pass for the replacement.
5. A non-production destructive rehearsal has completed and restore parity has passed (QEO-26).
6. Rollback SQL/procedure is documented for the exact migration.
7. CI has a regression preventing the deleted contract from being reintroduced.

States used here:

- `DROP`: all gates above passed.
- `DEPRECATE`: canonical replacement exists, but one or more active consumers/gates remain.
- `KEEP`: object has a current lifecycle/operational responsibility and must not be removed merely because it is empty/small.
- `NEEDS_EVIDENCE`: overlap or obsolescence is not yet proven.

## 2. Production baseline

The baseline query used `pg_stat_user_tables` plus `pg_total_relation_size` for all public base tables. Production currently has 47 public base tables.

Largest relations at capture time:

| Table | Estimated rows | Total bytes | Phase-0 note |
| --- | ---: | ---: | --- |
| `market_ohlcv_history` | 357,834 | 143,532,032 | KEEP; canonical raw Daily history |
| `insights_stock_ratings` | 200 | 8,880,128 | MIGRATE internally; table itself remains current |
| `kfsp_ttai_quarterly_history` | 5,572 | 5,005,312 | KEEP; provider evidence/history |
| `stock_orderbook_snapshots` | 200 | 2,990,080 | KEEP; live/final market read model |
| `kfsp_universe_candidate_snapshots` | 1,752 | 1,466,368 | KEEP; current candidate feed |
| `market_insight_snapshot_staging` | 724 | 1,089,536 | KEEP; explicit staging lifecycle |

Exact candidate counts at capture time:

| Object | Rows |
| --- | ---: |
| `insights_stock_ratings` | 200 |
| `market_universe_memberships` | 200 |
| `wyckoff_universe_memberships` | 0 |
| `kfsp_provider_tokens` | 1 |
| `portfolio_transactions` | 1 |
| `market_ai_conclusions` | 0 |

Empty rows are not deletion evidence by themselves.

## 3. Deletion manifest and consumer map

| Candidate | Canonical replacement | Verified consumers/dependencies | Data evidence | State | Hard gate before DROP |
| --- | --- | --- | --- | --- | --- |
| `wyckoff_universe_memberships` | `market_universe_memberships` | Active repository readers/writers remain in `lib/wyckoff-unified-data.ts`, `lib/wyckoff-unified-runner.ts`, `lib/wyckoff-supabase-publish.ts`, `lib/wyckoff-notion-ingest.ts`; tests/docs also reference the legacy table. Production DB function/view scan found no dependency, but code consumers are sufficient to block deletion. | Legacy rows 0; canonical memberships 200. Zero rows do not prove semantic parity. | `DEPRECATE` | Move all readers/writers to canonical membership; prove exact membership/rank parity; zero-consumer search; non-prod restore rehearsal. |
| `kfsp_provider_tokens` | Supabase Vault + runtime secret access | Active Edge consumers: `supabase/functions/kfsp-rating-sync/index.ts`, `kfsp-ttai-history-sync/index.ts`, `market-insight-eod-sync/index.ts` read/upsert cached token. | 1 current row. | `DEPRECATE` | Cut all three consumers to Vault-only flow; verify token refresh/retry; zero-consumer search; restore rehearsal. |
| `insights_stock_ratings.score_4m` | `kfsp_score_4m` | Current app/AI reads predominantly use `kfsp_*`, but production `publish_kfsp_rating_snapshot` still references/writes legacy alias. Migration-history/views/tests also encode compatibility contract. | 200 rows; legacy vs canonical mismatches = 0. | `DEPRECATE` | Change publisher and any remaining compatibility views/contracts; dual-read/dual-write transition if needed; parity test; zero DB/code consumers. |
| `insights_stock_ratings.canslim_score` | `kfsp_canslim_score` | Same publisher dependency as above. | 200 rows; mismatches = 0. | `DEPRECATE` | Same as above. |
| `insights_stock_ratings.stock_rs_score` | `kfsp_stock_rs_score` | Same publisher dependency as above. | 200 rows; mismatches = 0. | `DEPRECATE` | Same as above. |
| `insights_stock_ratings.sector_rs_score` | `kfsp_sector_rs_score` | Same publisher dependency as above. | 200 rows; mismatches = 0. | `DEPRECATE` | Same as above. |
| `portfolio_transactions.target_price` | `target_price_1/2/3` | `app/api/portfolio/[id]/transactions/route.ts` still writes `target_price: target_price_1`. | 1 row; `target_price` vs `target_price_1` mismatch = 0. | `DEPRECATE` | Stop compatibility write/read; migrate historical rows; API/UI regression; restore rehearsal. |
| `portfolio_transactions.stop_loss` | `stop_loss_1/2/3` | Same route still writes `stop_loss: stop_loss_1`. | 1 row; `stop_loss` vs `stop_loss_1` mismatch = 0. | `DEPRECATE` | Same as above. |
| `portfolio_transactions.tags` | Possible `setup_tags` + `mistake_tags` split | Semantic equivalence is not proven. | Current single row has empty `tags`, `setup_tags`, and `mistake_tags`; empty data cannot establish semantic equivalence. | `NEEDS_EVIDENCE` | Define historical semantics and UI/API ownership; prove no independent use; migration/backfill plan. |
| `market_ai_conclusions.lease_until` | `lease_expires_at` | Production `claim_market_ai_conclusion` and `complete_market_ai_conclusion` function definitions still mention `lease_until`; source migrations also intentionally null the legacy field during v2 claims. | Table currently 0 rows. | `DEPRECATE` | Rewrite/verify RPCs using only `lease_expires_at`; regression test concurrency/claim ownership; zero DB dependency; restore rehearsal. |

## 4. Explicit KEEP guardrail

These are not deletion candidates in Phase 0 even when empty or low-volume:

- `market_ohlcv_archive_ranges`
- `market_insight_snapshot_staging`
- `ai_council_confirmations`
- `ai_council_agent_stats`
- sync-state/staging/checkpoint tables with explicit operational lifecycle
- `kfsp_ttai_quarterly_history` and other provider evidence needed for historical reconstruction

## 5. Production migration ledger reconciliation

Supabase MCP-applied migrations can receive a production ledger timestamp different from the original repository filename. A mismatch must therefore be mapped by logical migration name and verified; it must not be blindly replayed.

Current recent mapping:

| Logical migration | Repository version/file | Production ledger version | Phase-0 status |
| --- | --- | --- | --- |
| `market_universe_top_stocks` | `20260901090000` | `20260901011922` | `MAPPED`; historical timestamp drift, do not replay blindly |
| `market_universe_monthly_cron` | `20260901091000` | `20260901012315` | `MAPPED`; historical timestamp drift |
| `top100_legacy_clean_slate` | `20260901100000` | `20260901024528` | `MAPPED`; historical timestamp drift |
| `market_universe_daily_activity_gate` | `20260901123000` | `20260901054004` | `MAPPED`; historical timestamp drift |
| `eod_archive_checkpoints` | `20260901130000` | `20260901064844` | `MAPPED`; historical timestamp drift |
| `fix_orderbook_trading_session_windows` | `20260901152000` | `20260901082239` | `MAPPED`; historical timestamp drift |
| `prune_noncanonical_orderbook_snapshots` | `20260901162500` | `20260901093012` | `MAPPED`; historical timestamp drift |
| `wyckoff_daily_weekly_storage_cutover` | `20260901190000` | `20260901134640` | `MAPPED`; historical timestamp drift |
| `clean_rebuild_top_stocks_200` | `20260901144121` | `20260901144121` | `RECONCILED` by PR #152 / main `79c131ae...` |
| `kfsp_canonical_rating_candidate_split` | `20260901221500` | `20260901151138` | `MAPPED`; historical timestamp drift |
| `kfsp_manual_dispatch_rpc` | `20260901224000` | `20260901153403` | `MAPPED`; historical timestamp drift |
| `fix_kfsp_manual_dispatch_rpc_ambiguity` | `20260901224500` | `20260901153527` | `MAPPED`; historical timestamp drift |
| `kfsp_manual_recovery_lifecycle` | `20260902060000` | `20260901231054` | `MAPPED`; historical timestamp drift |
| `clean_rebuild_market_snapshot_trigger` | reconciled in this Phase-0 branch to `20260902011529` | `20260902011529` | `RECONCILING`; production function exists and ledger statement prefix matches source contract |
| `restrict_orderbook_prune_trigger_execute` | reconciled in this Phase-0 branch to `20260902011846` | `20260902011846` | `RECONCILING`; production privileges verified `anon=false`, `authenticated=false`, `service_role=true`; advisor warning gone |
| `ai_council_authenticated_readonly` | `20260902084500` | `20260902014425` | `MAPPED`; historical timestamp drift |
| `ai_council_debate_identity_cleanup` | `20260902084000` | `20260902014432` | `MAPPED`; historical timestamp drift |

### Replay rule until QEO-23

Do not infer migration application state from repository timestamp alone. For pre-reconciled historical mismatches above, compare the logical migration name plus intended schema contract before replay. QEO-23 must turn this mapping into fail-closed schema-drift/replay CI so a timestamp-only mismatch cannot double-apply a destructive migration.

## 6. QEO-24 security acceptance evidence

Production currently verifies:

- `anon` EXECUTE on `qeo_prune_orderbook_after_universe_publish()` = `false`
- `authenticated` EXECUTE = `false`
- `service_role` EXECUTE = `true`
- Supabase security advisor no longer reports the SECURITY DEFINER public-execute warning for this RPC

The repository regression must use production-ledger filename `20260902011846_restrict_orderbook_prune_trigger_execute.sql`.

## 7. QEO-26 rollback gate

Production currently has no Supabase development branch. The rollback acceptance requires a non-production branch/snapshot and a destructive-then-restore rehearsal. No destructive rehearsal may be substituted on production.

Required rehearsal once a non-production branch is approved:

1. Snapshot schema plus representative rows for the legacy membership table, rating aliases, portfolio aliases, and market-AI lease fields.
2. Apply a representative reversible migration that drops/recreates selected legacy columns/table on non-prod only.
3. Restore/recreate from the captured backup procedure.
4. Verify row counts and alias/canonical parity.
5. Verify functions/views/RPCs, grants, RLS, constraints/indexes, and generated/runtime contracts.
6. Record recovery commands and exact verification output for reuse by QEO-18/19/20.

Supabase branch creation is billable and requires explicit organization ID plus quoted-cost confirmation. Until that authorization is supplied and the rehearsal passes, QEO-17 remains `In Progress` and QEO-18/19/20 destructive work remains blocked.

## 8. Phase handoff

Recommended sequence after Phase-0 gate:

1. QEO-18: slim `insights_stock_ratings` only after publisher/readers are canonical and restore gate is green.
2. QEO-19: migrate `wyckoff_universe_memberships` and `kfsp_provider_tokens` consumers before dropping either table.
3. QEO-20: remove portfolio and market-AI compatibility columns only after API/RPC cutover and parity proof.
4. QEO-21/22: retention/index cleanup should use measured storage/query evidence rather than row-count heuristics.
5. QEO-23: enforce migration-ledger/schema drift and replay safety in CI.
