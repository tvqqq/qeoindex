# QEO-25 / QEO-26 DB Drift + Recovery Gates Design

## Goal

Close the two remaining Phase-0 safety gates without replaying logically-equivalent production migrations and without performing destructive rehearsal on production.

## QEO-25 — migration ledger reconciliation

Treat migration identity as `(logical_name, intended DDL contract)`, not timestamp filename alone. Production versions created by MCP may differ from repository-planned timestamps.

The repository persists a machine-readable reconciliation snapshot containing:

- every recent active repository migration logical name;
- its repository version;
- the corresponding production ledger version;
- reconciliation status;
- explicit quarantine entries when destructive SQL is intentionally outside `supabase/migrations`.

A verifier must fail closed when:

- an active recent repository migration has no production counterpart and is not explicitly allowed;
- a production recent migration has no repository counterpart and is not explicitly explained;
- a mapped repository filename no longer exists;
- a mapped production version/name pair changes unexpectedly;
- a production-applied migration remains only under `supabase/pending-migrations`;
- a quarantined migration unexpectedly appears in production or the active migration path.

The verifier is a QEO-25 guardrail and an input to QEO-23. QEO-23 remains responsible for live remote drift CI and full clean replay/schema-diff CI.

`clean_rebuild_market_snapshot_trigger` is already applied in production as version `20260902011529`; the repository source is reconciled to that filename and must not be re-applied.

### Production evidence correction discovered during implementation

A fresh production ledger read showed that `kfsp_rating_storage_refactor` had already been applied as production version `20260902020424`, despite the earlier Phase-0 snapshot documenting it as quarantined. Production schema evidence also shows the legacy rating columns/raw payload have already been removed and `kfsp_rating_raw_evidence` exists.

Therefore the intended source-of-truth reconciliation is:

- restore the exact migration SQL to active repository history as `supabase/migrations/20260902020424_kfsp_rating_storage_refactor.sql`;
- remove the stale pending copy `20260902090000_kfsp_rating_storage_refactor.sql`;
- do **not** execute or replay the migration against production because production already records and reflects it.

The historical Phase-0 capture remains historical evidence; QEO-25 records the newer correction rather than rewriting that audit history.

## QEO-26 — backup/restore rehearsal

The rehearsal runs only in an approved non-production database. Production is read-only evidence for this issue.

The selected mechanism is a disposable PostgreSQL 17 service in the dedicated `DB Safety` GitHub Actions workflow. This is a real ephemeral non-production database, requires no billable Supabase branch, and exercises the PostgreSQL DDL/backup/restore mechanics relevant to the destructive table/column refactors.

The rehearsal covers two representative destructive classes:

1. drop a legacy score column from a seeded `insights_stock_ratings`-like contract and restore exact rows/schema;
2. drop a seeded legacy bridge table and restore the table/data.

Before destructive DDL, capture:

- schema-only backup;
- representative data backup;
- backup SHA-256 hashes;
- row/parity assertions;
- function/view/grant/RLS/policy metadata required by the fixture.

After destructive DDL, prove the expected objects were removed. Then restore and assert exact parity for data plus schema/security metadata.

Reusable tooling hard-rejects the production project ref/host and requires an explicit non-production `TARGET_ENV`.

## Safety invariants

- No production destructive DDL for rehearsal.
- No migration history rewrite that can cause double apply.
- Production-applied migrations must be represented in active repository history under their reconciled production ledger identity.
- Historical audit snapshots are not silently rewritten when later production evidence supersedes them.
- QEO-18/19/20 destructive work may reuse the rehearsal procedure, but each exact destructive migration still requires its own parity/consumer checks.
- QEO-25 production queries are read-only.
