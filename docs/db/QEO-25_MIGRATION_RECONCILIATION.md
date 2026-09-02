# QEO-25 — Production migration reconciliation

Date: 2026-09-02  
Production project: `glwhhrmejlonhyorvtzm`

## Purpose

Prevent accidental migration replay when Supabase production ledger versions differ from repository-planned timestamps. QEO-25 is reconciliation only: it does not rewrite production history and does not execute DDL merely to make filenames match.

## Sources of truth

- Machine-readable mapping: `supabase/migration-equivalence.json`
- Reviewed ledger evidence: `docs/db/evidence/production-migration-ledger-2026-09-02.json`
- Verifier: `scripts/db/verify-migration-drift.mjs`
- Command: `pnpm db:drift:verify`

Old migrations whose repository version exactly equals the production version can pass implicitly. Any version mismatch must be explicitly reviewed and represented in the equivalence manifest.

## Fail-closed conditions

The verifier rejects:

- unexplained active repository-only migrations;
- unexplained production-only migrations;
- timestamp drift without an explicit mapping;
- duplicate logical migration names;
- stale manifest source or production versions;
- a production-applied migration left under `supabase/pending-migrations`;
- a quarantined migration that appears active or already exists in production;
- unsupported/wildcard-style manifest states.

## Updating production evidence

1. Query production read-only:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

2. Persist only returned `version` and `name` values in a dated file under `docs/db/evidence/` together with capture time and project ref.
3. Run:

```bash
pnpm test:db-drift
pnpm db:drift:verify
```

4. If verification fails, classify the delta using repository and production evidence. Never add a wildcard exception.
5. For schema-equivalent history where filename equality is insufficient, verify the affected object contract and document that evidence in the manifest/PR.
6. Never replay SQL solely to make the verifier green.

## Reconciled special cases

### Clean rebuild ordering

Production ledger version: `20260901144121_clean_rebuild_top_stocks_200`.

A clean local replay proved this one-shot migration depends on objects created later by `20260901190000_wyckoff_daily_weekly_storage_cutover`, including `market_ohlcv_bootstrap_state` and the timeframe constraints it validates. The production migration had already executed historically, so production history must not be rewritten or replayed.

The repository replay filename is therefore `20260901193000_clean_rebuild_top_stocks_200.sql`, explicitly mapped to production version `20260901144121`. This preserves production history while making a from-zero repository replay deterministic and dependency-correct.

### Clean-rebuild market snapshot trigger

Production ledger version: `20260902011529_clean_rebuild_market_snapshot_trigger`.

Verified production contract:

- `public.qeo_trigger_market_snapshot_bootstrap()` exists;
- `anon` EXECUTE = false;
- `authenticated` EXECUTE = false;
- `service_role` EXECUTE = true.

The source filename uses the production ledger version. No replay is required.

### Orderbook prune trigger privilege restriction

Production ledger version: `20260902011846_restrict_orderbook_prune_trigger_execute`.

The source filename uses the production ledger version and production privileges verify service-role-only execution for the protected SECURITY DEFINER path.

### KFSP rating storage refactor

A previous Phase-0 note incorrectly classified this migration as not applied/quarantined. Current production evidence supersedes that note.

Production ledger version: `20260902020424_kfsp_rating_storage_refactor`.

Verified production schema contract:

- legacy rating aliases such as `composite_score`, `score_4m`, `canslim_score`, `stock_rs_score`, and `sector_rs_score` are absent from `public.insights_stock_ratings`;
- `industry_group` and `raw_payload` are absent from the hot rating table;
- `public.kfsp_rating_raw_evidence` exists;
- `public.publish_kfsp_rating_snapshot(uuid, integer)` exists;
- `anon` and `authenticated` cannot select `kfsp_rating_raw_evidence`;
- `service_role` can select it.

QEO-25 therefore moves the source migration to the exact production version `20260902020424` and removes the stale pending copy. This is source-history reconciliation, not a new production migration rollout. Do not reapply it.

### Market logo provenance concurrent migration

During QEO-25 review, `20260902024536_market_logo_provenance` landed on `main`. The fail-closed verifier correctly rejected the stale branch evidence until production was checked. Read-only production verification confirmed the same version in the migration ledger and `public.market_logo_provenance` exists. The branch then refreshed its ledger evidence and synced the exact migration file; no exception was added.

## CI handoff

`.github/workflows/db-drift.yml` runs the focused regression suite and the verifier for migration/reconciliation changes. `pnpm verify:build` also invokes `pnpm db:drift:verify`, so the guard survives beyond QEO-25 and can be reused by QEO-23.

## QEO-26 relationship

QEO-26 still gates future destructive refactors. Since the KFSP legacy score columns are already absent, QEO-26 uses still-existing destructive representatives such as `portfolio_transactions.target_price` and `wyckoff_universe_memberships` for the backup/restore rehearsal.
