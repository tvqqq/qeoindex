import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import { getPgCronNameForJobKey } from "../lib/admin/job-schedule.ts"
import type { AdminJobDefinition } from "../lib/admin/types.ts"
import { buildAdminJobViews, deriveAdminJobStatus } from "../lib/admin/job-health.ts"
import { deriveScheduleDueState, resolveJobEvidence } from "../lib/admin/job-evidence.ts"
import { interpretEodQuality, interpretRatingQuality, interpretSignalsDailyQuality, interpretTtaiQuality } from "../lib/admin/job-quality.ts"

test("quality interpreters preserve reported scalar counts and honest unknowns", () => {
  assert.equal(interpretEodQuality({ total: 500, complete: 383, incomplete: 117, validationAgreement: true, limitedCoverageCount: 26 }).status, "partial_by_reported_counts")
  assert.equal(interpretEodQuality({ total: 500, complete: 400, incomplete: 100, validationAgreement: false }).status, "inconsistent")
  assert.equal(interpretEodQuality({ total: 0, complete: 0, incomplete: 0, validationAgreement: true }).status, "empty")
  assert.equal(interpretEodQuality({ total: 500, complete: 383, incomplete: 117 }).status, "unknown")
  assert.equal(interpretEodQuality({ total: -1, complete: 0, incomplete: 0, validationAgreement: true }).status, "inconsistent")
  assert.equal(interpretSignalsDailyQuality({ completed: 49, errors: 1, skipped: 0 }).status, "reported_issues")
  assert.equal(interpretSignalsDailyQuality({ completed: 50, errors: 0, skipped: 0 }).status, "no_reported_issues")
  assert.equal(interpretSignalsDailyQuality({ completed: "bad", errors: 0, skipped: 0 }).status, "inconsistent")
  assert.equal(interpretSignalsDailyQuality({ completed: 51, errors: 0, skipped: 0 }).status, "no_reported_issues")
  assert.equal(interpretRatingQuality({ staged: 100, published: 99 }).status, "partial_by_reported_counts")
  assert.equal(interpretRatingQuality({ staged: 0, published: 0 }).status, "empty")
  assert.equal(interpretRatingQuality({ staged: 1, published: 2 }).status, "inconsistent")
  assert.equal(interpretTtaiQuality({ candidates: 12, processed: 11, failed: 1 }).status, "reported_issues")
  assert.equal(interpretTtaiQuality({ candidates: 12, processed: 10, failed: 0 }).status, "no_reported_issues")
  assert.equal(interpretTtaiQuality({ candidates: 0, processed: 0, failed: 0 }).status, "empty")
  assert.equal(interpretTtaiQuality({ candidates: 2, processed: 2, failed: 1 }).status, "inconsistent")
})

const definition: AdminJobDefinition = {
  key: "wyckoff.ingest",
  provider: "vercel_cron",
  label: "Wyckoff Snapshot Ingest",
  description: "Test job",
  group: "wyckoff",
  scheduleUtc: "0 10 * * 1-5",
  scheduleIct: "17:00 T2-T6",
  manualPolicy: "confirm",
  freshnessMinutes: 26 * 60,
  maxDurationMinutes: 5,
}

test("schedule due state does not mark Friday EOD stale before Monday deadline", () => {
  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(eod?.schedulePolicy)
  const monday = new Date("2026-08-31T03:52:00.000Z")
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, "2026-08-28T09:00:00.000Z", monday), "not_due")
  const { jobs } = buildAdminJobViews([eod], [{
    id: "friday-eod", job_key: eod.key, trigger: "workflow", status: "succeeded",
    started_at: "2026-08-28T08:15:00.000Z", finished_at: "2026-08-28T09:00:00.000Z",
  }], [], monday)
  assert.equal(jobs[0].status, "healthy")
  assert.equal(jobs[0].scheduleDueState, "not_due")
})

test("current execution is separated from prior terminal evidence", () => {
  const signals = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "signals.daily")
  assert.ok(signals)
  const monday = new Date("2026-08-31T03:52:00.000Z")
  const resolved = resolveJobEvidence(signals, {
    systemJobRuns: [
      { id: "current", job_key: signals.key, trigger: "workflow", status: "running", started_at: "2026-08-31T00:28:00.000Z", finished_at: null },
      { id: "prior", job_key: signals.key, trigger: "workflow", status: "succeeded", started_at: "2026-08-28T00:28:00.000Z", finished_at: "2026-08-28T07:30:00.000Z" },
    ], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [], orderbookStats: null,
  }, monday)
  assert.equal(resolved.executionStatus, "in_progress")
  assert.equal(resolved.currentExecution?.runId, "current")
  assert.equal(resolved.lastTerminalExecution?.runId, "prior")
})

