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
import { isValidSchedulePolicy } from "../lib/admin/schedule-policy.ts"

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
  const syncOrderbookMigration = readTextFile("supabase/migrations/20260901152000_fix_orderbook_trading_session_windows.sql")
  assert.match(syncOrderbookMigration, /'sync-universe-5m'/)
  assert.match(syncOrderbookMigration, /'\*\/5 2-4 \* \* 1-5'/)
  assert.match(syncOrderbookMigration, /time '09:00'/)
  assert.match(syncOrderbookMigration, /time '11:30'/)
  assert.match(syncOrderbookMigration, /'sync-universe-5m-afternoon'/)
  assert.match(syncOrderbookMigration, /'\*\/5 6-7 \* \* 1-5'/)
  assert.match(syncOrderbookMigration, /time '13:00'/)
  assert.match(syncOrderbookMigration, /time '14:40'/)
  assert.match(syncOrderbookMigration, /'sync-universe-eod-1445'/)
  assert.match(syncOrderbookMigration, /'45 7 \* \* 1-5'/)

  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")
  assert.ok(sync5mDef)
  assert.equal(sync5mDef.schedulerName, "sync-universe-5m")
  assert.equal(sync5mDef.scheduleUtc, "*/5 2-4 * * 1-5; */5 6-7 * * 1-5")
  assert.equal(sync5mDef.scheduleIct, "Mỗi 5p (09:00-11:30; 13:00-14:40 T2-T6)")
  assert.equal(sync5mDef.scheduleKind, "interval")
  assert.equal(sync5mDef.windowStartIct, "09:00")
  assert.equal(sync5mDef.windowEndIct, "14:40")

  const syncEodDef = ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_eod")
  assert.ok(syncEodDef)
  assert.equal(syncEodDef.schedulerName, "sync-universe-eod-1445")
  assert.equal(syncEodDef.scheduleUtc, "45 7 * * 1-5")
  assert.equal(syncEodDef.scheduleIct, "14:45 T2-T6")
  assert.equal(syncEodDef.scheduleKind, "point")
  assert.equal(syncEodDef.windowStartIct, "14:45")
  assert.equal(syncEodDef.windowEndIct, "14:45")

  const kfspRatingMigration = readTextFile("supabase/migrations/20260822112420_kfsp_rating_pipeline.sql")
  assert.match(kfspRatingMigration, /'kfsp-rating-daily-7am-ict'/)
  assert.match(kfspRatingMigration, /'0 0 \* \* \*'/)

  const ratingDef = ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.rating_daily")
  assert.ok(ratingDef)
  assert.equal(ratingDef.schedulerName, "kfsp-rating-daily-7am-ict")
  assert.equal(ratingDef.scheduleUtc, "0 0 * * *")
  assert.equal(ratingDef.scheduleDays, "daily")
  assert.equal(ratingDef.scheduleKind, "point")

  const ttaiMigration = readTextFile("supabase/migrations/20260827135500_reschedule_kfsp_ttai_daily_0710_ict.sql")
  assert.match(ttaiMigration, /cron\.unschedule\('kfsp-ttai-history-daily-1am-ict'\)/)
  assert.match(ttaiMigration, /'kfsp-ttai-history-daily-0710-ict'/)
  assert.match(ttaiMigration, /'10 0 \* \* \*'/)

  const ttaiDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.ttai_history")
  assert.ok(ttaiDef)
  assert.equal(ttaiDef.schedulerName, "kfsp-ttai-history-daily-0710-ict")
  assert.equal(ttaiDef.scheduleUtc, "10 0 * * *")
  assert.equal(ttaiDef.scheduleIct, "07:10 hàng ngày")
  assert.equal(ttaiDef.scheduleDays, "daily")
  assert.equal(ttaiDef.intervalMinutes, undefined)
  assert.equal(ttaiDef.scheduleKind, "point")

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
    "kfsp-ttai-history-daily-0710-ict": "kfsp.ttai_history",
    "sync-universe-5m": "market.sync_5m",
    "sync-universe-5m-afternoon": "market.sync_5m",
    "sync-universe-eod-1445": "market.sync_eod",
    "sync-universe-eod-1450": "market.sync_eod",
  })

  assert.equal(getJobKeyForPgCron("sync-universe-5m"), "market.sync_5m")
  assert.equal(getJobKeyForPgCron("sync-universe-5m-afternoon"), "market.sync_5m")
  assert.equal(getJobKeyForPgCron("sync-universe-eod-1445"), "market.sync_eod")
  assert.equal(getJobKeyForPgCron("kfsp-rating-daily-7am-ict"), "kfsp.rating_daily")
  assert.equal(getJobKeyForPgCron("kfsp-ttai-history-daily-0710-ict"), "kfsp.ttai_history")
  assert.equal(getPgCronNameForJobKey("qeoindex.eod_pipeline"), "qeoindex-eod-pipeline-1515-ict")
  assert.equal(getPgCronNameForJobKey("market.sync_eod"), "sync-universe-eod-1445")
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

test("resolves 14:45 non-overlapping schedule without conflicts", () => {
  const conflicts = findScheduleConflicts(EFFECTIVE_ADMIN_JOB_CATALOG)
  assert.equal(conflicts.length, 0, "Non-overlapping 14:45 EOD schedule must produce 0 conflicts")
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
  assert.equal(new Set(EFFECTIVE_ADMIN_JOB_CATALOG.map((job) => job.key)).size, 11)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind === "manual").length, 5)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind !== "manual").length, 6)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => !isValidSchedulePolicy(job.schedulePolicy)).length, 0)
  const ttai = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "kfsp.ttai_history")
  assert.equal(ttai?.schedulePolicy?.kind, "fixed_time")
  assert.equal((ttai?.schedulePolicy as { minuteOfDay: number }).minuteOfDay, 430)
  const market = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  const windows = (market?.schedulePolicy as { windows: Array<{ startMinuteOfDay: number; endMinuteOfDay: number }> }).windows
  assert.deepEqual(windows, [
    { startMinuteOfDay: 540, endMinuteOfDay: 690, cadenceMinutes: 5 },
    { startMinuteOfDay: 780, endMinuteOfDay: 880, cadenceMinutes: 5 },
  ])
  assert.equal(isValidSchedulePolicy(undefined), false)
  assert.equal(isValidSchedulePolicy({ kind: "fixed_time", timezone: "UTC", cadence: "daily", minuteOfDay: 420, graceMinutes: 5 }), false)
})
