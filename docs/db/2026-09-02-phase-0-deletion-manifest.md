# QEO-17 — DB Refactor Phase 0 deletion manifest

Captured: 2026-09-02 08:56:02 ICT  
Production project: `glwhhrmejlonhyorvtzm`

> Phase 0 is non-destructive. No `DROP TABLE`, `DROP COLUMN`, or destructive rehearsal is allowed on production from this document.

## DROP gate

A candidate can move to `DROP` only when all are true:

1. Canonical replacement is explicit.
2. Repository search proves zero active app/API/lib/Edge/cron/generated-type/test consumers, excluding migration-history-only references.
3. Production dependency search proves zero active view/function/RPC/trigger dependencies.
4. Data parity/backfill assertions pass.
5. QEO-26 non-production destructive + restore rehearsal passes.
6. Rollback procedure is documented for the exact migration.
7. CI prevents the deleted contract from being reintroduced.

States: `DROP`, `DEPRECATE`, `KEEP`, `NEEDS_EVIDENCE`.

## Production baseline

Production has 47 public base tables at capture time.

| Table | Estimated rows | Total bytes | Note |
| --- | ---: | ---: | --- |
| `market_ohlcv_history` | 357,834 | 143,532,032 | KEEP; canonical raw Daily history |
| `insights_stock_ratings` | 200 | 8,880,128 | Current hot rating read model |
| `kfsp_ttai_quarterly_history` | 5,572 | 5,005,312 | KEEP; provider history/evidence |
| `stock_orderbook_snapshots` | 200 | 2,990,080 | KEEP; live/final market read model |
| `kfsp_universe_candidate_snapshots` | 1,752 | 1,466,368 | KEEP; current candidate feed |
| `market_insight_snapshot_staging` | 724 | 1,089,536 | KEEP; staging lifecycle |

Exact candidate counts:

| Object | Rows |
| --- | ---: |
| `insights_stock_ratings` | 200 |
| `market_universe_memberships` | 200 |
| `wyckoff_universe_memberships` | 0 |
| `kfsp_provider_tokens` | 1 |
| `portfolio_transactions` | 1 |
| `market_ai_conclusions` | 0 |

Empty rows are not deletion evidence.

## Consumer/deletion manifest

| Candidate | Canonical replacement | Verified consumer/dependency evidence | Data evidence | State | Gate before DROP |
| --- | --- | --- | --- | --- | --- |
| `wyckoff_universe_memberships` | `market_universe_memberships` | Active readers/writers remain in `lib/wyckoff-unified-data.ts`, `lib/wyckoff-unified-runner.ts`, `lib/wyckoff-supabase-publish.ts`, `lib/wyckoff-notion-ingest.ts`; tests/docs also reference it. | Legacy 0 rows; canonical memberships 200. | `DEPRECATE` | Migrate all readers/writers; exact membership parity; zero-consumer proof; QEO-26. |
| `kfsp_provider_tokens` | Vault/runtime secret access | Active Edge consumers remain in `kfsp-rating-sync`, `kfsp-ttai-history-sync`, `market-insight-eod-sync`. | 1 row. | `DEPRECATE` | Vault-only cutover for all consumers; token refresh/retry proof; QEO-26. |
| `insights_stock_ratings.score_4m` | `kfsp_score_4m` | Runtime readers have been moved toward `kfsp_*`; production `publish_kfsp_rating_snapshot` still references legacy aliases because QEO-27 destructive DB migration is not applied. | 200 rows; mismatch 0. | `DEPRECATE` | Publisher/schema cutover only after QEO-26; 200/200 post-rollout publish proof. |
| `insights_stock_ratings.canslim_score` | `kfsp_canslim_score` | Same as above. | mismatch 0/200 | `DEPRECATE` | Same as above. |
| `insights_stock_ratings.stock_rs_score` | `kfsp_stock_rs_score` | Same as above. | mismatch 0/200 | `DEPRECATE` | Same as above. |
| `insights_stock_ratings.sector_rs_score` | `kfsp_sector_rs_score` | Same as above. | mismatch 0/200 | `DEPRECATE` | Same as above. |
| `portfolio_transactions.target_price` | `target_price_1/2/3` | `app/api/portfolio/[id]/transactions/route.ts` still writes `target_price: target_price_1`. | Current row mismatch 0. | `DEPRECATE` | Stop compatibility write/read; backfill; API/UI regression; QEO-26. |
| `portfolio_transactions.stop_loss` | `stop_loss_1/2/3` | Same route still writes `stop_loss: stop_loss_1`. | Current row mismatch 0. | `DEPRECATE` | Same as above. |
| `portfolio_transactions.tags` | Possible `setup_tags` + `mistake_tags` split | Semantic equivalence is not proven. | Current arrays empty. | `NEEDS_EVIDENCE` | Define semantic ownership and historical behavior before any merge/drop. |
| `market_ai_conclusions.lease_until` | `lease_expires_at` | Production `claim_market_ai_conclusion` and `complete_market_ai_conclusion` definitions still mention `lease_until`. | Table 0 rows. | `DEPRECATE` | Rewrite/verify RPCs using canonical lease only; concurrency regression; QEO-26. |

## Explicit KEEP guardrail

Do not delete merely because empty/low-row-count:

