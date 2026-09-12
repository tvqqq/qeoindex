import assert from "node:assert/strict"
import test from "node:test"

import { EXPECTED_SUPABASE_SCHEDULERS, reconcileSupabaseSchedulers, reconcileVercelSchedulers, type SchedulerEvidence } from "../modules/admin/scheduler-reconciliation.ts"
import { buildAdminJobViews } from "../modules/admin/job-health.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../modules/admin/effective-job-catalog.ts"

const rows = EXPECTED_SUPABASE_SCHEDULERS.map((mapping, index) => ({ jobId: index + 1, jobName: mapping.schedulerName, schedule: mapping.schedule, active: true, lastStatus: "succeeded", lastStartedAt: null, lastFinishedAt: null }))

test("four exact Supabase physical mappings remain live verified after QEO-197 moves EOD ownership to UpCloud", () => {
  const result = reconcileSupabaseSchedulers({ availability: "available", rows })
  assert.equal(result.aggregate.expected, 5)
  assert.equal(result.physicalMappings.length, 5)
  assert.equal(result.aggregate.liveVerified, 4)
  assert.equal(result.aggregate.expectedMappingsVerified, true)
  assert.equal(result.aggregate.inventoryClean, true)
  assert.deepEqual(result.mappings.filter((mapping) => mapping.jobKey === "market.sync_5m").map((mapping) => mapping.mappingId), ["supabase:sync-universe-5m-am", "supabase:sync-universe-5m-pm"])
  assert.deepEqual(result.logical.find((mapping) => mapping.jobKey === "market.sync_5m")?.childMappingIds, ["supabase:sync-universe-5m-am", "supabase:sync-universe-5m-pm"])
  assert.equal(result.logical.find((mapping) => mapping.jobKey === "qeoindex.chart_intraday_maintenance")?.status, "live_verified")
  assert.equal(result.logical.find((mapping) => mapping.jobKey === "research_reports.daily")?.status, "live_verified")
  assert.equal(result.logical.some((mapping) => mapping.jobKey === "kfsp.rating_daily"), false)
  assert.equal(result.logical.some((mapping) => mapping.jobKey === "kfsp.ttai_history"), false)
  assert.equal(result.logical.some((mapping) => mapping.jobKey === "market.sync_eod"), false)
})

test("PM mapping keeps exact-string semantics while normalizing only whitespace", () => {
  const expected = EXPECTED_SUPABASE_SCHEDULERS.find((mapping) => mapping.mappingId === "supabase:sync-universe-5m-pm")!
  const whitespaceVariant = rows.map((row) => row.jobName === expected.schedulerName ? { ...row, schedule: `  ${expected.schedule.replaceAll(" ", "   ")}  ` } : row)
  assert.equal(reconcileSupabaseSchedulers({ availability: "available", rows: whitespaceVariant }).mappings.find((m) => m.mappingId === expected.mappingId)?.status, "live_verified")
  const stepForm = rows.map((row) => row.jobName === expected.schedulerName ? { ...row, schedule: "0-40/5 7 * * 1-5" } : row)
  assert.equal(reconcileSupabaseSchedulers({ availability: "available", rows: stepForm }).mappings.find((m) => m.mappingId === expected.mappingId)?.status, "drifted")
})

test("scheduler reconciliation flags an active legacy EOD owner but ignores the inactive rollback row", () => {
  const chartMaintenance = rows.find((row) => row.jobName === "qeoindex-chart-intraday-maintenance-1450-ict")!
  const research = rows.find((row) => row.jobName === "research-reports-daily-0705-ict")!
  const am = rows.find((row) => row.jobName === "sync-universe-5m")!
  const pm = rows.find((row) => row.jobName === "sync-universe-5m-afternoon")!
  const rollback = { jobId: 99, jobName: "qeoindex-eod-pipeline-1515-ict", schedule: "15 8 * * 1-5", active: false, lastStatus: "succeeded", lastStartedAt: null, lastFinishedAt: null }

  const clean = reconcileSupabaseSchedulers({ availability: "available", rows: [chartMaintenance, research, am, pm, rollback] })
  assert.deepEqual(clean.extraUnmapped, [])
  assert.equal(clean.aggregate.inventoryClean, true)

  const duplicateOwner = reconcileSupabaseSchedulers({ availability: "available", rows: [chartMaintenance, research, am, pm, { ...rollback, active: true }] })
  assert.deepEqual(duplicateOwner.extraUnmapped, ["qeoindex-eod-pipeline-1515-ict"])
  assert.equal(duplicateOwner.aggregate.inventoryClean, false)
})

test("empty and unavailable scheduler evidence stay distinct and never infer execution", () => {
  const empty = reconcileSupabaseSchedulers({ availability: "available", rows: [] })
  assert.equal(empty.aggregate.missing, 4)
  assert.equal(empty.aggregate.unavailable, 0)
  const unavailable = reconcileSupabaseSchedulers({ availability: "unavailable", reason: "rpc_error" })
  assert.equal(unavailable.aggregate.unavailable, 4)
  assert.equal(unavailable.aggregate.missing, 0)
  const now = new Date()
  const views = buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, { systemJobRuns: [{ id: "dispatch", job_key: "scanner.run", trigger: "external", status: "running", started_at: new Date(now.getTime() - 60_000).toISOString() }], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [], orderbookStats: null, schedulerReconciliation: unavailable }, [], now)
  assert.equal(views.jobs.find((job) => job.key === "scanner.run")?.executionStatus, "in_progress")
  assert.equal(views.jobs.find((job) => job.key === "qeoindex.eod_pipeline")?.schedulerEvidence?.availability, "unavailable")
  assert.equal(views.jobs.find((job) => job.key === "qeoindex.chart_intraday_maintenance")?.schedulerEvidence?.availability, "unavailable")
})

test("Vercel scheduler is configuration-only and never live verified by Supabase rows", () => {
  const result = buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, { systemJobRuns: [], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [], orderbookStats: null, schedulerReconciliation: reconcileSupabaseSchedulers({ availability: "available", rows }) })
  const signals = result.jobs.find((job) => job.key === "signals.daily")!
  assert.equal(signals.schedulerEvidence?.status, "config_only")
  const eod = result.jobs.find((job) => job.key === "qeoindex.eod_pipeline")!
  assert.equal(eod.schedulerEvidence?.status, "config_only")
  assert.equal(eod.schedulerStatus, "unknown")
})

test("Vercel reconciliation compares exact deployed path and cron without claiming live activity", () => {
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "0 0 * * 1-5" }]).status, "config_only")
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "5 0 * * 1-5" }]).status, "drifted")
  assert.equal(reconcileVercelSchedulers([]).status, "missing")
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "0 0 * * 1-5" }, { path: "/api/signals/daily", schedule: "0 0 * * 1-5" }]).status, "duplicated")
})
