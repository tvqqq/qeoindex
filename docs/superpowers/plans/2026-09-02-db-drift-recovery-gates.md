# DB Drift + Recovery Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close QEO-25 with a fail-closed migration-ledger reconciliation guard and close QEO-26 only after a real non-production destructive backup/restore rehearsal passes.

**Architecture:** QEO-25 uses a committed production-ledger snapshot plus explicit repository↔production equivalence manifest, validated by a deterministic Node script/test. QEO-26 uses a reusable shell rehearsal that hard-rejects production targets, takes schema/data backups, applies representative destructive DDL, restores, and runs parity/security assertions on disposable PostgreSQL 17 in GitHub Actions.

**Tech Stack:** Node.js 22 test runner, shell, PostgreSQL 17 client/server, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-02-db-drift-recovery-gates-design.md`

## Global Constraints

- Never perform destructive rehearsal on production project `glwhhrmejlonhyorvtzm`.
- Never blindly replay a migration solely because repository and production timestamps differ.
- A fresh production read supersedes stale audit assumptions: `kfsp_rating_storage_refactor` is already applied as `20260902020424`, so source history must reconcile to that identity without replaying it.
- QEO-23 owns future live remote drift/full replay CI; QEO-25 supplies its deterministic reconciliation input.

---

### Task 1: QEO-25 fail-closed reconciliation verifier

**Files:**
- Create: `docs/db/qeo-25-migration-ledger.json`
- Create: `scripts/verify-migration-ledger.mjs`
- Create: `tests/db-migration-ledger.test.mjs`
- Reconcile: `supabase/migrations/20260902020424_kfsp_rating_storage_refactor.sql`
- Remove stale pending copy: `supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql`

**Interfaces:**
- Consumes: active SQL filenames under `supabase/migrations`, pending filenames under `supabase/pending-migrations`, committed production ledger rows.
- Produces: `verifyMigrationLedger({ repoFiles, pendingFiles, ledger, reconciliation })` returning `{ ok, errors }`; CLI exits non-zero on drift.

- [x] **Step 1: Write failing tests** for mapped timestamp drift, unexplained repo-only migration, unexplained production-only migration, missing mapped file, production-applied migration left pending, and production version mismatch.
- [x] **Step 2: Confirm RED** — DB Safety run #1 failed while implementation scripts were absent.
- [x] **Step 3: Implement the minimal verifier** and committed reconciliation snapshot using the read-only production ledger captured on 2026-09-02.
- [x] **Step 4: Run focused DB Safety tests/verifier to GREEN** — run #11 reports 11/11 contract tests and `Migration ledger reconciliation PASS`.
- [x] **Step 5: Re-query production read-only evidence** — confirmed `20260902020424 kfsp_rating_storage_refactor`, 200 rating rows, canonical contracted columns, raw-evidence table/RLS/grants and publisher presence.

### Task 2: QEO-26 reusable recovery rehearsal guard

**Files:**
- Create: `scripts/db-recovery-rehearsal.sh`
- Create: `tests/db-recovery-rehearsal.test.mjs`
- Create: `docs/db/qeo-26-recovery-rehearsal.md`
- Create: `.github/workflows/db-safety.yml`

**Interfaces:**
- Consumes: `DATABASE_URL`, `TARGET_ENV`, optional `SUPABASE_PROJECT_REF`.
- Produces: backup directory containing schema/data dumps, SHA-256 hashes and before/after assertion output; exits non-zero for production targets or parity failures.

- [x] **Step 1: Write failing static contract tests** proving the script refuses production project/ref, requires non-production target, takes schema+data backups before destructive SQL, restores both destructive classes, and runs parity/security assertions.
- [x] **Step 2: Confirm RED** before implementation in DB Safety run #1.
- [x] **Step 3: Implement guarded rehearsal script** using `pg_dump` and `psql` with a disposable fixture schema.
- [x] **Step 4: Run static safety contract to GREEN** — 5/5 recovery contract tests pass within the 11-test DB Safety suite.
- [x] **Step 5: Execute real non-production rehearsal** — DB Safety run #11 used disposable PostgreSQL 17 and passed both representative destructive changes plus restore.
- [x] **Step 6: Persist execution evidence** — GitHub artifact `qeo-26-recovery-rehearsal`, ID `9829145807`, ZIP SHA-256 `1033fbdb7a8afd54d45bdcdbf486f540bb809490e69c83ac21445ffc8af88060`.

### Task 3: Completion gate

**Files:**
- Update QEO-25/QEO-26 Linear issues and PR body only after verification.

- [ ] **Step 1: Run full GitHub Verify on exact final PR head.**
- [ ] **Step 2: Review changed-file diff for unintended production-destructive commands or migration-history mistakes.**
- [ ] **Step 3: Close QEO-25 only after final reconciliation verifier + read-only production evidence remain green.**
- [ ] **Step 4: Close QEO-26 only after the final PR head retains actual non-production rehearsal evidence.**
