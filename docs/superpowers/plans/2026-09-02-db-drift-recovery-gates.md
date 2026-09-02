# DB Drift + Recovery Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close QEO-25 with a fail-closed migration-ledger reconciliation guard and close QEO-26 only after a real non-production destructive backup/restore rehearsal passes.

**Architecture:** QEO-25 uses a committed production-ledger snapshot plus explicit repository↔production equivalence manifest, validated by a deterministic Node script/test. QEO-26 uses a reusable shell rehearsal that hard-rejects production targets, takes schema/data backups, applies representative destructive DDL, restores, and runs parity/security assertions.

**Tech Stack:** Node.js 22 test runner, shell, PostgreSQL/Supabase CLI when available, GitHub Actions Verify.

**Spec:** `docs/superpowers/specs/2026-09-02-db-drift-recovery-gates-design.md`

## Global Constraints

- Never perform destructive rehearsal on production project `glwhhrmejlonhyorvtzm`.
- Never blindly replay a migration solely because repository and production timestamps differ.
- Keep `supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql` quarantined until QEO-26 passes.
- QEO-23 owns future live remote drift CI; QEO-25 supplies its deterministic reconciliation input.

---

### Task 1: QEO-25 fail-closed reconciliation verifier

**Files:**
- Create: `docs/db/qeo-25-migration-ledger.json`
- Create: `scripts/verify-migration-ledger.mjs`
- Create: `tests/db-migration-ledger.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: active SQL filenames under `supabase/migrations`, quarantined filenames under `supabase/pending-migrations`, committed production ledger rows.
- Produces: `verifyMigrationLedger({ repoFiles, pendingFiles, ledger, reconciliation })` returning `{ ok, errors }`; CLI exits non-zero on drift.

- [ ] **Step 1: Write failing tests** for mapped timestamp drift, unexplained repo-only migration, unexplained production-only migration, missing mapped file, and destructive quarantine reactivation.
- [ ] **Step 2: Run Verify and confirm RED** because `scripts/verify-migration-ledger.mjs` does not exist.
- [ ] **Step 3: Implement the minimal verifier** and committed reconciliation snapshot using the read-only production ledger captured on 2026-09-02.
- [ ] **Step 4: Add the focused test to `test:core` and run Verify to GREEN.**
- [ ] **Step 5: Re-query production read-only ledger/function evidence** and update QEO-25 Linear evidence.

### Task 2: QEO-26 reusable recovery rehearsal guard

**Files:**
- Create: `scripts/db-recovery-rehearsal.sh`
- Create: `tests/db-recovery-rehearsal.test.mjs`
- Create: `docs/db/qeo-26-recovery-rehearsal.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`, `TARGET_ENV`, optional `SUPABASE_PROJECT_REF`.
- Produces: backup directory containing schema/data dumps and before/after assertion output; exits non-zero for production targets or parity failures.

- [ ] **Step 1: Write failing static contract tests** proving the script refuses production project/ref, requires non-production target, takes schema+data backups before destructive SQL, restores both destructive classes, and runs parity/security assertions.
- [ ] **Step 2: Run Verify and confirm RED** because the rehearsal script does not exist.
- [ ] **Step 3: Implement minimal guarded rehearsal script** using `pg_dump`, `psql`, and `pg_restore`/SQL restore commands with a disposable fixture schema.
- [ ] **Step 4: Run Verify to GREEN** for static safety contract.
- [ ] **Step 5: Execute the rehearsal on a real non-production Postgres/Supabase environment.** Prefer local disposable DB; if unavailable, stop before any billable Supabase branch creation and obtain explicit cost authorization.
- [ ] **Step 6: Persist actual execution evidence** (environment, backup hashes, destructive proof, restore parity results) in `docs/db/qeo-26-recovery-rehearsal.md` and Linear.

### Task 3: Completion gate

**Files:**
- Update QEO-25/QEO-26 Linear issues and PR body only after verification.

- [ ] **Step 1: Run full GitHub Verify on exact PR head.**
- [ ] **Step 2: Review changed-file diff for production-destructive commands or active migration leakage.**
- [ ] **Step 3: Close QEO-25 only if reconciliation verifier + read-only production evidence pass.**
- [ ] **Step 4: Close QEO-26 only if a real non-production rehearsal passes; otherwise leave it In Progress with the precise environment/cost blocker.**
