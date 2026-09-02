# QEO-25 + QEO-26 — Migration drift reconciliation and destructive recovery gate

Date: 2026-09-02

## Context

QEO-17 established the Phase-0 DB safety gate and committed `docs/db/2026-09-02-phase-0-deletion-manifest.md`. That manifest already documents the known production↔repository migration-version mappings, quarantines the destructive `kfsp_rating_storage_refactor` migration outside the active migration path, and requires QEO-26 before any destructive rollout.

Current verified state:

- Production has `clean_rebuild_market_snapshot_trigger` under production ledger version `20260902011529`, and `public.qeo_trigger_market_snapshot_bootstrap()` exists with service-role-only execution.
- `restrict_orderbook_prune_trigger_execute` is reconciled to production version `20260902011846` and the production privilege boundary is green.
- Recent logical migrations can have repository filename timestamps different from Supabase production ledger versions. Timestamp mismatch alone is not permission to replay SQL.
- `kfsp_rating_storage_refactor` is intentionally quarantined in `supabase/pending-migrations` because it is destructive and QEO-26 has not passed.
- Production currently has no Supabase development branch. QEO-26 must never rehearse destructive rollback on production.

This work closes the remaining reusable safety gaps rather than redoing QEO-17.

## Goals

### QEO-25

Turn the existing manually documented migration mapping into a machine-verifiable, fail-closed reconciliation contract that can later be consumed by QEO-23 schema-drift CI.

Acceptance intent:

1. Every recent repository migration and production migration is either an exact match, an explicitly mapped logical equivalent, an intentionally quarantined pending migration, or an explicitly allowed transient state.
2. No unexplained repo-only or production-only logical migration remains.
3. Known timestamp drift cannot cause accidental double-apply.
4. The verifier produces deterministic evidence suitable for CI and review.
5. The production schema contract for reconciled migrations is checked where filename/history equality is insufficient.

### QEO-26

Execute a real destructive-change + restore rehearsal against a disposable local Supabase/Postgres environment, using repository migrations and synthetic representative data only.

Acceptance intent:

1. Backup exists before destructive rehearsal.
2. Destructive rehearsal runs only on non-production local infrastructure.
3. Restore succeeds.
4. Schema and representative data parity assertions pass after restore.
5. Functions/views/RPCs, grants, RLS, constraints/indexes, and relevant types are verified.
6. A reusable recovery command/runbook is checked into source control for QEO-18/QEO-19/QEO-20/QEO-27.

## Non-goals

- Do not rewrite historical production migration ledger entries.
- Do not blindly rename all repository migrations to production timestamps.
- Do not reapply already-equivalent SQL to production.
- Do not create or pay for a hosted Supabase development branch as the default path.
- Do not run any destructive rehearsal against production.
- Do not unquarantine or deploy the destructive rating-storage migration as part of QEO-25/QEO-26.
- Do not close QEO-23; this work only provides inputs for its final CI/smoke gate.

## Workstream A — QEO-25 migration reconciliation

### A1. Machine-readable equivalence manifest

Add a checked-in manifest, preferably `supabase/migration-equivalence.json`, with one entry per relevant migration:

- logical migration name;
- repository version;
- production ledger version;
- state: `EXACT`, `MAPPED`, `QUARANTINED`, or narrowly scoped `ALLOWED_TRANSIENT`;
- evidence type: filename/history equality, normalized SQL checksum, or schema-contract verification;
- rationale/comment for non-exact mappings.

The current mapping table in `docs/db/2026-09-02-phase-0-deletion-manifest.md` is the bootstrap source, not a second source of truth. The implementation must update the documentation to point to the machine-readable manifest.

### A2. Fail-closed verifier

Add a repository script, preferably `scripts/db/verify-migration-drift.mjs`, that compares:

- active repository migrations under `supabase/migrations`;
- intentionally quarantined migrations under `supabase/pending-migrations`;
- a supplied production-ledger snapshot/export;
- the equivalence manifest.

The verifier must fail on:

- repo-only active logical migration not explicitly accounted for;
- production-only logical migration not explicitly accounted for;
- duplicate logical migration mappings;
- an exact-version entry whose versions differ;
- a mapped entry whose logical names disagree;
- a quarantined migration appearing in the active migration directory;
- stale manifest entries that reference missing source files;
- unexplained production version changes.

The verifier must not infer safety solely from timestamp equality.

### A3. Production evidence capture

Provide a read-only command/query path that exports the current production migration ledger into a deterministic JSON/text fixture for review. No DDL or data mutation occurs in QEO-25 verification.

Where ledger history alone cannot prove equivalence, capture schema-contract evidence for the affected object. At minimum, the snapshot-bootstrap trigger function and execution privileges must remain covered because this migration was previously misclassified as repo-ahead.

### A4. Tests

Use TDD for the verifier. Cover at least:

- exact match passes;
- mapped timestamp mismatch passes;
- unexplained repo-only fails;
- unexplained production-only fails;
- duplicate logical mapping fails;
- quarantined migration in active directory fails;
- stale/missing mapped source file fails;
- changed production version fails until manifest is reviewed.

### A5. QEO-23 handoff

Expose a stable package script such as `pnpm db:drift:verify` so QEO-23 can wire it into CI without redesigning the reconciliation model.

## Workstream B — QEO-26 recovery rehearsal

### B1. Environment

Default to a disposable local Supabase environment created from repository migrations. This avoids production risk and hosted-branch cost while still exercising real Postgres DDL, roles, grants, RLS, RPCs, and restore behavior.

