# QEO-60 → QEO-61 EOD v4 Orchestrator & Fault Isolation Implementation Plan

> **Execution contract:** implement QEO-60 first and merge it before QEO-61. Preserve QEO-59's atomic publish rule: ticker-local failures may continue through healthy preparation/build work, but current canonical Supabase publish and AI Council require 100% validated canonical coverage. Partial runs must be explicit and recoverable.

## Architecture decisions locked for this implementation

1. **QEO-60 dependency DAG**
   - Trading-day gate → KFSP Rating.
   - After Rating freezes the universe, run the TTAI branch and Market Close branch concurrently.
   - READY waits for both branches and re-validates the frozen universe.
   - History uses bounded provider concurrency, never full-universe `Promise.all()`.
   - Wyckoff build → validate → publish remains ordered.
   - AI order becomes Deterministic → Market Synthesis → LLM.
   - Historical backfill remains explicit and never substitutes current provider data into a past session.

2. **Business phase telemetry**
   - Preserve current durable/internal phase keys for backward-compatible telemetry and troubleshooting.
   - Add deterministic mapping of every internal phase to one of seven business phases:
     `DATA_REFRESH`, `READY_GATE`, `HISTORY_PREPARE`, `WYCKOFF_PUBLISH`, `AI_COUNCIL`, `POST_ANALYSIS`, `COMPLETE`.
   - Persist `businessPhase` in phase summaries so QEO-63 can group without guessing.

3. **Bounded concurrency policy**
   - `TTAI_REFRESH` and `MARKET_CLOSE_COLLECT` may execute concurrently only after Rating freezes the universe.
   - History remains in durable windows; each window internally runs a bounded number of max-10 provider batches concurrently.
   - History concurrency is environment-configurable with a safe default and hard cap.
   - No unbounded full-universe provider fan-out.

4. **QEO-61 fault policy**
   - `ticker_local`: record ticker/stage/error, continue unrelated healthy preparation/build.
   - `recoverable_systemic`: use existing bounded retry policy where available; do not silently downgrade auth/DB/canonical errors.
   - `critical_systemic`: fail closed.
   - If one or more tickers remain unhealthy after preparation/build, mark the parent run `partial`, persist exact coverage/retry metadata, and skip atomic publish/Council instead of publishing a reduced universe as canonical.
   - A targeted retry only re-fetches/rebuilds failed ticker scope, combines it with already-staged healthy artifacts, re-validates the full canonical set, then publishes/continues Council only after 100% coverage.

## Task 1 — QEO-60 RED tests

**Modify:**
- `tests/qeoindex-eod-v3.test.ts`
- `tests/wyckoff-eod-refresh.test.ts`
- `tests/qeoindex-eod-phase-telemetry.test.ts`

Add failing contracts for:
- Rating before concurrent TTAI + Market Close branches; READY joins both.
- Configurable bounded history window concurrency with a hard cap.
- Deterministic → Market Synthesis → LLM ordering.
- Stable seven-business-phase mapping persisted into internal phase summaries.
- Historical backfill remains explicit and provider-safe.

Expected RED: current serial workflow, old AI ordering, and phase summaries do not satisfy these contracts.

## Task 2 — QEO-60 implementation

**Modify:**
- `workflows/qeoindex-eod-pipeline.ts`
- `lib/qeoindex-eod-workflow-steps.ts`
- `lib/admin/job-phases.ts`
- `lib/admin/job-phase-telemetry.ts`
- `docs/HANDOVER.md`

Implementation:
- Extract durable TTAI branch and Market Close retry branch, then join with bounded `Promise.all` after Rating.
- Replace serial max-10 history loop with durable history windows that internally fan out only up to configured concurrency.
- Keep frozen-universe assertions around the concurrent branches and before READY.
- Move Market Synthesis before LLM.
- Add business-phase definitions/mapping and telemetry decoration.
- Update active handover from v3 ordering to v4 DAG semantics.

Verification:
- EOD-focused tests.
- `pnpm test:core`.
- `pnpm typecheck`.
- `pnpm lint:touched`.
- `pnpm build` / PR Vercel build.

