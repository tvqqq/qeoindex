# Cron Audit and Timeline Widget Implementation Plan

## Objective

Make `/admin/jobs` an accurate operational view of every scheduled and manual system job, then add a lightweight ICT timeline/mindmap that shows when jobs run, which jobs overlap, and how the EOD dependency chain progresses.

This plan is based on a live production audit performed on 2026-08-26 07:47 ICT against Supabase project `glwhhrmejlonhyorvtzm`, current `origin/main` (`8d4c66f`), Vercel runtime logs, and repository configuration.

## Confirmed production findings

1. Vercel Cron has one active schedule in source: `signals.daily` at `0 0 * * 1-5` (07:00 ICT weekdays). The endpoint returned HTTP 200 on 2026-08-26, but `system_job_runs` has zero `signals.daily` records, so workflow completion cannot be verified from Admin.
2. Supabase `pg_cron` has five active schedules:
   - `kfsp-rating-daily-7am-ict`: `0 0 * * *`
   - `kfsp-ttai-history-daily-1am-ict`: `0 18 * * *` (01:00 ICT daily; rescheduled after the audit)
   - `qeoindex-eod-pipeline-1515-ict`: `15 8 * * 1-5`
   - `sync-universe-5m`: `*/5 2-7 * * 1-5`
   - `sync-universe-eod-1450`: `50 7 * * 1-5`
3. `pg_cron` success means only that the asynchronous HTTP request was queued. It is not proof that the Edge Function or workflow succeeded.
4. KFSP rating is healthy: latest run completed on 2026-08-26 with 1,752 rows published and current Top 100 data.
5. Orderbook sync is operational: 100 snapshots for 2026-08-25, Edge logs return 200. Runtime ranges from under 1 second to roughly 59 seconds, so efficiency is variable.
6. `sync-universe-5m` and `sync-universe-eod-1450` both fire at 14:50 ICT, producing duplicate concurrent orderbook sync calls. This is an operational inefficiency and possible write race.
7. At audit time KFSP TTAI was failing continuously: recent runs processed `0/12`, failed `12/12`, and Edge logs returned HTTP 207. Its cadence was subsequently reduced from hourly to daily 01:00 ICT because the underlying data changes with financial statements.
8. The new `qeoindex.eod_pipeline` is scheduled for 15:15 ICT. It had zero runs at audit time because its first scheduled execution had not occurred yet. It must remain `unknown/pending first run`, not healthy.
9. Current Admin cron lookup compares catalog keys with `cron.jobname`; names differ, so pg_cron jobs are not matched reliably.
10. Catalog schedule drift exists: `market.sync_5m` documents `*/5 2-8` while production is `*/5 2-7`; `kfsp.ttai_history` documents minute `0` while production runs at minute `17`.

## Scope and safety boundary

Implement accurate observability, source/catalog corrections, Signals telemetry, and the timeline widget. Do not modify live cron schedules, disable jobs, deploy Supabase migrations/functions, merge to `main`, or deploy production in this task. The 14:50 overlap and TTAI provider failure must be surfaced prominently with remediation recommendations; production scheduling/provider changes need a separate reviewed release.

## Phase 1 — Canonical schedule and evidence model

Files: `lib/admin/types.ts`, `lib/admin/catalog.ts`, `lib/admin/effective-job-catalog.ts`, and a focused new helper such as `lib/admin/job-schedule.ts`.

1. Extend `AdminJobDefinition` with explicit optional scheduler metadata:
   - `schedulerName` for exact `cron.jobname` matching.
   - `scheduleKind`: `point | interval | manual | workflow`.
   - optional ICT window metadata for interval visualization.
   - optional dependency keys for the EOD pipeline.
2. Correct catalog schedules to match production source of truth:
   - market 5-minute window: `*/5 2-7 * * 1-5`, 09:00–14:55 ICT.
   - KFSP TTAI: `0 18 * * *`, daily at 01:00 ICT.
3. Map all five pg_cron names explicitly. Never infer a scheduler name by replacing punctuation in a job key.
4. Keep manual-only jobs distinct from scheduled jobs so the UI does not describe them as cron jobs.
5. Add deterministic tests asserting catalog ↔ `vercel.json` ↔ migration schedule parity.

## Phase 2 — Truthful health aggregation

Files: `lib/admin/job-health.ts`, a new evidence adapter module such as `lib/admin/job-evidence.ts`, existing telemetry helpers, and tests.

1. Separate two concepts in the view model:
   - scheduler health: active/inactive, last dispatch, configured schedule;
   - execution health: actual domain outcome and freshness.
