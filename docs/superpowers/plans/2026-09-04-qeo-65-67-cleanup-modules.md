# QEO-65 / QEO-67 Cleanup and Module Regrouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove proven legacy runtime/schema/data paths, then regroup only surviving production code into explicit domain modules with a smaller build/test surface.

**Architecture:** Execute deletion-first. QEO-66 already established the canonical test/build safety net. QEO-65 removes obsolete EOD v3/Drive/per-ticker Notion compatibility and only then removes zero-consumer DB objects. QEO-67 moves the surviving domains without compatibility wrappers; workflows stay orchestration-only and import module public APIs.

**Tech Stack:** Next.js 16, TypeScript 5.7, pnpm, Supabase/Postgres, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-04-qeo-65-67-spec-driven-cleanup-design.md`

## Global Constraints

- Canonical `market_ohlcv_history` Daily history is protected and must not be deleted for size reduction.
- No destructive DB migration may use `CASCADE`.
- Every deleted DB object requires zero active-consumer proof plus replay/drift/type verification.
- Notion remains downstream analytical/audit output only; it is not operational EOD state.
- Google Drive is not part of the active EOD graph.
- Active Wyckoff contract is `1D + 1W`, with raw persistent OHLCV `1D` only.
- Active EOD architecture identifier is `supabase-first-eod-v4-dag`.
- No long-lived compatibility re-export layer is permitted after a module move.
- Git history is the archive for deleted source code.

---

### Task 1: Remove EOD archive/workflow legacy source paths

**Files:**
- Create: `modules/eod/runtime-steps.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `modules/eod/archive.ts`
- Modify: `modules/eod/backfill-ready-step.ts`
- Delete: `modules/eod/workflow-steps-legacy.ts`
- Delete: `modules/eod/archive-legacy.ts`
- Delete: `tests/legacy-eod-archive-compat.test.ts`
- Modify: `tests/eod-data-refresh-contract.test.ts`
- Modify: `tests/kfsp-rating-storage-refactor.test.ts`

**Interfaces:**
- Produces: `startQeoIndexEodRunStep`, `runEodReadyStep`, `runMarketCloseCollectStep`, `runCompleteStep` from a current runtime file.
- Retains: `runEodRetentionCleanup(supabase, { tradingDate })` and `EodArchiveCheckpoint` as a small shared result type used by downstream analytical Notion summary.
- Removes: Drive archive, per-ticker Notion operational archive, Notion run archive, deprecated archive inputs, and all `*-legacy` imports.

- [ ] **Step 1: Add regression expectations for the current EOD graph**
  - READY/current runtime code must use canonical universe + current Wyckoff universe.
  - Current workflow steps must not import `workflow-steps-legacy`.
  - Current archive code must not contain Drive credentials or per-ticker Notion archive APIs.
  - Active run/telemetry architecture must be `supabase-first-eod-v4-dag`.

- [ ] **Step 2: Extract only still-active runtime steps**
  - Lift start, READY, market-close collection and COMPLETE behavior out of `qeoindex-eod-workflow-steps-legacy.ts`.
  - Use canonical `vietnamDateKey` helper instead of duplicating the timezone formatter.
  - Change active run key suffix from `EOD-v3` to `EOD-v4` for current and historical backfill readiness.
  - Write `supabase-first-eod-v4-dag` in phase and parent-run telemetry.

- [ ] **Step 3: Delete dead operational archive code**
  - Remove `archiveCanonicalUniverseBatchToNotion`, `archiveEodTickerBatchToNotion`, `archiveEodRunToNotion`, `runEodDriveArchive`, Drive signing/gzip/upload code and deprecated archive compatibility inputs.
  - Keep only Supabase retention RPC orchestration in `qeoindex-eod-archive.ts`.

- [ ] **Step 4: Delete temporary compatibility test and legacy files**
  - Delete both `*-legacy.ts` files and QEO-66's quarantined compatibility test.
  - Remove the deleted legacy archive reader from the KFSP rating-storage regression list.

- [ ] **Step 5: Verify**
  - Run `pnpm test:eod`.
  - Run `pnpm test:current`.
  - Run `pnpm typecheck`.
  - Run `pnpm build`.
  - Run repository search proving no active `qeoindex-eod-*-legacy` or Google Drive archive credential references remain outside historical design/plan docs.

### Task 2: Replace stale canonical EOD documentation

**Files:**
- Modify: `docs/HANDOVER.md`
- Modify: `docs/automation/CRON_WORKFLOW_TOP_STOCKS_200.md`

- [ ] **Step 1: Rewrite active phase contract from current workflow**
  - Document KFSP Rating refresh → parallel TTAI/market-close → READY → bounded Daily history refresh → no-trade repair/build → validate/publish → Council → market synthesis → retention → analytical Notion summary → COMPLETE.
  - Document exactly `1D + 1W`, `N × 2` snapshots, raw Daily storage only.

- [ ] **Step 2: Remove obsolete Drive/Notion operational archive guidance**
  - Remove Drive service-account setup, Drive manifest expectations, `eod_archive_checkpoints` retention authority and old Notion operational archive databases from the active runbook.
  - Preserve historical context only in explicitly historical docs/specs.

