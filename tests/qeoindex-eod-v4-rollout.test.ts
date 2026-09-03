import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import {
  EXPECTED_SUPABASE_SCHEDULERS,
  reconcileSupabaseSchedulers,
} from "../lib/admin/scheduler-reconciliation.ts"
import {
  getJobKeyForPgCron,
  getPgCronNameForJobKey,
} from "../lib/admin/job-schedule.ts"

const RETIRED_ACTIVE_SCHEDULERS = [
  ["kfsp.rating_daily", "kfsp-rating-daily-7am-ict"],
  ["kfsp.ttai_history", "kfsp-ttai-history-daily-0710-ict"],
  ["market.sync_eod", "sync-universe-eod-1445"],
] as const

function migrationSource() {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url)
  const matches = readdirSync(migrationsDir).filter((name) =>
    name.endsWith("_qeo64_eod_v4_scheduler_cutover.sql"),
  )
  assert.equal(matches.length, 1, "expected exactly one QEO-64 scheduler-cutover migration")
  if (matches.length !== 1) return null
  return readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), "utf8")
}

test("QEO-64 reclassifies standalone EOD freshness jobs as manual recovery after cutover", () => {
  for (const [jobKey] of RETIRED_ACTIVE_SCHEDULERS) {
    const job = EFFECTIVE_ADMIN_JOB_CATALOG.find((candidate) => candidate.key === jobKey)
    assert.ok(job, `${jobKey} must remain visible for historical evidence and manual recovery`)
    assert.equal(job.scheduleKind, "manual", `${jobKey} must no longer own a production schedule`)
    assert.equal(job.scheduleUtc, undefined)
    assert.equal(job.scheduleIct, undefined)
    assert.equal(job.schedulerName, undefined)
    assert.equal(job.manualPolicy, "confirm")
    assert.equal(job.manualPurpose, "recovery")
    assert.equal(job.schedulePolicy?.kind, "manual")
  }

  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind === "manual").length, 9)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind !== "manual").length, 3)
})

test("QEO-64 preserves retired pg_cron aliases for v3 telemetry but removes forward scheduler ownership", () => {
  for (const [jobKey, schedulerName] of RETIRED_ACTIVE_SCHEDULERS) {
    assert.equal(getJobKeyForPgCron(schedulerName), jobKey, `${schedulerName} must remain readable as historical evidence`)
    assert.equal(getPgCronNameForJobKey(jobKey), undefined, `${jobKey} must not advertise an active pg_cron owner`)
  }

  assert.equal(getJobKeyForPgCron("kfsp-ttai-history-daily-1am-ict"), "kfsp.ttai_history")
  assert.equal(getJobKeyForPgCron("sync-universe-eod-1450"), "market.sync_eod")
})

test("QEO-64 scheduler reconciliation expects only canonical EOD plus intraday AM/PM Supabase schedules", () => {
  assert.deepEqual(
    EXPECTED_SUPABASE_SCHEDULERS.map((mapping) => mapping.schedulerName),
    [
      "qeoindex-eod-pipeline-1515-ict",
      "sync-universe-5m",
      "sync-universe-5m-afternoon",
    ],
  )

  const rows = EXPECTED_SUPABASE_SCHEDULERS.map((mapping, index) => ({
    jobId: index + 1,
    jobName: mapping.schedulerName,
    schedule: mapping.schedule,
    active: true,
    lastStatus: "succeeded",
    lastStartedAt: null,
    lastFinishedAt: null,
  }))
  const reconciled = reconcileSupabaseSchedulers({ availability: "available", rows })
  assert.equal(reconciled.aggregate.expected, 4, "three Supabase schedules + one Vercel config-only schedule")
  assert.equal(reconciled.aggregate.liveVerified, 3)
  assert.equal(reconciled.aggregate.missing, 0)
  assert.equal(reconciled.aggregate.inventoryClean, true)
  assert.equal(reconciled.aggregate.expectedMappingsVerified, true)
  assert.deepEqual(
    reconciled.logical.map((mapping) => mapping.jobKey),
    ["qeoindex.eod_pipeline", "market.sync_5m", "signals.daily"],
  )
})

test("QEO-64 migration retires standalone freshness schedulers and reasserts one canonical EOD owner", () => {
  const sql = migrationSource()
  if (!sql) return

  for (const schedulerName of [
    "kfsp-rating-daily-7am-ict",
    "kfsp-ttai-history-daily-1am-ict",
    "kfsp-ttai-history-daily-0710-ict",
    "kfsp-ttai-history-hourly",
    "sync-universe-eod-1445",
    "sync-universe-eod-1450",
  ]) {
    assert.match(sql, new RegExp(`cron\\.unschedule\\('${schedulerName}'\\)`), `${schedulerName} must be retired idempotently`)
  }

  assert.match(sql, /cron\.unschedule\('qeoindex-eod-pipeline-1515-ict'\)/)
  assert.match(sql, /cron\.schedule\([\s\S]*'qeoindex-eod-pipeline-1515-ict'[\s\S]*'15 8 \* \* 1-5'/)
  assert.doesNotMatch(sql, /cron\.unschedule\('sync-universe-5m'\)/)
  assert.doesNotMatch(sql, /cron\.unschedule\('sync-universe-5m-afternoon'\)/)
})
