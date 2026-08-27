# EOD Publish Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume the failed 2026-08-26 EOD publish without rebuilding validated Notion data, eliminate chart-series truncation, preserve the historical AI Council date, and make Admin show the latest invocation.

**Architecture:** Keep the existing durable EOD workflow and fail-closed 200-series contract. Bound each Supabase OHLCV RPC response to one ticker while retaining 10-way concurrency. Treat Notion `Ingesting` plus its existing Supabase Run ID as a resumable claim. Thread `scanDate` through deterministic and LLM Council data loading. Order Admin execution history by invocation creation time rather than the historical session timestamp.

**Tech Stack:** Next.js 16, TypeScript, Vercel Workflow, Supabase/PostgREST, Notion API, node:test.

**Spec:** Production incident evidence from `qeoindex.eod_pipeline` run `2103d215-8721-46f1-b72c-c3459f101e70`, Notion run `WYCKOFF-2026-08-26-EOD-v2`, existing claim `28a406cd-7c96-4076-8031-149d07741a26`.

## Task 1 — Reproduce and protect the failure modes

- [x] Add a chart-series test reproducing 10-ticker RPC truncation as 40/200 coverage.
- [x] Add a Notion test requiring `Ingesting` to resume its existing claim.
- [x] Add workflow contract checks for historical resume and Council session propagation.
- [x] Add Admin ordering regression coverage.
- [x] Run the targeted suite and verify RED failures match the incident.

## Task 2 — Fix publish input coverage

- [x] Change recent OHLCV loading to one ticker per RPC response.
- [x] Preserve bounded 10-way concurrency.
- [x] Keep the strict 200/200 chart-series assertion unchanged.

## Task 3 — Resume the existing Notion/Supabase claim

- [x] Return `resume` for Notion `Ingesting` when a Supabase Run ID exists.
- [x] Fail closed when an `Ingesting` run has no claim ID.
- [x] Expose the claim from EOD readiness.
- [x] Make INGEST telemetry record a `resumed` claim without creating a second claim.
- [x] Reuse the existing claim in SUPABASE_PUBLISH.

## Task 4 — Preserve historical AI Council semantics

- [x] Add optional `ratingDate` to Council data/runtime loaders.
- [x] Thread the EOD `scanDate` through deterministic Council and LLM debate operations.
- [x] Keep current-day callers backward compatible when no date is supplied.

## Task 5 — Fix Admin latest-run selection

- [x] Order `system_job_runs` by `created_at DESC`, with `started_at` only as a secondary order.
- [x] Apply the same invocation ordering to Admin overview and job detail history.

## Task 6 — Verify, deploy, and recover 2026-08-26

- [ ] Run `pnpm test:eod-v2` and confirm GREEN.
- [ ] Run full production verification and typecheck.
- [ ] Review the PR diff for scope and regressions.
- [ ] Merge to `main` and wait for Vercel production READY.
- [ ] Trigger `qeo_trigger_eod_pipeline_backfill('2026-08-26')`.
- [ ] Verify resumed INGEST, SUPABASE_PUBLISH 200/200, deterministic Council date 2026-08-26, LLM phase, and COMPLETE.
- [ ] Verify Notion becomes `Ingested` and Admin shows the recovery invocation as latest.
