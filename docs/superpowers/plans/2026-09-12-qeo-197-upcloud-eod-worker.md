# QEO-197 UpCloud EOD Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a single-owner UpCloud EOD worker at 15:01 ICT while preserving the existing EOD v4 business graph and rollback path.

**Architecture:** Extract the orchestration graph behind an injected sleep function, keep Vercel Workflow as rollback, and bundle a standalone Node entrypoint for UpCloud. Install a disabled systemd timer first, deactivate the Supabase 15:15 owner only after smoke verification, then enable UpCloud 15:01.

**Tech Stack:** TypeScript, Node.js 22, esbuild, Docker/Compose, systemd, Supabase pg_cron.

**Spec:** `docs/superpowers/specs/2026-09-12-qeo-197-upcloud-eod-worker-design.md`

## Global Constraints
- UpCloud timer target is 15:01 ICT Monday-Friday.
- MARKET_CLOSE_COLLECT uses 6 total attempts, 5 minutes apart from actual failure time.
- EOD_READY remains fail-closed with 4 total attempts, 5 minutes apart from actual failure time.
- Exactly one production EOD scheduler may be active after cutover.
- Runtime limit starts at 900 MiB RAM and 0.85 CPU.
- No public ports and no committed/printed secrets.

---

### Task 1: Shared EOD orchestrator and 15:01 readiness behavior
**Files:** Modify `workflows/qeoindex-eod-pipeline.ts`; create `modules/eod/orchestrator.ts`; modify EOD contract tests.
**Interfaces:** Produce `runQeoIndexEodOrchestrator(startedAtIso, { sleepUntil })` where `sleepUntil(Date): Promise<void>` is injected by each runtime.
- [ ] Write failing tests asserting 6 MARKET_CLOSE attempts, relative retry scheduling, shared orchestrator delegation, and 15:01 ownership language.
- [ ] Run targeted EOD tests and confirm RED for the missing behavior.
- [ ] Extract orchestration logic, inject sleep, and keep `qeoindexEodPipeline` as a `"use workflow"` wrapper.
- [ ] Run targeted EOD tests and full `pnpm test:eod` to GREEN.
- [ ] Commit the orchestrator change.

### Task 2: Reproducible standalone worker bundle and container
**Files:** Create `services/eod-worker/entrypoint.ts`, `build.mjs`, `server-only.ts`, `Dockerfile`, `.dockerignore`, `.env.example`; modify `package.json` and lockfile; create worker contract tests.
**Interfaces:** `entrypoint.ts` calls `runQeoIndexEodOrchestrator(new Date().toISOString(), { sleepUntil: nativeSleepUntil })`; `pnpm eod:worker:build` emits `services/eod-worker/dist/eod-worker.mjs`.
- [ ] Write failing contract tests for bundle command, server-only alias, non-root runtime, and no exposed ports.
- [ ] Run tests and confirm RED.
- [ ] Add pinned esbuild and minimal worker/build files.
- [ ] Build bundle, run `node --check`, build Docker image, and run contract tests to GREEN.
- [ ] Commit worker runtime.

### Task 3: UpCloud Compose/systemd timer at 15:01
**Files:** Create `services/eod-worker/deploy/upcloud/docker-compose.upcloud.yml`, `qeo-eod.service`, `qeo-eod.timer`, `README.md`; update scheduler/admin contract tests and docs.
**Interfaces:** `qeo-eod.service` runs Compose `run --rm eod-worker`; `qeo-eod.timer` uses `OnCalendar=Mon..Fri *-*-* 15:01:00 Asia/Ho_Chi_Minh` and remains disabled until cutover.
- [ ] Write failing tests for 15:01 timer, no ports, 900 MiB/0.85 CPU limits, and disabled-first deployment contract.
- [ ] Run tests and confirm RED.
- [ ] Add deploy artifacts and update canonical docs/admin labels from 15:15 Supabase ownership to 15:01 UpCloud ownership with readiness caveat.
- [ ] Run EOD and scheduler contract tests to GREEN.
- [ ] Commit deployment contract.

### Task 4: Supabase rollback-safe scheduler retirement
**Files:** Create migration retiring the active pg_cron owner without deleting its rollback definition; add DB contract test.
**Interfaces:** Existing `qeoindex-eod-pipeline-1515-ict` row remains present with `active=false`; UpCloud timer becomes the only active owner after cutover.
- [ ] Write failing migration contract test for inactive-not-deleted legacy owner.
- [ ] Run test and confirm RED.
- [ ] Add idempotent migration using `cron.alter_job(..., active := false)` when the job exists.
- [ ] Run migration contract and DB drift tests to GREEN.
- [ ] Commit scheduler retirement.

### Task 5: Host deployment, safe smoke, and cutover
**Files:** No source changes except evidence/docs if needed.
**Interfaces:** Host `/opt/qeoindex/repo`, `/opt/qeoindex/env/eod-worker.env`, image `qeoindex-eod-worker:local`, units `qeo-eod.service` and `qeo-eod.timer`.
- [ ] Push branch and verify CI on exact head.
- [ ] Pin UpCloud checkout to exact head; provision env without printing values; build image; install unit/timer; verify timer disabled.
- [ ] Run Saturday/non-trading manual service smoke and confirm successful skip/no publish; measure resource usage and verify no public ports.
- [ ] Apply the Supabase migration and prove the old 15:15 owner is inactive.
- [ ] Enable `qeo-eod.timer`, prove next trigger is 15:01 ICT and exactly one EOD owner is active.
- [ ] Update Linear with exact evidence and keep first live trading-session acceptance explicit.

### Task 6: Merge after verification
**Files:** No new implementation files.
**Interfaces:** PR targets `main`; UpCloud deployment is pinned to merged commit after merge.
- [ ] Run `pnpm verify:pr`, `pnpm test:eod`, bundle build, Docker build, and `git diff --check`.
- [ ] Open/update PR, wait for required CI, and merge with exact-head guard if green.
- [ ] Repin UpCloud to merged `main`, rebuild image, and confirm timer state is preserved.
