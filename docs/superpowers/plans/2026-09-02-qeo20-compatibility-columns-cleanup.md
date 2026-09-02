# QEO-20 Compatibility Columns Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the active `portfolio_transactions.target_price`, `portfolio_transactions.stop_loss`, and `market_ai_conclusions.lease_until` compatibility columns without losing data or breaking portfolio / market-AI behavior.

**Architecture:** Cut application/RPC consumers over to canonical fields first while keeping legacy request compatibility at the HTTP boundary. Add a fail-closed migration that backfills only missing canonical values, rejects conflicting legacy/canonical values, rewrites market-AI lease RPCs to `lease_expires_at` only, then drops exactly the three approved columns. `tags` remains unchanged.

**Tech Stack:** Next.js 16 route handlers, TypeScript/Node test runner, Supabase/PostgreSQL migrations, GitHub CI.

**Spec:** Linear QEO-20.

## Global Constraints

- TDD: write and observe a failing regression before production code.
- Do not modify historical migrations; add a new corrective migration.
- Keep public legacy request aliases (`target_price`, `stop_loss`) only as input compatibility mapped to canonical `_1` fields.
- Never query or write the dropped DB columns from active runtime.
- `tags` is KEEP / NEEDS_EVIDENCE and must not be changed.
- Migration must fail closed on non-lossless legacy/canonical conflicts.

---

### Task 1: Regression guard

**Files:**
- Modify: `tests/portfolio-pnl.test.ts`

- [ ] Add a static regression proving active portfolio routes/PnL no longer query/write legacy DB columns.
- [ ] Require exactly one QEO-20 migration and assert lossless backfill, fail-closed parity checks, RPC rewrites, and the three DROP COLUMN operations.
- [ ] Run through CI and confirm RED on current source before implementation.

### Task 2: Portfolio runtime cutover

**Files:**
- Modify: `app/api/portfolio/[id]/transactions/route.ts`
- Modify: `app/api/portfolio/[id]/transactions/[txId]/route.ts`
- Modify: `app/api/portfolio/[id]/benchmark/route.ts`
- Modify: `lib/portfolio/pnl.ts`
- Modify: `tests/portfolio-pnl.test.ts`

- [ ] Remove legacy DB columns from SELECT/INSERT/UPDATE paths.
- [ ] Map legacy request aliases to `target_price_1` / `stop_loss_1` only.
- [ ] Keep `PortfolioPosition.targetPrice` / `stopLoss` as derived compatibility outputs from canonical level 1.
- [ ] Convert existing unit fixtures to canonical fields.
- [ ] Verify GREEN.

### Task 3: Market-AI lease and destructive migration

**Files:**
- Create: `supabase/migrations/<timestamp>_qeo20_compatibility_columns_cleanup.sql`
- Modify: `tests/market-ai-conclusion.test.ts`
- Modify: `supabase/migration-equivalence.json` as required by drift gate.

- [ ] Backfill legacy target/stop and lease values only where canonical values are null.
- [ ] Raise on any remaining legacy/canonical mismatch.
- [ ] Rewrite `claim_market_ai_conclusion` and `complete_market_ai_conclusion` to use only `lease_expires_at`.
- [ ] Drop only `target_price`, `stop_loss`, `lease_until`.
- [ ] Preserve service-role grants and market-AI lifecycle semantics.
- [ ] Verify focused tests + drift verifier.

### Task 4: Release and production acceptance

- [ ] Merge runtime-compatible code before production DDL.
- [ ] Verify production deployment is READY and portfolio endpoints smoke successfully.
- [ ] Run read-only production parity preflight.
- [ ] Apply the QEO-20 migration through Supabase migration tooling.
- [ ] Verify dropped columns, RLS/grants, portfolio CRUD, and market-AI claim/start/complete/expiry behavior.
- [ ] Reconcile production migration evidence, run final CI, and mark QEO-20 Done only after all acceptance checks pass.
