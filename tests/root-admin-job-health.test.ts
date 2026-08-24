import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import type { AdminJobDefinition } from "../lib/admin/types.ts"
import { buildAdminJobViews, deriveAdminJobStatus } from "../lib/admin/job-health.ts"

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
    "healthy",
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

test("Admin Jobs mirrors the single dependency-driven AI Council production cron", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>
  }
  const aiCouncilCrons = vercel.crons.filter((cron) => cron.path.startsWith("/api/ai-council/"))
  assert.deepEqual(aiCouncilCrons, [{ path: "/api/ai-council/eod", schedule: "0 10 * * 1-5" }])

  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "ai_council.eod")
  assert.ok(eod)
  assert.equal(eod.provider, "vercel_cron_workflow")
  assert.equal(eod.scheduleUtc, "0 10 * * 1-5")
  assert.equal(eod.scheduleIct, "17:00 T2-T6")
  assert.equal(eod.group, "ai_council")

  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.some((job) => job.key === "ai_council.daily"), false)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.some((job) => job.key === "ai_council.debate_daily"), false)

  const legacyWyckoff = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "wyckoff.ingest")
  assert.ok(legacyWyckoff)
  assert.equal(legacyWyckoff.provider, "machine")
  assert.equal(legacyWyckoff.scheduleUtc, undefined)
  assert.equal(legacyWyckoff.scheduleIct, undefined)
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
