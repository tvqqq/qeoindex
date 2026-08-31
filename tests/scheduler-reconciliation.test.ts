import assert from "node:assert/strict"
import test from "node:test"

import { EXPECTED_SUPABASE_SCHEDULERS, reconcileSupabaseSchedulers, reconcileVercelSchedulers, type SchedulerEvidence } from "../lib/admin/scheduler-reconciliation.ts"
import { buildAdminJobViews } from "../lib/admin/job-health.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"

const rows = EXPECTED_SUPABASE_SCHEDULERS.map((mapping, index) => ({ jobId: index + 1, jobName: mapping.schedulerName, schedule: mapping.schedule, active: true, lastStatus: "succeeded", lastStartedAt: null, lastFinishedAt: null }))

test("six exact Supabase physical mappings are live verified and market windows are both required", () => {
  const result = reconcileSupabaseSchedulers({ availability: "available", rows })
  assert.equal(result.aggregate.expected, 7)
  assert.equal(result.physicalMappings.length, 7)
  assert.equal(result.aggregate.liveVerified, 6)
  assert.equal(result.aggregate.expectedMappingsVerified, true)
  assert.equal(result.aggregate.inventoryClean, true)
  assert.deepEqual(result.mappings.filter((mapping) => mapping.jobKey === "market.sync_5m").map((mapping) => mapping.mappingId), ["supabase:sync-universe-5m-am", "supabase:sync-universe-5m-pm"])
  assert.deepEqual(result.logical.find((mapping) => mapping.jobKey === "market.sync_5m")?.childMappingIds, ["supabase:sync-universe-5m-am", "supabase:sync-universe-5m-pm"])
})

test("PM mapping keeps exact-string semantics while normalizing only whitespace", () => {
  const expected = EXPECTED_SUPABASE_SCHEDULERS.find((mapping) => mapping.mappingId === "supabase:sync-universe-5m-pm")!
  const whitespaceVariant = rows.map((row) => row.jobName === expected.schedulerName ? { ...row, schedule: `  ${expected.schedule.replaceAll(" ", "   ")}  ` } : row)
  assert.equal(reconcileSupabaseSchedulers({ availability: "available", rows: whitespaceVariant }).mappings.find((m) => m.mappingId === expected.mappingId)?.status, "live_verified")
  const stepForm = rows.map((row) => row.jobName === expected.schedulerName ? { ...row, schedule: "0-40/5 7 * * 1-5" } : row)
  assert.equal(reconcileSupabaseSchedulers({ availability: "available", rows: stepForm }).mappings.find((m) => m.mappingId === expected.mappingId)?.status, "drifted")
})

test("scheduler reconciliation reports missing window, drift, inactive, duplicate, alias and extra", () => {
  const evidence: SchedulerEvidence = { availability: "available", rows: [
    ...rows.filter((row) => !["sync-universe-5m-afternoon", "kfsp-rating-daily-7am-ict", "sync-universe-eod-1445", "qeoindex-eod-pipeline-1515-ict", "kfsp-ttai-history-daily-0710-ict"].includes(row.jobName)),
    { ...rows[0], jobId: 99 },
    { ...rows[0], jobId: 100 },
    { ...rows.find((row) => row.jobName === "kfsp-rating-daily-7am-ict")!, schedule: "1 0 * * *" },
    { ...rows.find((row) => row.jobName === "sync-universe-eod-1445")!, active: false },
    { jobId: 77, jobName: "kfsp-ttai-history-daily-1am-ict", schedule: "0 1 * * *", active: true, lastStatus: null, lastStartedAt: null, lastFinishedAt: null },
    { jobId: 78, jobName: "retired-job", schedule: "* * * * *", active: true, lastStatus: null, lastStartedAt: null, lastFinishedAt: null },
  ] }
  const result = reconcileSupabaseSchedulers(evidence)
  assert.equal(result.mappings.find((m) => m.schedulerName === "sync-universe-5m-afternoon")?.status, "missing")
  assert.equal(result.mappings.find((m) => m.schedulerName === "kfsp-rating-daily-7am-ict")?.status, "drifted")
  assert.equal(result.mappings.find((m) => m.schedulerName === "sync-universe-eod-1445")?.status, "inactive")
  assert.equal(result.mappings.find((m) => m.schedulerName === "qeoindex-eod-pipeline-1515-ict")?.status, "duplicated")
  assert.equal(result.mappings.find((m) => m.schedulerName === "kfsp-ttai-history-daily-0710-ict")?.status, "legacy_alias")
  assert.equal(result.logical.find((m) => m.jobKey === "market.sync_5m")?.status, "partial")
  assert.deepEqual(result.extraUnmapped, ["retired-job"])
  assert.equal(result.aggregate.inventoryClean, false)
})

test("empty and unavailable scheduler evidence stay distinct and never infer execution", () => {
  const empty = reconcileSupabaseSchedulers({ availability: "available", rows: [] })
  assert.equal(empty.aggregate.missing, 6)
  assert.equal(empty.aggregate.unavailable, 0)
  const unavailable = reconcileSupabaseSchedulers({ availability: "unavailable", reason: "rpc_error" })
  assert.equal(unavailable.aggregate.unavailable, 6)
  assert.equal(unavailable.aggregate.missing, 0)
  const now = new Date()
  const views = buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, { systemJobRuns: [{ id: "dispatch", job_key: "scanner.run", trigger: "external", status: "running", started_at: new Date(now.getTime() - 60_000).toISOString() }], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [], orderbookStats: null, schedulerReconciliation: unavailable }, [], now)
  assert.equal(views.jobs.find((job) => job.key === "scanner.run")?.executionStatus, "in_progress")
  assert.equal(views.jobs.find((job) => job.key === "qeoindex.eod_pipeline")?.schedulerEvidence?.availability, "unavailable")
})

test("Vercel scheduler is configuration-only and never live verified by Supabase rows", () => {
  const result = buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, { systemJobRuns: [], cronSnapshots: [], kfspRatingRuns: [], kfspTtaiRuns: [], orderbookStats: null, schedulerReconciliation: reconcileSupabaseSchedulers({ availability: "available", rows }) })
  const signals = result.jobs.find((job) => job.key === "signals.daily")!
  assert.equal(signals.schedulerEvidence?.status, "config_only")
})

test("Vercel reconciliation compares exact deployed path and cron without claiming live activity", () => {
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "0 0 * * 1-5" }]).status, "config_only")
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "5 0 * * 1-5" }]).status, "drifted")
  assert.equal(reconcileVercelSchedulers([]).status, "missing")
  assert.equal(reconcileVercelSchedulers([{ path: "/api/signals/daily", schedule: "0 0 * * 1-5" }, { path: "/api/signals/daily", schedule: "0 0 * * 1-5" }]).status, "duplicated")
})