- [ ] **Step 3: Verify docs cannot recreate old architecture**
  - Search active canonical docs for `DRIVE_ARCHIVE`, active `NOTION_ARCHIVE`, `EOD-v3`, `supabase-first-eod-v3`, and `eod_archive_checkpoints`.

### Task 3: Remove zero-consumer legacy DB objects

**Files:**
- Create: one timestamped Supabase migration for reviewed destructive cleanup.
- Modify/regenerate: `modules/shared/supabase/database.types.ts`.
- Update tests/contracts when generated type changes require it.

**Candidates:**
- `eod_archive_checkpoints`
- `market_ohlcv_archive_ranges`

- [ ] **Step 1: Prove zero consumers**
  - Repository search for tables/functions/views/RPCs.
  - Query `pg_depend`, views, functions, triggers, policies and foreign-key relationships in production.
  - Record row counts and table/index bytes before deletion.

- [ ] **Step 2: Create no-CASCADE migration**
  - Explicitly drop only objects that pass the proof gate.
  - Do not touch `market_ohlcv_history` or migration ledger safety records.

- [ ] **Step 3: Verify replay/drift/types**
  - Run `pnpm db:replay:verify`.
  - Run `pnpm db:drift:verify`.
  - Run `pnpm db:types:verify` after regenerating types.
  - Run `pnpm verify:full`.

- [ ] **Step 4: Production verification**
  - Apply through the normal migration path.
  - Verify EOD v4, Signals, Admin, Market Insight, Wyckoff, AI Council, auth and portfolio critical paths.
  - Record DB bytes reclaimed.

### Task 4: Create the EOD domain module boundary first

**Files:**
- Create/move surviving EOD implementation under `modules/eod/`.
- Create: `modules/eod/index.ts` as deliberate public API.
- Modify: `workflows/qeoindex-eod-pipeline.ts`, `workflows/qeoindex-eod-retry.ts` and EOD tests/imports.
- Remove old root `lib/qeoindex-eod-*` files after consumers move.

- [ ] **Step 1: Move current EOD survivors without compatibility wrappers**
  - Group readiness/data refresh, history/build/publish, fault isolation/retry, telemetry/result steps, retention and analytical summary by responsibility.
  - Keep workflow files outside modules as orchestration entrypoints.

- [ ] **Step 2: Publish a small EOD API**
  - Export only workflow-consumed operations and shared EOD result/types from `modules/eod/index.ts`.
  - Internal EOD helpers must not be imported directly by unrelated domains.

- [ ] **Step 3: Rewrite imports/tests atomically**
  - Update workflows/routes/tests to canonical module paths in the same commit.
  - Delete old `lib/qeoindex-eod-*` files; do not leave forwarding wrappers.

- [ ] **Step 4: Verify**
  - Run EOD tests, current suite, typecheck and production build.

### Task 5: Regroup remaining high-density domains

**Target boundaries:**
- `modules/auth/`
- `modules/market/{universe,realtime,history,providers}/`
- `modules/kfsp/`
- `modules/wyckoff/`
- `modules/ai-council/`
- `modules/signals/`
- `modules/admin/`
- `modules/portfolio/`
- `modules/research/`
- `modules/notion/`
- `modules/shared/` only for truly cross-domain primitives.

- [ ] **Step 1: Move one domain per independently verifiable commit**
  - Move files by ownership, update imports, add a deliberate `index.ts` only where external consumers need it, and delete old paths in the same commit.

- [ ] **Step 2: Enforce dependency direction**
  - Routes/components adapt external input/output.
  - Workflows orchestrate modules.
  - Domain modules do not import workflow implementations.
  - EOD is a consumer/orchestrator domain, not a foundational dependency of market/KFSP/Wyckoff/AI Council.

- [ ] **Step 3: Eliminate generic dumping grounds**
  - No new `utils`, `helpers`, `misc`, `common` folders without a narrow semantic owner.

### Task 6: Replace the giant hardcoded lint/build surface

**Files:**
- Modify: `package.json`
- Modify tests guarding package/build contracts as needed.

- [ ] **Step 1: Replace hardcoded root-file lint list**
  - Change `lint:touched` to directory/module-based targets that follow architecture boundaries instead of enumerating individual files.

- [ ] **Step 2: Keep build artifact-only**
  - Preserve `build = next build`; do not reintroduce `prebuild` or duplicate PR verification.

- [ ] **Step 3: Verify timing and footprint**
  - Record source files/LOC before and after.
  - Record `test:current`, `verify:pr` and build durations from CI.
  - Compare final bundle/build output with baseline.

### Task 7: Final release and production smoke

- [ ] Run `pnpm verify:full` and `pnpm build` on the final PR head.
- [ ] Confirm all required GitHub checks green.
- [ ] Merge only after the final head is verified.
- [ ] Confirm Vercel production deployment is READY.
- [ ] Run/inspect EOD v4 smoke evidence and critical web/API paths.
- [ ] Update QEO-67 to Done only after module/public-API/lint acceptance is met.
- [ ] Update QEO-65 with before/after source, DB and CI/build metrics; close only after QEO-67 is Done.