test("market domain health remains independent when execution telemetry is absent", () => {
  const market = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  assert.ok(market)
  const resolved = resolveJobEvidence(market, {
    systemJobRuns: [], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [],
    orderbookStats: { latestSessionDate: "2026-08-31", totalSnapshots: 100, latestUpdatedAt: "2026-08-31T03:52:00.000Z" },
  }, new Date("2026-08-31T03:52:00.000Z"))
  assert.equal(resolved.executionStatus, "healthy")
  assert.equal(resolved.domainEvidence?.totalSnapshots, 100)
  assert.equal(resolved.executionTelemetry?.source, "unavailable")
})

test("schedule due state respects weekday, deadline and both market windows", () => {
  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_eod")
  const fiveMinute = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  assert.ok(eod?.schedulePolicy && fiveMinute?.schedulePolicy)
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-30T08:00:00.000Z")), "not_due")
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-31T08:05:00.000Z")), "due")
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-31T09:30:00.000Z")), "overdue")
  assert.equal(deriveScheduleDueState(fiveMinute.schedulePolicy, null, new Date("2026-08-31T03:00:00.000Z")), "due")
  assert.equal(deriveScheduleDueState(fiveMinute.schedulePolicy, null, new Date("2026-08-31T03:50:00.000Z")), "due")
})

test("job health is derived from result and freshness", () => {
  const now = new Date("2026-08-24T12:00:00Z")

  assert.equal(deriveAdminJobStatus(definition, null, now), "unknown")
  assert.equal(
    deriveAdminJobStatus(definition, { status: "failed", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now),
    "failing",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "running", startedAt: "2026-08-24T11:50:00Z", finishedAt: null }, now),
    "stale",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "running", startedAt: "2026-08-24T11:58:00Z", finishedAt: null }, now),
    "in_progress",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "queued", startedAt: null, finishedAt: null }, now),
    "in_progress",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "skipped", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now),
    "degraded",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "succeeded", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now),
    "healthy",
  )
  assert.equal(
    deriveAdminJobStatus(definition, { status: "succeeded", startedAt: "2026-08-20T10:00:00Z", finishedAt: "2026-08-20T10:01:00Z" }, now),
    "stale",
  )
})

test("buildAdminJobViews aggregates catalog jobs with latest runs and calculates counts", () => {
  const now = new Date("2026-08-24T12:00:00Z")
  const { jobs, counts } = buildAdminJobViews(
    [definition, { ...definition, key: "signals.daily", freshnessMinutes: 120 }],
    [
      {
        id: "run-1",
        job_key: "wyckoff.ingest",
        trigger: "cron",
        status: "succeeded",
        started_at: "2026-08-24T11:00:00Z",
        finished_at: "2026-08-24T11:01:00Z",
      },
    ],
    [],
    now,
  )

  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].key, "wyckoff.ingest")
  assert.equal(jobs[0].status, "healthy")
  assert.equal(jobs[1].key, "signals.daily")
  assert.equal(jobs[1].status, "unknown")
  assert.equal(counts.total, 2)
  assert.equal(counts.healthy, 1)
  assert.equal(counts.unknown, 1)
  assert.equal(counts.failing, 0)
})

test("Admin Jobs models the notion-unified-v2 EOD chain as one parent job", () => {
  const pipeline = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(pipeline)
  assert.equal(pipeline.provider, "supabase_pg_cron_workflow")
  assert.equal(pipeline.scheduleUtc, "15 8 * * 1-5")
  assert.equal(pipeline.scheduleIct, "15:15 T2-T6")
  assert.equal(pipeline.group, "system")
  assert.equal(pipeline.manualPolicy, "disabled")

  for (const legacyKey of ["ai_council.eod", "ai_council.daily", "ai_council.debate_daily", "wyckoff.ingest"]) {
    assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.some((job) => job.key === legacyKey), false, `${legacyKey} must not appear as an independent production job`)
  }
})