The rehearsal script must fail before any destructive SQL if it detects a production connection/reference. Production project ref `glwhhrmejlonhyorvtzm` must be treated as forbidden input for destructive rehearsal.

### B2. Representative synthetic fixture

Seed synthetic/redacted rows only. The fixture should cover the destructive classes already queued behind the gate:

1. Dropped legacy rating column(s), e.g. `insights_stock_ratings.score_4m` paired with canonical `kfsp_score_4m`.
2. Dropped legacy table class, e.g. `wyckoff_universe_memberships` recreation/backfill path.
3. If practical in the same fixture, compatibility columns from `portfolio_transactions` and lease semantics from `market_ai_conclusions` should be included as additional assertions, but they are not required to make the rehearsal representative.

No production user rows are copied.

### B3. Backup

Before destructive DDL:

- capture schema plus data backup of the local rehearsal database;
- record checksum/file metadata where practical;
- verify the backup artifact is non-empty and restorable before proceeding.

The backup format and commands must be documented and scripted rather than being a one-off manual sequence.

### B4. Destructive rehearsal

Apply representative reversible destructive changes on local only:

- drop at least one legacy column;
- drop at least one legacy table or equivalent destructive object.

Immediately run assertions proving the destructive state actually occurred. This prevents a false-positive restore test where nothing was deleted.

### B5. Restore and parity

Restore from the captured backup, then assert:

- row counts and selected synthetic values restored;
- dropped columns/tables restored;
- PK/FK/unique/check constraints restored where covered;
- indexes restored where covered;
- functions/views/RPC signatures restored;
- grants and RLS state restored;
- enum/custom type presence restored where applicable;
- migration/schema contract is consistent with the pre-destructive baseline.

### B6. Fail-safe behavior

The rehearsal must:

- use `set -euo pipefail` or equivalent fail-fast behavior;
- emit explicit phase names;
- stop on failed backup validation;
- stop on failed destructive-state assertion;
- stop on failed restore parity;
- clean up disposable local resources when safe;
- preserve failure evidence/logs sufficiently for debugging.

### B7. Reusable interface

Expose one top-level command, e.g. `pnpm db:recovery:rehearse`, that performs setup → migrate → seed → backup → destroy → verify-destroyed → restore → parity checks.

Add a recovery runbook under `docs/db/` describing:

- prerequisites;
- exact command;
- forbidden production usage;
- backup artifact location/lifecycle;
- expected assertions;
- troubleshooting;
- how QEO-18/QEO-19/QEO-20/QEO-27 should reference the rehearsal before destructive rollout.

## PR boundary

Use two implementation PRs for reviewability:

1. **QEO-25 PR** — equivalence manifest, read-only ledger evidence/export, fail-closed verifier, tests, docs.
2. **QEO-26 PR** — local recovery harness, synthetic fixture, backup/restore assertions, tests/runbook.

QEO-25 may merge independently because it is non-destructive. QEO-26 must pass its actual local rehearsal before it is considered complete.

Neither PR should deploy destructive production DDL.

## Verification

### QEO-25 completion evidence

- unit/regression tests for verifier pass;
- current main migration set passes against the reviewed production-ledger snapshot;
- intentionally quarantined `kfsp_rating_storage_refactor` is recognized as quarantined, not repo-ahead drift;
- no unexplained active repo-only or production-only migration remains;
- `clean_rebuild_market_snapshot_trigger` is explicitly mapped/reconciled without double-apply.

### QEO-26 completion evidence

- local Supabase/Postgres starts from clean state;
- repository migrations replay successfully to the intended safe baseline;
- synthetic fixture inserts successfully;
- backup validation passes;
- destructive assertions pass;
- restore completes;
- all parity assertions pass;
- a second clean rehearsal run is idempotent/deterministic enough to serve as a release gate.

## Rollout / issue-state rules

- Keep QEO-25 and QEO-26 In Progress until their respective acceptance evidence is attached/commented.
- QEO-26 is the hard gate for destructive DB rollout.
- Do not move QEO-18/QEO-19/QEO-20/QEO-27 destructive migrations into active rollout based only on the existence of a runbook; the actual rehearsal must pass.
- After QEO-25/QEO-26 pass, update QEO-17 gate evidence if needed and allow downstream destructive tasks to proceed according to their own consumer/parity checks.
- QEO-23 remains the final full migration replay, smoke, generated-types, and drift-CI acceptance task.

## Risks and mitigations

### Risk: local environment differs from hosted Supabase

Mitigation: exercise standard Postgres schema/role/RLS/function behavior locally; keep a hosted Supabase branch as an optional second-stage validation if later needed. Do not block the baseline safety gate on billable branch creation unless a hosted-only behavior is discovered.

### Risk: migration manifest becomes stale documentation

Mitigation: fail-closed verifier treats stale/missing entries as errors and QEO-23 later runs it in CI.

### Risk: restore test passes without destructive action

Mitigation: assert the column/table is absent before restore.

### Risk: accidental production target

Mitigation: hard-code forbidden production project reference checks, require local host/runtime markers, and make destructive commands unreachable until environment validation passes.

### Risk: historical migrations are byte-different but schema-equivalent

Mitigation: do not force checksum equality where Supabase-applied SQL/version history makes byte identity inappropriate. Require explicit mapped rationale plus object/schema-contract evidence.

## Decision

Proceed with:

- fail-closed migration-equivalence manifest + verifier for QEO-25;
- disposable local Supabase recovery rehearsal for QEO-26;
- two implementation PRs;
- zero destructive production rehearsal and zero blind migration replay.