2. Never mark an HTTP-backed pg_cron job healthy solely from `cron.job_run_details.status = succeeded`.
3. Resolve execution evidence from canonical sources:
   - `qeoindex.eod_pipeline` and manual jobs: `system_job_runs` plus `system_job_phases`.
   - `kfsp.rating_daily`: `kfsp_rating_sync_runs`.
   - `kfsp.ttai_history`: `kfsp_ttai_sync_runs`.
   - market sync: snapshot session coverage/freshness; scheduler dispatch is secondary evidence.
   - `signals.daily`: `system_job_runs` after Phase 3 instrumentation.
4. Expose a compact `evidenceSource`, `schedulerStatus`, `executionStatus`, and operator-safe `healthReason` in `AdminJobView`.
5. Surface known overlap conflicts derived from schedule metadata. At minimum flag the 14:50 duplicate market sync.
6. Keep all summaries sanitized; never expose cron commands, Vault values, headers, tokens, or provider response bodies.

## Phase 3 — Signals Daily end-to-end telemetry

Files: `workflows/daily-signal-workflow.ts`, a small step-safe telemetry helper, and tests.

1. Add fail-closed start telemetry for job key `signals.daily`, provider `vercel_cron_workflow`, trigger `workflow`.
2. Finish the run as `succeeded`, `skipped`, or `failed` with bounded sanitized summary.
3. Ensure thrown workflow errors update the run before rethrowing.
4. Do not write telemetry around only the route enqueue; record durable workflow completion.
5. Add tests proving start, success, and failure paths write schema-compatible values.

## Phase 4 — ICT mindmap timeline widget

Files: new `components/admin/admin-cron-timeline.tsx`, optional pure layout helper `lib/admin/cron-timeline.ts`, `app/admin/jobs/page.tsx`, and UI tests.

Design requirements:

1. Render a 24-hour ICT time spine with job branches grouped by provider/lane: Vercel Workflow, Supabase pg_cron/Edge, and manual/system.
2. Render point schedules as nodes and recurring schedules as bounded bands:
   - KFSP rating at 07:00.
   - Signals Daily at 07:00 weekdays.
   - TTAI at every `HH:17` without rendering 24 duplicate cards; use one recurring band/node.
   - Market sync as a 09:00–14:55 band labelled every five minutes.
   - Market EOD at 14:50 and visibly flag its overlap with the five-minute band.
   - QeoIndex EOD pipeline at 15:15 with its ten dependency phases shown as a compact branch, not ten full-size cards.
3. Provide weekday/weekend mode or clear day badges so daily and weekday-only schedules are not confused.
4. Node status must use execution evidence, while a small secondary indicator shows scheduler state.
5. Include an accessible ordered-list/table fallback in the DOM. Do not make meaning depend on SVG geometry or color alone.
6. Keep it responsive: horizontal scroll is acceptable on mobile; the time scale must remain dimensionally stable.
7. Use lightweight CSS/SVG only. No charting dependency, canvas, backdrop blur, CSS filter, `transition-all`, continuous animation, or automatic dynamic-link prefetch.
8. Respect `prefers-reduced-motion`; ideally the widget is static.

Suggested information architecture:

```text
00:00 ─ 07:00 ─ 09:00 ───── 14:50 ─ 15:15 ───────── 24:00  ICT
          ├ KFSP Rating       ├ Market EOD [overlap]
          ├ Signals Daily     └ Market 5m band ends 14:55
          └ TTAI @ HH:17                └ QeoIndex EOD
                                            ├ Ready
                                            ├ History
                                            ├ Wyckoff/Notion/Publish
                                            └ Council deterministic → LLM
```

## Phase 5 — Operator review panel and documentation

1. Add a compact audit summary above/below the timeline:
   - healthy confirmed jobs;
   - failing confirmed jobs;
   - unverified first-run jobs;
   - schedule conflicts;
   - last evidence timestamp and source.
2. Explicitly show:
   - TTAI failure (`0/12`, HTTP 207) as failing;
   - 14:50 duplicate market sync as an efficiency warning;
   - QeoIndex EOD as awaiting first execution until a real run exists;
   - Signals Daily as execution-unknown until workflow telemetry is recorded.
3. Update `docs/HANDOVER.md` with schedule ownership, evidence sources, and the rule that enqueue success is not execution success.

## Validation gates

1. `pnpm run test:core`
2. `pnpm run test:supabase`
3. new focused cron schedule/evidence/timeline tests
4. `pnpm run lint:touched`
5. `pnpm exec tsc --noEmit`
6. `pnpm exec next build --webpack`
7. `git diff --check`
8. Real-browser check at desktop and narrow mobile widths while logged in as root:
   - no clipping that hides job identity/status;
   - recurring bands remain legible;
   - overlap warning visible;
   - no layout jitter or unexpected network prefetch burst.

## Required handoff

Return a concise implementation report with changed files, test/build evidence, screenshots of the timeline at desktop/mobile, remaining production risks, and a separate proposed remediation for TTAI failures and the 14:50 overlap. Do not claim those operational defects fixed unless live schedule/provider behavior is changed and reverified.
