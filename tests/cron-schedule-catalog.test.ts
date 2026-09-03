import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { ADMIN_JOB_CATALOG } from "../lib/admin/catalog.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import {
  findScheduleConflicts,
  getJobTimelineLane,
  getPgCronNameForJobKey,
  isValidSchedulePolicy,
} from "../lib/admin/job-schedule.ts"

const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>
}

function cronForPath(path: string) {
  return vercelConfig.crons?.find((cron) => cron.path === path)?.schedule ?? null
}

test("catalog matches vercel.json cron schedules exactly", () => {
  const signals = ADMIN_JOB_CATALOG.find((job) => job.key === "signals.daily")
  assert.ok(signals)
  assert.equal(signals.scheduleUtc, cronForPath("/api/signals/daily"))
})

test("catalog matches Supabase pg_cron migrations exactly", () => {
  const jobs = new Map(ADMIN_JOB_CATALOG.map((job) => [job.key, job]))
  assert.equal(jobs.get("market.sync_5m")?.schedulerName, "sync-universe-5m")
  assert.equal(jobs.get("market.sync_eod")?.schedulerName, "sync-universe-eod-1445")
  assert.equal(jobs.get("market.sync_eod")?.scheduleUtc, "45 7 * * 1-5")
  assert.equal(jobs.get("kfsp.rating_daily")?.schedulerName, "kfsp-rating-daily-7am-ict")
  assert.equal(jobs.get("kfsp.rating_daily")?.scheduleUtc, "0 0 * * *")
  assert.equal(jobs.get("kfsp.ttai_history")?.schedulerName, "kfsp-ttai-history-daily-0710-ict")
  assert.equal(jobs.get("kfsp.ttai_history")?.scheduleUtc, "10 0 * * *")
})

test("exact pg_cron name mapping dictionary matches production", () => {
  assert.equal(getPgCronNameForJobKey("market.sync_5m"), "sync-universe-5m")
  assert.equal(getPgCronNameForJobKey("market.sync_eod"), "sync-universe-eod-1445")
  assert.equal(getPgCronNameForJobKey("kfsp.rating_daily"), "kfsp-rating-daily-7am-ict")
  assert.equal(getPgCronNameForJobKey("kfsp.ttai_history"), "kfsp-ttai-history-daily-0710-ict")
  assert.equal(getPgCronNameForJobKey("qeoindex.eod_pipeline"), "qeoindex-eod-pipeline-1515-ict")
  assert.equal(getPgCronNameForJobKey("scanner.run"), undefined)
})

test("manual jobs are distinguished from scheduled jobs", () => {
  const manualKeys = ["scanner.run", "signals.monitor", "market.sync_universe", "market.cache_invalidate", "wyckoff.run"]
  for (const key of manualKeys) {
    const def = ADMIN_JOB_CATALOG.find((job) => job.key === key)
    assert.ok(def, `Job ${key} must exist in catalog`)
    assert.equal(def.scheduleKind, "manual")
    assert.equal(getJobTimelineLane(def), "manual")
  }

  const scheduled = ["signals.daily", "market.sync_5m", "market.sync_eod", "kfsp.rating_daily", "kfsp.ttai_history"]
  for (const key of scheduled) {
    const def = ADMIN_JOB_CATALOG.find((job) => job.key === key)
    assert.ok(def, `Job ${key} must exist in catalog`)
    assert.notEqual(def.scheduleKind, "manual")
  }
})

test("resolves 14:45 non-overlapping schedule without conflicts", () => {
  const conflicts = findScheduleConflicts(ADMIN_JOB_CATALOG)
  assert.equal(conflicts.length, 0)
})

test("detects legacy 14:50 ICT overlap conflict when 5m runs past 14:40 and EOD is 14:50", () => {
  const legacyCatalog = [
    {
      key: "market.sync_5m",
      label: "Market 5-Minute Sync",
      provider: "supabase_pg_cron",
      windowStartIct: "09:00",
      windowEndIct: "14:55",
      scheduleUtc: "*/5 2-7 * * 1-5",
    },
    {
      key: "market.sync_eod",
      label: "Market EOD Sync",
      provider: "supabase_pg_cron",
      schedulerName: "sync-universe-eod-1450",
      scheduleUtc: "50 7 * * 1-5",
      windowStartIct: "14:50",
      windowEndIct: "14:50",
    },
  ] as unknown as Parameters<typeof findScheduleConflicts>[0]

  const conflicts = findScheduleConflicts(legacyCatalog)
  assert.equal(conflicts.length, 2)
  assert.equal(conflicts[0].timeIct, "14:50")
  assert.match(conflicts[0].reason, /14:50 ICT/)
})

test("effective catalog has complete structured ICT schedule policies", () => {
  assert.equal(new Set(EFFECTIVE_ADMIN_JOB_CATALOG.map((job) => job.key)).size, 12)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind === "manual").length, 6)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind !== "manual").length, 6)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => !isValidSchedulePolicy(job.schedulePolicy)).length, 0)

  const ingest = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "wyckoff.ingest")
  assert.equal(ingest?.schedulePolicy?.kind, "manual")
  assert.equal(ingest?.manualPolicy, "confirm")

  const ttai = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "kfsp.ttai_history")
  assert.equal(ttai?.schedulePolicy?.kind, "fixed_time")
  assert.equal((ttai?.schedulePolicy as { minuteOfDay: number }).minuteOfDay, 430)

  const market = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  const windows = (market?.schedulePolicy as { windows: Array<{ startMinuteOfDay: number; endMinuteOfDay: number; cadenceMinutes: number }> }).windows
  assert.deepEqual(windows, [
    { startMinuteOfDay: 540, endMinuteOfDay: 690, cadenceMinutes: 5 },
    { startMinuteOfDay: 780, endMinuteOfDay: 880, cadenceMinutes: 5 },
  ])
  assert.equal(isValidSchedulePolicy(undefined), false)
  assert.equal(isValidSchedulePolicy({ kind: "fixed_time", timezone: "UTC", cadence: "daily", minuteOfDay: 420, graceMinutes: 5 }), false)
})