test("EOD phase model preserves canonical dependency order and fills missing phases as pending", async () => {
  const { buildAdminJobPhaseTimeline } = await import("../lib/admin/job-phases.ts")
  const timeline = buildAdminJobPhaseTimeline([
    {
      id: "phase-1",
      run_id: "run-1",
      job_key: "qeoindex.eod_pipeline",
      phase_key: "EOD_READY",
      phase_order: 1,
      status: "succeeded",
      started_at: "2026-08-25T08:15:00.000Z",
      finished_at: "2026-08-25T08:15:12.000Z",
      duration_ms: 12_000,
      summary: { sessionDate: "2026-08-25" },
      error_code: null,
      error_message: null,
    },
  ])

  assert.deepEqual(timeline.map((phase) => phase.key), [
    "EOD_READY",
    "MARKET_CLOSE_COLLECT",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "NOTION_STAGING",
    "NOTION_VALIDATE",
    "INGEST",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "AI_COUNCIL_LLM",
    "COMPLETE",
  ])
  assert.equal(timeline[0].status, "succeeded")
  assert.equal(timeline[1].status, "pending")
  assert.deepEqual(timeline[0].summary, { sessionDate: "2026-08-25" })
})

test("AI Council EOD workflow records system_job_runs telemetry for Admin Jobs", () => {
  const steps = readFileSync(new URL("../lib/ai-council-eod-workflow-steps.ts", import.meta.url), "utf8")
  const workflow = readFileSync(new URL("../workflows/ai-council-eod-workflow.ts", import.meta.url), "utf8")

  assert.match(steps, /AI_COUNCIL_EOD_JOB_KEY = "ai_council\.eod"/)
  assert.match(steps, /from\("system_job_runs"\)/)
  assert.match(steps, /startAiCouncilEodTelemetryStep/)
  assert.match(steps, /finishAiCouncilEodTelemetryStep/)
  assert.match(workflow, /startAiCouncilEodTelemetryStep/)
  assert.match(workflow, /finishAiCouncilEodTelemetryStep/)
})

test("QeoIndex idempotent no-op after an already completed session stays healthy", () => {
  const pipeline = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(pipeline)
  const { jobs } = buildAdminJobViews(
    [pipeline],
    [{
      id: "run-noop",
      job_key: "qeoindex.eod_pipeline",
      trigger: "cron",
      status: "skipped",
      started_at: "2026-08-27T10:53:08.068Z",
      finished_at: "2026-08-27T10:54:18.430Z",
      summary: {
        scanDate: "2026-08-27",
        notionAction: "stop",
        marketCloseStatus: "succeeded",
        publishStatus: "skipped",
      },
    }],
    [],
    new Date("2026-08-27T13:30:00Z"),
  )

  assert.equal(jobs[0].status, "healthy")
  assert.match(jobs[0].healthReason || "", /no-op|đã hoàn tất/i)
  assert.equal(jobs[0].lastDurationMs, 70_362)
})

test("Daily Signals reports partial scanner quality as degraded and allows an all-session duration", () => {
  const signals = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "signals.daily")
  assert.ok(signals)
  assert.ok(signals.maxDurationMinutes >= 8 * 60)

  const { jobs } = buildAdminJobViews(
    [signals],
    [{
      id: "signals-run",
      job_key: "signals.daily",
      trigger: "cron",
      status: "succeeded",
      started_at: "2026-08-27T00:46:50.381Z",
      finished_at: "2026-08-27T07:45:32.068Z",
      duration_ms: 25_121_687,
      summary: { scanner: { completed: 49, skipped: 0, errors: 1 } },
    }],
    [],
    new Date("2026-08-27T13:30:00Z"),
  )

  assert.equal(jobs[0].status, "degraded")
  assert.match(jobs[0].healthReason || "", /49\/50|1 lỗi/i)
})

test("EOD and Signals expose quality separately from terminal execution", () => {
  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  const signals = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "signals.daily")
  assert.ok(eod && signals)
  const eodView = buildAdminJobViews([eod], [{
    id: "eod-partial", job_key: eod.key, trigger: "workflow", status: "succeeded",
    started_at: "2026-08-31T08:15:00.000Z", finished_at: "2026-08-31T09:00:00.000Z",
    summary: { build: { total: 500, complete: 383, incomplete: 117 }, validation: { total: 500, complete: 383, incomplete: 117 }, history: { limitedCoverageCount: 26 } },
  }], [], new Date("2026-08-31T10:00:00.000Z"))
  assert.equal(eodView.jobs[0].status, "degraded")
  assert.equal((eodView.jobs[0].domainEvidence?.quality as { status: string }).status, "partial_by_reported_counts")
  const signalView = buildAdminJobViews([signals], [{
    id: "signals-issues", job_key: signals.key, trigger: "workflow", status: "succeeded",
    started_at: "2026-08-31T00:00:00.000Z", finished_at: "2026-08-31T07:30:00.000Z",
    summary: { scanner: { completed: 49, skipped: 0, errors: 1 } },
  }], [], new Date("2026-08-31T08:00:00.000Z"))
  assert.equal(signalView.jobs[0].status, "degraded")
  assert.equal((signalView.jobs[0].domainEvidence?.quality as { status: string }).status, "reported_issues")
})

