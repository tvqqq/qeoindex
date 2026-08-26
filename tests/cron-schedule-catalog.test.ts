import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { ADMIN_JOB_CATALOG } from "../lib/admin/catalog.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import {
  findScheduleConflicts,
  getJobKeyForPgCron,
  getPgCronNameForJobKey,
  PG_CRON_NAME_TO_JOB_KEY,
} from "../lib/admin/job-schedule.ts"

function readJsonFile(path: string) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"))
}

function readTextFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("catalog matches vercel.json cron schedules exactly", () => {
  const vercel = readJsonFile("vercel.json")
  const crons = (vercel.crons || []) as Array<{ path: string; schedule: string }>

  const signalsCron = crons.find((c) => c.path === "/api/signals/daily")
  assert.ok(signalsCron, "vercel.json must define /api/signals/daily cron")
  assert.equal(signalsCron.schedule, "0 0 * * 1-5")

  const signalsDef = ADMIN_JOB_CATALOG.find((j) => j.key === "signals.daily")
  assert.ok(signalsDef)
  assert.equal(signalsDef.scheduleUtc, signalsCron.schedule)
  assert.equal(signalsDef.scheduleIct, "07:00 T2-T6")
  assert.equal(signalsDef.scheduleKind, "workflow")
  assert.equal(signalsDef.scheduleDays, "weekdays")
})

test("catalog matches Supabase pg_cron migrations exactly", () => {
  // 1. sync-universe-5m in 20260818195100_fix_cron_hours.sql
  const sync5mMigration = readTextFile("supabase/migrations/20260818195100_fix_cron_hours.sql")
  assert.match(sync5mMigration, /'sync-universe-5m'/)
  assert.match(sync5mMigration, /'\*\/5 2-7 \* \* 1-5'/)

  const sync5mDef = ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")
  assert.ok(sync5mDef)
  assert.equal(sync5mDef.schedulerName, "sync-universe-5m")
  assert.equal(sync5mDef.scheduleUtc, "*/5 2-7 * * 1-5")
  assert.equal(sync5mDef.scheduleKind, "interval")
  assert.equal(sync5mDef.windowStartIct, "09:00")
  assert.equal(sync5mDef.windowEndIct, "14:55")

  // 2. sync-universe-eod-1450 in 20260818194500_pg_cron_orderbook_sync.sql
  const syncEodMigration = readTextFile("supabase/migrations/20260818194500_pg_cron_orderbook_sync.sql")
  assert.match(syncEodMigration, /'sync-universe-eod-1450'/)
  assert.match(syncEodMigration, /'50 7 \* \* 1-5'/)

  const syncEodDef = ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_eod")
  assert.ok(syncEodDef)
  assert.equal(syncEodDef.schedulerName, "sync-universe-eod-1450")
  assert.equal(syncEodDef.scheduleUtc, "50 7 * * 1-5")
  assert.equal(syncEodDef.scheduleIct, "14:50 T2-T6")
  assert.equal(syncEodDef.scheduleKind, "point")

  // 3. kfsp-rating-daily-7am-ict in 20260822112420_kfsp_rating_pipeline.sql
  const kfspRatingMigration = readTextFile("supabase/migrations/20260822112420_kfsp_rating_pipeline.sql")
  assert.match(kfspRatingMigration, /'kfsp-rating-daily-7am-ict'/)
  assert.match(kfspRatingMigration, /'0 0 \* \* \*'/)

  const ratingDef = ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.rating_daily")
  assert.ok(ratingDef)
  assert.equal(ratingDef.schedulerName, "kfsp-rating-daily-7am-ict")
  assert.equal(ratingDef.scheduleUtc, "0 0 * * *")
  assert.equal(ratingDef.scheduleDays, "daily")
  assert.equal(ratingDef.scheduleKind, "point")

  // 4. TTAI history rescheduled to daily 01:00 ICT in the latest migration
  const ttaiMigration = readTextFile("supabase/migrations/20260826013742_reschedule_kfsp_ttai_daily_0100_ict.sql")
  assert.match(ttaiMigration, /cron\.unschedule\('kfsp-ttai-history-hourly'\)/)
  assert.match(ttaiMigration, /'kfsp-ttai-history-daily-1am-ict'/)
  assert.match(ttaiMigration, /'0 18 \* \* \*'/)

  const ttaiDef = ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.ttai_history")
  assert.ok(ttaiDef)
  assert.equal(ttaiDef.schedulerName, "kfsp-ttai-history-daily-1am-ict")
  assert.equal(ttaiDef.scheduleUtc, "0 18 * * *")
  assert.equal(ttaiDef.scheduleIct, "01:00 hàng ngày")
  assert.equal(ttaiDef.scheduleDays, "daily")
  assert.equal(ttaiDef.intervalMinutes, undefined)
  assert.equal(ttaiDef.scheduleKind, "point")

  // 5. qeoindex-eod-pipeline-1515-ict in 20260825174500_qeoindex_eod_pipeline_cron.sql
  const eodPipelineMigration = readTextFile("supabase/migrations/20260825174500_qeoindex_eod_pipeline_cron.sql")
  assert.match(eodPipelineMigration, /'qeoindex-eod-pipeline-1515-ict'/)
  assert.match(eodPipelineMigration, /'15 8 \* \* 1-5'/)

  const eodDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "qeoindex.eod_pipeline")
  assert.ok(eodDef)
  assert.equal(eodDef.schedulerName, "qeoindex-eod-pipeline-1515-ict")
  assert.equal(eodDef.scheduleUtc, "15 8 * * 1-5")
  assert.equal(eodDef.scheduleIct, "15:15 T2-T6")
  assert.equal(eodDef.scheduleKind, "workflow")
})

