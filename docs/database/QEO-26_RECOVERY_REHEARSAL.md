# QEO-26 — Destructive Database Refactor Recovery Rehearsal

As-of: 2026-09-02 ICT
Parent: QEO-17

## Purpose

This runbook is the mandatory recovery gate before QEO-18/QEO-19/QEO-20 may execute `DROP COLUMN` or `DROP TABLE` on production.

The rehearsal must run on an approved non-production Supabase database. **Never rehearse destructive rollback on production.**

## Environment prerequisite

Current production project has no Supabase development branches.

Creating a Supabase branch is billable and requires:

1. user-confirmed organization ID;
2. branch cost lookup for that organization;
3. explicit user cost confirmation;
4. branch creation only after confirmation.

Until these are satisfied, this document is a prepared runbook only; QEO-26 remains incomplete.

## Rehearsal dataset

Use synthetic data only. Do not copy user rows or provider access tokens.

Create representative synthetic rows covering:

- `insights_stock_ratings` legacy ↔ `kfsp_*` alias parity;
- `portfolio_transactions` legacy target/stop fields ↔ `_1/_2/_3` fields;
- `market_ai_conclusions` lease lifecycle fields;
- a synthetic legacy bridge table scenario equivalent to `wyckoff_universe_memberships` after consumer cutover.

## Phase A — Baseline snapshot

Capture before destructive migration:

- migration ledger tail;
- table/column definitions;
- constraints and indexes;
- views/RPC/function definitions that depend on target objects;
- RLS state and effective grants;
- row counts;
- deterministic checksums/parity assertions for synthetic rows;
- generated database type output if available in the branch workflow.

Do not include secrets in logs or artifacts.

## Phase B — Representative destructive migration

Rehearse two classes of change.

### B1. Legacy-column removal

Representative sequence:

1. populate canonical field from legacy field where needed;
2. assert zero mismatches;
3. remove dependent function/view/index/grant references;
4. drop the legacy column;
5. verify canonical readers still work.

Use the same ordering intended for QEO-18/QEO-20.

### B2. Legacy-table removal

Representative sequence:

1. prove canonical source is populated;
2. prove all synthetic consumers have cut over;
3. drop the legacy table;
4. verify canonical workflow remains functional.

Use the same ordering intended for QEO-19.

## Phase C — Recovery

Recovery must prove that a destructive mistake is reversible.

### C1. Column recovery

1. recreate the dropped column with the recorded type/nullability/default;
2. restore dependent grants/indexes/functions/views as recorded;
3. deterministically backfill from the canonical replacement;
4. rerun baseline parity/checksum assertions.

### C2. Table recovery

1. recreate the legacy table from recorded DDL;
2. restore constraints/indexes/RLS/grants;
3. backfill from the canonical source or verified pre-drop snapshot;
4. rerun consumer/parity assertions.

## Phase D — Verification matrix

The rehearsal passes only if all are true:

- migration apply succeeds;
- destructive change reaches intended final schema;
- recovery restores the expected schema contract;
- synthetic row counts/checksums/parity pass after recovery;
- no orphan rows are introduced;
- FK/cascade behavior matches expectation;
- RLS and effective grants match baseline;
- views/RPC/functions compile and execute on synthetic inputs;
- generated DB types can be regenerated after both destructive and restored states;
- no secrets or production user rows appear in artifacts.

## Evidence to attach to QEO-26

Record:

- non-production branch/project reference;
- baseline migration version;
- destructive migration version;
- recovery migration/commands;
- before/after/recovered schema assertions;
- parity/checksum results;
- smoke-test output;
- any deviation from the production migration plan.

## Go / No-Go rule

QEO-18/QEO-19/QEO-20 remain blocked from destructive production DDL until this rehearsal passes.

A partial rehearsal, local SQL parse-only test, or production metadata query does **not** satisfy the recovery gate.