test("Market 5-minute row uses the latest scheduler invocation rather than the 14:45 EOD snapshot timestamp", () => {
  const market5m = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  assert.ok(market5m)
  const raw = {
    systemJobRuns: [],
    cronSnapshots: [
      { jobId: 10, jobName: "sync-universe-5m", schedule: "*/5 2-6 * * 1-5", active: true, lastStatus: "succeeded", lastStartedAt: "2026-08-27T06:55:00.299Z", lastFinishedAt: "2026-08-27T06:55:00.333Z" },
      { jobId: 11, jobName: "sync-universe-5m-afternoon", schedule: "0,5,10,15,20,25,30,35,40 7 * * 1-5", active: true, lastStatus: "succeeded", lastStartedAt: "2026-08-27T07:40:00.297Z", lastFinishedAt: "2026-08-27T07:40:00.331Z" },
      { jobId: 12, jobName: "sync-universe-eod-1445", schedule: "45 7 * * 1-5", active: true, lastStatus: "succeeded", lastStartedAt: "2026-08-27T07:45:00.280Z", lastFinishedAt: "2026-08-27T07:45:00.297Z" },
    ],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: { latestSessionDate: "2026-08-27", totalSnapshots: 100, latestUpdatedAt: "2026-08-27T07:45:06.000Z" },
  }
  const { jobs } = buildAdminJobViews([market5m], raw, [], new Date("2026-08-27T13:30:00Z"))
  assert.equal(jobs[0].lastStartedAt, "2026-08-27T07:40:00.297Z")
})

test("KFSP TTAI Admin catalog matches the active 07:10 ICT production scheduler", () => {
  const ttai = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "kfsp.ttai_history")
  assert.ok(ttai)
  assert.equal(ttai.scheduleUtc, "10 0 * * *")
  assert.equal(ttai.scheduleIct, "07:10 hàng ngày")
  assert.equal(ttai.schedulerName, "kfsp-ttai-history-daily-0710-ict")
  assert.equal(getPgCronNameForJobKey("kfsp.ttai_history"), "kfsp-ttai-history-daily-0710-ict")
})

test("Admin AI usage aggregates actual response models and token consumption by session", async () => {
  const helperUrl = new URL("../lib/admin/job-ai-usage.ts", import.meta.url)
  assert.equal(existsSync(helperUrl), true, "Admin AI usage aggregation helper must exist")
  if (!existsSync(helperUrl)) return

  const { aggregateAiCouncilUsage } = await import(helperUrl.href)
  const usage = aggregateAiCouncilUsage([
    {
      as_of_date: "2026-08-27",
      ticker: "TCH",
      call_audit: [
        { responseModel: "gpt-5.6-luna" },
        { responseModel: "gpt-5.6-terra" },
        { responseModel: "gpt-5.6-sol" },
      ],
      input_tokens: 80,
      output_tokens: 20,
      total_tokens: 100,
      cached_input_tokens: 5,
      reasoning_tokens: 7,
      estimated_cost_usd: "0.10",
    },
    {
      as_of_date: "2026-08-27",
      ticker: "VHM",
      call_audit: [{ responseModel: "gpt-5.6-luna" }, { responseModel: "gpt-5.6-terra" }],
      input_tokens: 160,
      output_tokens: 40,
      total_tokens: 200,
      cached_input_tokens: 0,
      reasoning_tokens: 8,
      estimated_cost_usd: "0.20",
    },
  ])

  assert.deepEqual(usage["2026-08-27"], {
    asOfDate: "2026-08-27",
    debates: 2,
    inputTokens: 240,
    outputTokens: 60,
    totalTokens: 300,
    cachedInputTokens: 5,
    reasoningTokens: 15,
    estimatedCostUsd: 0.3,
    models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  })
})