## Task 3 — Merge QEO-60, then start QEO-61 from updated main

- Merge only when QEO-60 PR checks are green.
- Mark QEO-60 Done only after merge evidence.
- Create QEO-61 branch from the new `main`, not from stale QEO-60 ancestry.

## Task 4 — QEO-61 RED tests

**Create/Modify:**
- `tests/qeoindex-eod-v4-fault-isolation.test.ts`
- `tests/qeoindex-eod-v3.test.ts`
- `tests/root-admin-api.test.ts` or a focused retry route test as appropriate

Add failing contracts for:
- one ticker history/build failure does not abort healthy ticker work;
- exact healthy/failed accounting and retry metadata;
- parent terminal state `partial`, never `succeeded`, when canonical coverage is incomplete;
- publish/Council are skipped while partial coverage exists;
- critical systemic failures still throw/fail closed;
- targeted retry accepts only failed eligible tickers from the original run and rejects arbitrary/unrelated ticker scope;
- successful retry reuses healthy staged artifacts, rebuilds only failed ticker scope, revalidates full canonical membership and keeps prior attempt history.

Expected RED: current full-universe build throws, parent status cannot be `partial`, and no targeted retry contract exists.

## Task 5 — QEO-61 persistence + runtime helpers

**Create:**
- `supabase/migrations/20260903xxxxxx_qeo61_eod_partial_status.sql`
- `lib/qeoindex-eod-fault-isolation.ts`
- `lib/qeoindex-eod-retry-steps.ts`
- `workflows/qeoindex-eod-retry.ts`
- `app/api/admin/qeoindex/eod/retry/route.ts`

**Modify:**
- `lib/qeoindex-eod-workflow-steps.ts`
- `lib/qeoindex-eod-workflow-steps-legacy.ts`
- `lib/wyckoff-v2-cache-read.ts`
- `lib/wyckoff-v2-build-artifacts.ts`
- `workflows/qeoindex-eod-pipeline.ts`

Persistence policy:
- Extend `system_job_runs.status` check constraint with `partial` (no new generated-table type required).
- Keep append-only logical ticker-attempt history inside the EOD run summary (`tickerAttempts`) and append sequentially from durable orchestration checkpoints to avoid concurrent lost updates.
- Store exact failed ticker/stage/errorClass/attempt/retryEligible plus canonical run/date identity.

Runtime policy:
- History windows return exact ticker attempts while continuing healthy ticker work.
- Add partial cache loading that treats missing/invalid ticker history as ticker-local but throws on database/RPC failures.
- Wyckoff build isolates per-ticker build failures and stages all healthy artifacts once.
- If incomplete coverage remains, skip validate/publish/Council and call partial completion.
- Critical identity/accounting/DB failures still throw into the existing parent failure handler.

## Task 6 — targeted retry

Retry workflow input:
- original EOD run ID;
- optional ticker subset requested by root operator.

Rules:
- original run must be `partial`;
- requested tickers must be a subset of persisted retry-eligible failures;
- trading date and universe run ID must still match the original evidence chain;
- HISTORY failures rerun history for those tickers before rebuild;
- WYCKOFF failures rebuild only those tickers;
- load healthy staged artifacts without recomputing healthy ticker analysis;
- combine healthy artifacts + repaired ticker snapshots, compute a new full validation hash, restage deterministic artifacts, run full validate/publish, then Deterministic → Market Synthesis → LLM;
- append retry attempt history; never delete prior attempts;
- on success close original run as `succeeded` with recovery metadata; on residual local failures keep it `partial`.

The retry API is root-only and uses the same CSRF/origin mutation guard as existing admin actions. QEO-63 will add the UI action later; QEO-61 only guarantees a safe API/runtime contract.

## Task 7 — QEO-61 verification and rollout boundary

- Apply migration through the approved Supabase path before marking QEO-61 complete.
- Run EOD/fault/retry tests, core tests, TypeScript, touched lint, secret scan and production build.
- PR must be green before merge.
- Do not retire old schedules or declare production smoke complete here; QEO-64 owns production cutover/smoke.