- `market_ohlcv_archive_ranges`
- `market_insight_snapshot_staging`
- `ai_council_confirmations`
- `ai_council_agent_stats`
- sync-state/staging/checkpoint tables with defined operational lifecycle
- `kfsp_ttai_quarterly_history` and provider evidence required for historical reconstruction

## Migration ledger reconciliation

Supabase MCP-applied migrations may receive a production ledger timestamp different from the original repository filename. Timestamp mismatch alone must never be treated as permission to replay SQL.

| Logical migration | Repository version | Production version | Status |
| --- | --- | --- | --- |
| `market_universe_top_stocks` | `20260901090000` | `20260901011922` | `MAPPED` |
| `market_universe_monthly_cron` | `20260901091000` | `20260901012315` | `MAPPED` |
| `top100_legacy_clean_slate` | `20260901100000` | `20260901024528` | `MAPPED` |
| `market_universe_daily_activity_gate` | `20260901123000` | `20260901054004` | `MAPPED` |
| `eod_archive_checkpoints` | `20260901130000` | `20260901064844` | `MAPPED` |
| `fix_orderbook_trading_session_windows` | `20260901152000` | `20260901082239` | `MAPPED` |
| `prune_noncanonical_orderbook_snapshots` | `20260901162500` | `20260901093012` | `MAPPED` |
| `wyckoff_daily_weekly_storage_cutover` | `20260901190000` | `20260901134640` | `MAPPED` |
| `clean_rebuild_top_stocks_200` | `20260901144121` | `20260901144121` | `RECONCILED` by PR #152 / main `79c131ae...` |
| `kfsp_canonical_rating_candidate_split` | `20260901221500` | `20260901151138` | `MAPPED` |
| `kfsp_manual_dispatch_rpc` | `20260901224000` | `20260901153403` | `MAPPED` |
| `fix_kfsp_manual_dispatch_rpc_ambiguity` | `20260901224500` | `20260901153527` | `MAPPED` |
| `kfsp_manual_recovery_lifecycle` | `20260902060000` | `20260901231054` | `MAPPED` |
| `clean_rebuild_market_snapshot_trigger` | reconciled in Phase-0 branch to `20260902011529` | `20260902011529` | `RECONCILING`; production function exists |
| `restrict_orderbook_prune_trigger_execute` | reconciled in Phase-0 branch to `20260902011846` | `20260902011846` | `RECONCILING`; privilege/advisor evidence green |
| `ai_council_authenticated_readonly` | `20260902084500` | `20260902014425` | `MAPPED` |
| `ai_council_debate_identity_cleanup` | `20260902084000` | `20260902014432` | `MAPPED` |
| `kfsp_rating_storage_refactor` | `20260902090000` | not applied | `QUARANTINED`; destructive SQL moved to `supabase/pending-migrations` until QEO-26 passes |

Until QEO-23 implements fail-closed drift/replay CI, historical mappings above are an explicit allowlist and migration replay must be checked by logical name + intended schema contract, not repository timestamp alone.

## QEO-24 production security evidence

Production verifies:

- `anon` EXECUTE on `qeo_prune_orderbook_after_universe_publish()` = `false`
- `authenticated` EXECUTE = `false`
- `service_role` EXECUTE = `true`
- security advisor no longer reports the public-executable SECURITY DEFINER warning

## QEO-27 safety correction

QEO-27 merged source code containing `20260902090000_kfsp_rating_storage_refactor.sql`, which drops legacy rating aliases, `industry_group`, and `raw_payload`. Production ledger does **not** contain `kfsp_rating_storage_refactor`, so the destructive SQL has not run.

Phase-0 response:

- keep the non-destructive runtime canonical-reader refactor;
- move the destructive SQL out of active `supabase/migrations` into `supabase/pending-migrations`;
- keep regression coverage that fails if the destructive migration reappears in active path;
- unblock rollout only after QEO-26 restore rehearsal passes.

## QEO-26 rollback gate

Production currently has no Supabase development branch. The required rollback rehearsal must run on an approved non-production branch/snapshot, never on production.

Rehearsal sequence:

1. Capture schema plus representative rows for legacy membership, rating aliases/raw payload, portfolio aliases, and market-AI lease fields.
2. Apply representative reversible destructive changes on non-prod only.
3. Restore/recreate from captured backup procedure.
4. Verify row/parity assertions.
5. Verify functions/views/RPCs, grants, RLS, constraints/indexes, and runtime contracts.
6. Record exact recovery procedure for QEO-18/19/20/QEO-27.

Supabase branch creation is billable and requires explicit organization ID plus quoted-cost confirmation. Until authorization is supplied and the rehearsal passes, QEO-17 remains `In Progress` and destructive DB rollouts remain blocked.

## Phase handoff

1. QEO-18/QEO-27: apply rating contraction only after QEO-26; then verify production 200/200 rating publication and measure storage/index footprint.
2. QEO-19: migrate legacy Wyckoff membership and provider-token consumers before any table drop.
3. QEO-20: remove portfolio/AI compatibility columns only after API/RPC cutover and parity proof.
4. QEO-21/22: use measured storage/query evidence, not row-count heuristics.
5. QEO-23: turn ledger mapping into fail-closed migration replay/schema-drift CI.
