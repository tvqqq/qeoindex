# QEO-105 Universe Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically bootstrap canonical Daily history and bounded recent `1m` chart data only for tickers newly added by an exact published Top 200 universe transition.

**Architecture:** Freeze each published transition as `(previous_run_id, new_run_id)` plus immutable added/removed ticker sets in dedicated durable state. Universe publication remains atomic and independent of provider work: a post-publish database trigger prepares the transition and asynchronously dispatches an authenticated application workflow. The workflow reuses existing Daily `market_ohlcv_history` refresh and QEO-107/QEO-148/QEO-149 intraday ingestion, persists per-ticker stage outcomes, skips already-complete stages on rerun, and verifies readiness before marking a ticker/transition complete.

**Tech Stack:** Next.js/TypeScript, Vercel Workflow, Supabase Postgres/pg_net/Vault, existing market history and chart-data modules, Node test runner.

**Spec:** Linear QEO-105.

## Global Constraints

- Freeze exact previous/new `market_universe_runs` identity; no count-only comparison.
- Existing tickers are not full-rebootstrapped.
- Removed tickers are never deleted from historical OHLC stores.
- Daily history uses the existing canonical `market_ohlcv_history` persistence path.
- Recent `1m` uses existing QEO-107 bootstrap plus QEO-148 coordination and QEO-149 correction-safe writes.
- No synthetic candles; provider gaps/failures remain explicit.
- Per-ticker failures do not prevent unrelated added tickers from progressing.
- Same transition is idempotent and resumes from durable per-stage state.

---

### Task 1: Transition identity and durable state

**Files:**
- Create: `supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql`
- Create: `modules/market/chart-data/universe-bootstrap-policy.ts`
- Test: `tests/qeo-105-universe-bootstrap.cases.ts`

**Interfaces:**
- Produces `diffUniverseTickers(previous, next)` for deterministic fixture tests.
- Produces DB transition/ticker state keyed by exact universe run IDs.
- Produces RPCs `qeo_prepare_chart_universe_bootstrap_transition`, `qeo_claim_chart_universe_bootstrap_transition`, and `qeo_finish_chart_universe_bootstrap_transition`.

- [ ] Write fixture tests proving added/removed/unchanged sets are exact and order-independent.
- [ ] Write source-contract tests proving migration freezes run IDs, stores added ticker rows only, and never deletes OHLC history.
- [ ] Run `node --test tests/qeo-105-universe-bootstrap.cases.ts` and confirm RED before implementation.
- [ ] Implement the pure diff helper and migration state/RPC contract.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Daily + intraday per-ticker bootstrap

**Files:**
- Create: `modules/market/chart-data/universe-bootstrap-workflow-steps.ts`
- Create: `workflows/chart-universe-bootstrap.ts`
- Modify: `tests/qeo-105-universe-bootstrap.cases.ts`

**Interfaces:**
- Daily stage calls `refreshOhlcvHistoryBatch(supabase, [ticker], referenceAt)` and verifies persisted Daily coverage/bootstrap state.
- Intraday stage calls `bootstrapChartIntradayChunk` with `qeo107BootstrapTarget(referenceAt).chunks` and verifies HOT session coverage.
- Per-ticker durable state records daily/intraday stage status and terminal error/provider-gap metadata.

- [ ] Add RED source-contract tests requiring the workflow to process only `addedTickers`, skip durable ready stages, and reuse Daily/QEO-107 helpers.
- [ ] Implement start/claim, Daily step, intraday step, verification and finish steps with per-ticker isolation.
- [ ] Implement the workflow with bounded concurrency/retry and no full-canonical bootstrap call.
- [ ] Run focused tests GREEN.

### Task 3: Automatic post-publish handoff

**Files:**
- Modify: `app/api/qeoindex/eod/route.ts`
- Modify: `supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql`
- Create: `.github/workflows/qeo-105.yml`
- Modify: `tests/qeo-105-universe-bootstrap.cases.ts`

**Interfaces:**
- Authenticated POST mode `chart-universe-bootstrap` accepts a durable `transitionId` and starts `chartUniverseBootstrapWorkflow`.
- Post-publish trigger calls transition preparation and pg_net dispatch using existing Vault `qeoindex_app_url`/`qeoindex_cron_secret` values.
- Retry cron redispatches only pending/retryable transitions outside a bounded cooldown.

- [ ] Add RED route/migration tests for automatic post-publish dispatch and secret-free migration text.
- [ ] Implement route mode and trigger/retry dispatch.
- [ ] Add focused CI workflow and run tests GREEN.

### Task 4: Verification, release and production acceptance

**Files:**
- Modify: `supabase/migration-preproduction.json` only if repository migration policy requires an explicit production mapping.
- Update Linear QEO-105/QEO-168 evidence after release.

**Interfaces:**
- Production-safe acceptance uses current published universe as a no-op/idempotency transition unless a real new universe is available; no synthetic membership mutation in production.

- [ ] Run focused QEO-105 tests, touched lint, TypeScript and production build.
- [ ] Review PR diff for destructive writes, hidden full bootstrap, secret leakage and transition race conditions.
- [ ] Merge only with green CI.
- [ ] Apply/confirm production migration and wait for the matching Vercel deployment to be READY.
- [ ] Run authenticated no-op/idempotency smoke against the current transition, confirm no unchanged provider/backfill work and truthful durable status.
- [ ] Read-only verify current canonical Daily/intraday coverage remains intact.
- [ ] Mark QEO-105 acceptance complete only for evidence actually proven and update QEO-168.