test("exact pg_cron name mapping dictionary matches production", () => {
  assert.deepEqual(PG_CRON_NAME_TO_JOB_KEY, {
    "qeoindex-eod-pipeline-1515-ict": "qeoindex.eod_pipeline",
    "kfsp-rating-daily-7am-ict": "kfsp.rating_daily",
    "kfsp-ttai-history-daily-1am-ict": "kfsp.ttai_history",
    "sync-universe-5m": "market.sync_5m",
    "sync-universe-eod-1450": "market.sync_eod",
  })

  assert.equal(getJobKeyForPgCron("sync-universe-5m"), "market.sync_5m")
  assert.equal(getJobKeyForPgCron("kfsp-rating-daily-7am-ict"), "kfsp.rating_daily")
  assert.equal(getPgCronNameForJobKey("qeoindex.eod_pipeline"), "qeoindex-eod-pipeline-1515-ict")
  assert.equal(getPgCronNameForJobKey("signals.daily"), undefined)
})

test("manual jobs are distinguished from scheduled jobs", () => {
  const manualKeys = ["scanner.run", "signals.monitor", "market.sync_universe", "market.cache_invalidate", "wyckoff.run"]
  for (const key of manualKeys) {
    const def = ADMIN_JOB_CATALOG.find((j) => j.key === key)
    assert.ok(def, `Job ${key} must exist in catalog`)
    assert.equal(def.scheduleKind, "manual", `${key} must have scheduleKind = manual`)
    assert.equal(def.scheduleUtc, undefined, `${key} must not have scheduleUtc`)
    assert.equal(def.schedulerName, undefined, `${key} must not have schedulerName`)
  }
})

test("detects 14:50 ICT overlap conflict between 5m sync and EOD sync", () => {
  const conflicts = findScheduleConflicts(EFFECTIVE_ADMIN_JOB_CATALOG)
  assert.ok(conflicts.length >= 2)

  const sync5mConflict = conflicts.find((c) => c.jobKey === "market.sync_5m")
  assert.ok(sync5mConflict)
  assert.equal(sync5mConflict.conflictWithKey, "market.sync_eod")
  assert.equal(sync5mConflict.timeIct, "14:50")
  assert.match(sync5mConflict.reason, /14:50 ICT/)

  const syncEodConflict = conflicts.find((c) => c.jobKey === "market.sync_eod")
  assert.ok(syncEodConflict)
  assert.equal(syncEodConflict.conflictWithKey, "market.sync_5m")
})
