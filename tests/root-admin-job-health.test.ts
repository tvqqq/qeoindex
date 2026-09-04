import assert from "node:assert/strict"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import type { AdminJobDefinition } from "../lib/admin/types.ts"
import { buildAdminJobViews, deriveAdminJobStatus } from "../lib/admin/job-health.ts"
import { deriveScheduleDueState, resolveJobEvidence } from "../lib/admin/job-evidence.ts"
import { interpretEodQuality, interpretRatingQuality, interpretSignalsDailyQuality, interpretTtaiQuality } from "../lib/admin/job-quality.ts"

test("quality interpreters preserve reported scalar counts and honest unknowns", () => {
  assert.equal(interpretEodQuality({ total: 500, complete: 383, incomplete: 117, validationAgreement: true, limitedCoverageCount: 26 }).status, "partial_by_reported_counts")
  assert.equal(interpretEodQuality({ total: 500, complete: 400, incomplete: 100, validationAgreement: false }).status, "inconsistent")
  assert.equal(interpretEodQuality({ total: 0, complete: 0, incomplete: 0, validationAgreement: true }).status, "empty")
  assert.equal(interpretEodQuality({ total: 500, complete: 383, incomplete: 117 }).status, "unknown")
  assert.equal(interpretSignalsDailyQuality({ completed: 49, errors: 1, skipped: 0 }).status, "reported_issues")
  assert.equal(interpretRatingQuality({ staged: 100, published: 99 }).status, "partial_by_reported_counts")
  assert.equal(interpretTtaiQuality({ candidates: 12, processed: 11, failed: 1 }).status, "reported_issues")
})

const definition: AdminJobDefinition = {
  key: "test.manual",
  provider: "machine",
  label: "Test Manual",
  description: "Test job",
  group: "system",
  scheduleKind: "manual",
  manualPolicy: "confirm",
  freshnessMinutes: 120,
  maxDurationMinutes: 5,
}

test("canonical EOD v4 schedule is weekday 15:15 ICT and respects due state", () => {
  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(eod?.schedulePolicy)
  assert.equal(eod.scheduleUtc, "15 8 * * 1-5")
  assert.equal(eod.scheduleIct, "15:15 T2-T6")

  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-30T08:30:00.000Z")), "not_due")
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-31T08:00:00.000Z")), "not_due")
  assert.equal(deriveScheduleDueState(eod.schedulePolicy, null, new Date("2026-08-31T08:20:00.000Z")), "due")
})

test("current execution remains separate from prior terminal evidence", () => {
  const signals = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "signals.daily")
  assert.ok(signals)
  const resolved = resolveJobEvidence(signals, {
    systemJobRuns: [
      { id: "current", job_key: signals.key, trigger: "workflow", status: "running", started_at: "2026-08-31T00:28:00.000Z", finished_at: null },
      { id: "prior", job_key: signals.key, trigger: "workflow", status: "succeeded", started_at: "2026-08-28T00:28:00.000Z", finished_at: "2026-08-28T07:30:00.000Z" },
    ],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: null,
  }, new Date("2026-08-31T03:52:00.000Z"))

  assert.equal(resolved.executionStatus, "in_progress")
  assert.equal(resolved.currentExecution?.runId, "current")
  assert.equal(resolved.lastTerminalExecution?.runId, "prior")
})

test("intraday market domain health can stay healthy when execution telemetry is unavailable", () => {
  const market = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  assert.ok(market)
  const resolved = resolveJobEvidence(market, {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: { latestSessionDate: "2026-08-31", totalSnapshots: 100, latestUpdatedAt: "2026-08-31T03:52:00.000Z" },
  }, new Date("2026-08-31T03:52:00.000Z"))

  assert.equal(resolved.executionStatus, "healthy")
  assert.equal(resolved.domainEvidence?.totalSnapshots, 100)
  assert.equal(resolved.executionTelemetry?.source, "unavailable")
})

test("basic job health is derived from terminal state, runtime and freshness", () => {
  const now = new Date("2026-08-24T12:00:00Z")
  assert.equal(deriveAdminJobStatus(definition, null, now), "unknown")
  assert.equal(deriveAdminJobStatus(definition, { status: "failed", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now), "failing")
  assert.equal(deriveAdminJobStatus(definition, { status: "running", startedAt: "2026-08-24T11:50:00Z", finishedAt: null }, now), "stale")
  assert.equal(deriveAdminJobStatus(definition, { status: "running", startedAt: "2026-08-24T11:58:00Z", finishedAt: null }, now), "in_progress")
  assert.equal(deriveAdminJobStatus(definition, { status: "skipped", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now), "degraded")
  assert.equal(deriveAdminJobStatus(definition, { status: "succeeded", startedAt: "2026-08-24T11:00:00Z", finishedAt: "2026-08-24T11:01:00Z" }, now), "healthy")
})

test("buildAdminJobViews aggregates current catalog jobs and counts", () => {
  const now = new Date("2026-08-24T12:00:00Z")
  const { jobs, counts } = buildAdminJobViews(
    [definition, { ...definition, key: "test.second" }],
    [{ id: "run-1", job_key: definition.key, trigger: "manual", status: "succeeded", started_at: "2026-08-24T11:00:00Z", finished_at: "2026-08-24T11:01:00Z" }],
    [],
    now,
  )

  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].status, "healthy")
  assert.equal(jobs[1].status, "unknown")
  assert.equal(counts.total, 2)
  assert.equal(counts.healthy, 1)
  assert.equal(counts.unknown, 1)
})

test("effective admin catalog has one EOD v4 owner and recovery-only legacy children", () => {
  const pipeline = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(pipeline)
  assert.equal(pipeline.provider, "supabase_pg_cron_workflow")
  assert.equal(pipeline.manualPolicy, "disabled")
  assert.match(pipeline.description, /Canonical EOD v4 owner/)

  for (const key of ["kfsp.rating_daily", "kfsp.ttai_history"]) {
    const job = EFFECTIVE_ADMIN_JOB_CATALOG.find((candidate) => candidate.key === key)
    assert.ok(job)
    assert.equal(job.scheduleKind, "manual")
    assert.equal(job.scheduleUtc, undefined)
    assert.equal(job.schedulerName, undefined)
    assert.equal(job.manualPolicy, "confirm")
    assert.equal(job.manualPurpose, "recovery")
    assert.deepEqual(job.automatedParentKeys, ["qeoindex.eod_pipeline"])
  }

  const retiredMarketEod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_eod")
  assert.ok(retiredMarketEod)
  assert.equal(retiredMarketEod.scheduleKind, "manual")
  assert.equal(retiredMarketEod.manualPolicy, "disabled")
  assert.equal(retiredMarketEod.manualPurpose, "maintenance")
  assert.equal(retiredMarketEod.scheduleUtc, undefined)

  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.some((job) => job.key === "ai_council.daily"), false)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.some((job) => job.key === "ai_council.debate_daily"), false)

  const ingest = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "wyckoff.ingest")
  assert.ok(ingest)
  assert.equal(ingest.scheduleKind, "manual")
  assert.equal(ingest.manualPurpose, "maintenance")
})
