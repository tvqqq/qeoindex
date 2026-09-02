# QEO-25 / QEO-26 DB Drift + Recovery Gates Design

## Goal

Close the two remaining Phase-0 safety gates without replaying logically-equivalent production migrations and without performing destructive rehearsal on production.

## QEO-25 — migration ledger reconciliation

Treat migration identity as `(logical_name, intended DDL contract)`, not timestamp filename alone. Production versions created by MCP may differ from repository-planned timestamps.

The repository will persist a machine-readable reconciliation snapshot containing:

- every recent active repository migration logical name;
- its repository version;
- the corresponding production ledger version;
- reconciliation status and rationale;
- explicit quarantine entries for destructive SQL that is intentionally outside `supabase/migrations`.

A verifier must fail closed when:

- an active recent repository migration has no production counterpart and is not explicitly allowed;
- a production recent migration has no repository counterpart and is not explicitly explained;
- a mapped repository filename no longer exists;
- a mapped production version/name pair changes unexpectedly;
- a destructive quarantined migration reappears in the active migration path.

The verifier is a QEO-25 guardrail and an input to QEO-23. QEO-23 remains responsible for live remote drift CI and full replay.

`clean_rebuild_market_snapshot_trigger` is already applied in production as version `20260902011529`; the repository source is reconciled to that filename. It must not be re-applied.

## QEO-26 — backup/restore rehearsal

The rehearsal must run only in an approved non-production database. Production is read-only evidence for this issue.

Preferred mechanism is a disposable local Supabase/Postgres environment. If the execution environment cannot provide PostgreSQL/Supabase locally, the only supported fallback is a Supabase development branch after explicit cost authorization.

The rehearsal must cover two representative destructive classes:

1. drop legacy columns from a seeded `insights_stock_ratings`-like contract and restore the exact rows/schema;
2. drop a seeded legacy bridge table and restore the table/data.

Before destructive DDL, capture:

- schema-only backup;
- representative data backup;
- parity fingerprint/row counts;
- function/view/grant/RLS/type metadata required by the fixture.

After destructive DDL, prove the expected breakage occurred. Then restore and assert exact parity for data plus schema/security metadata.

Reusable tooling must refuse production project/reference targets.

## Safety invariants

- No production destructive DDL for rehearsal.
- No migration history rewrite that can cause double apply.
- `supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql` stays quarantined until QEO-26 passes.
- No QEO-18/19/20 destructive rollout is unblocked before QEO-26 evidence is complete.
- QEO-25 production queries are read-only.
