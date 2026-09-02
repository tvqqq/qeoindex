# QEO-25 — Production migration ledger reconciliation

Captured: 2026-09-02 ICT  
Production project: `glwhhrmejlonhyorvtzm`

## Result

Recent application-owned migration history is reconciled by logical name and explicit repository↔production version mapping in `docs/db/qeo-25-migration-ledger.json`.

The deterministic guard is:

```bash
node scripts/verify-migration-ledger.mjs
```

It fails closed for unexplained repository-only/production-only recent migrations, missing mapped source files, unexpected production-version changes, a production-applied migration left only in `pending-migrations`, and quarantine violations.

## Production correction discovered during QEO-25

The Phase-0 snapshot previously recorded `kfsp_rating_storage_refactor` as not applied and quarantined. A fresh production read on 2026-09-02 shows:

- production migration ledger: `20260902020424 kfsp_rating_storage_refactor`;
- `public.insights_stock_ratings`: 200 rows and the contracted canonical column set;
- legacy rating aliases, `industry_group`, and `raw_payload` are absent from the hot rating table;
- `public.kfsp_rating_raw_evidence` exists with RLS enabled;
- `service_role` has the intended evidence-table DML privileges;
- authenticated users have intended column-level reads on canonical rating fields;
- `public.publish_kfsp_rating_snapshot(uuid, integer)` exists and writes bounded raw evidence.

Source control is therefore reconciled to production by placing the unchanged migration SQL at:

`supabase/migrations/20260902020424_kfsp_rating_storage_refactor.sql`

and removing the stale pending copy:

`supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql`

No production DDL replay is part of QEO-25 because production already contains the migration and resulting schema.

## Snapshot-bootstrap reconciliation

Production currently records:

- `20260902011529 clean_rebuild_market_snapshot_trigger`;
- `public.qeo_trigger_market_snapshot_bootstrap()` exists;
- `anon` EXECUTE: false;
- `authenticated` EXECUTE: false;
- `service_role` EXECUTE: true.

Repository history uses the same production ledger version. Do not replay the older planned filename `20260901214500`.

## Timestamp-equivalence allowlist

The JSON manifest records all known recent timestamp mismatches where logical migration names are the same. Timestamp mismatch alone is not an instruction to execute SQL. Mappings are explicit inputs to the future QEO-23 live schema-drift/full-replay CI.

## Evidence boundary

Supabase's migration ledger exposed here provides migration version/name but not an immutable server-side SQL checksum. QEO-25 therefore proves reconciliation with:

1. explicit logical-name/version mapping;
2. preserved repository SQL under the intended source identity;
3. read-only verification of material resulting production schema/function/grant contracts;
4. a fail-closed repository verifier.

A clean-from-zero full migration replay and broad live schema diff remain intentionally owned by QEO-23 rather than being duplicated here.
