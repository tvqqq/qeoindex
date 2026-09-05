import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { ADMIN_JOB_CATALOG } from "../modules/admin/catalog.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../modules/admin/effective-job-catalog.ts"
import {
  findScheduleConflicts,
  getJobKeyForPgCron,
  getPgCronNameForJobKey,
  PG_CRON_NAME_TO_JOB_KEY,
} from "../modules/admin/job-schedule.ts"
import { isValidSchedulePolicy } from "../modules/admin/schedule-policy.ts"

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

test("source catalog retains historical pg_cron definitions while effective catalog reflects QEO-64/QEO-85 cutovers", () => {
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

  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")
  assert.ok(sync5mDef)
  assert.equal(sync5mDef.schedulerName, "sync-universe-5m")
  assert.equal(sync5mDef.scheduleUtc, "*/5 2-4 * * 1-5; */5 6-7 * * 1-5")
  assert.equal(sync5mDef.scheduleIct, "Mỗi 5p (09:00-11:30; 13:00-14:40 T2-T6)")
  assert.equal(sync5mDef.scheduleKind, "interval")
  assert.equal(sync5mDef.windowStartIct, "09:00")
  assert.equal(sync5mDef.windowEndIct, "14:40")

  const syncEodSource = ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_eod")
  assert.ok(syncEodSource)
  assert.equal(syncEodSource.schedulerName, "sync-universe-eod-1445")
  const syncEodEffective = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_eod")
  assert.ok(syncEodEffective)
  assert.equal(syncEodEffective.scheduleKind, "manual")
  assert.equal(syncEodEffective.schedulerName, undefined)
  assert.equal(syncEodEffective.manualPolicy, "disabled")
  assert.equal(syncEodEffective.manualPurpose, "maintenance")

  const kfspRatingMigration = readTextFile("supabase/migrations/20260822112420_kfsp_rating_pipeline.sql")
  assert.match(kfspRatingMigration, /'kfsp-rating-daily-7am-ict'/)
  assert.match(kfspRatingMigration, /'0 0 \* \* \*'/)
  const ratingSource = ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.rating_daily")
  assert.ok(ratingSource)
  assert.equal(ratingSource.schedulerName, "kfsp-rating-daily-7am-ict")
  const ratingEffective = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.rating_daily")
  assert.ok(ratingEffective)
  assert.equal(ratingEffective.scheduleKind, "manual")
  assert.equal(ratingEffective.schedulerName, undefined)

  const ttaiMigration = readTextFile("supabase/migrations/20260827135500_reschedule_kfsp_ttai_daily_0710_ict.sql")
  assert.match(ttaiMigration, /cron\.unschedule\('kfsp-ttai-history-daily-1am-ict'\)/)
  assert.match(ttaiMigration, /'kfsp-ttai-history-daily-0710-ict'/)
  assert.match(ttaiMigration, /'10 0 \* \* \*'/)
  const ttaiEffective = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.ttai_history")
  assert.ok(ttaiEffective)
  assert.equal(ttaiEffective.scheduleKind, "manual")
  assert.equal(ttaiEffective.scheduleUtc, undefined)
  assert.equal(ttaiEffective.schedulerName, undefined)

  const eodPipelineMigration = readTextFile("supabase/migrations/20260825174500_qeoindex_eod_pipeline_cron.sql")
  assert.match(eodPipelineMigration, /'qeoindex-eod-pipeline-1515-ict'/)
  assert.match(eodPipelineMigration, /'15 8 \* \* 1-5'/)
  const eodDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "qeoindex.eod_pipeline")
  assert.ok(eodDef)
  assert.equal(eodDef.schedulerName, "qeoindex-eod-pipeline-1515-ict")
  assert.equal(eodDef.scheduleUtc, "15 8 * * 1-5")
  assert.equal(eodDef.scheduleIct, "15:15 T2-T6")
  assert.equal(eodDef.scheduleKind, "workflow")

  const researchMigration = readTextFile("supabase/pending-migrations/20260904193000_qeo80_research_reports.sql")
  assert.match(researchMigration, /'research-reports-daily-0705-ict'/)
  assert.match(researchMigration, /'5 0 \* \* \*'/)
  const research = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "research_reports.daily")
  assert.ok(research)
  assert.equal(research.schedulerName, "research-reports-daily-0705-ict")
  assert.equal(research.scheduleUtc, "5 0 * * *")
  assert.equal(research.scheduleIct, "07:05 hàng ngày")
  assert.equal(research.schedulePolicy?.kind, "fixed_time")
})

test("pg_cron dictionary remains readable while active forward ownership includes Research Reports", () => {
  assert.deepEqual(PG_CRON_NAME_TO_JOB_KEY, {
    "qeoindex-eod-pipeline-1515-ict": "qeoindex.eod_pipeline",
    "research-reports-daily-0705-ict": "research_reports.daily",
    "kfsp-rating-daily-7am-ict": "kfsp.rating_daily",
    "kfsp-ttai-history-daily-1am-ict": "kfsp.ttai_history",
    "kfsp-ttai-history-daily-0710-ict": "kfsp.ttai_history",
    "kfsp-ttai-history-hourly": "kfsp.ttai_history",
    "sync-universe-5m": "market.sync_5m",
    "sync-universe-5m-afternoon": "market.sync_5m",
    "sync-universe-eod-1445": "market.sync_eod",
    "sync-universe-eod-1450": "market.sync_eod",
  })

  assert.equal(getJobKeyForPgCron("research-reports-daily-0705-ict"), "research_reports.daily")
  assert.equal(getJobKeyForPgCron("sync-universe-5m"), "market.sync_5m")
  assert.equal(getJobKeyForPgCron("sync-universe-5m-afternoon"), "market.sync_5m")
  assert.equal(getJobKeyForPgCron("sync-universe-eod-1445"), "market.sync_eod")
  assert.equal(getJobKeyForPgCron("kfsp-rating-daily-7am-ict"), "kfsp.rating_daily")
  assert.equal(getJobKeyForPgCron("kfsp-ttai-history-daily-0710-ict"), "kfsp.ttai_history")
  assert.equal(getPgCronNameForJobKey("qeoindex.eod_pipeline"), "qeoindex-eod-pipeline-1515-ict")
  assert.equal(getPgCronNameForJobKey("research_reports.daily"), "research-reports-daily-0705-ict")
  assert.equal(getPgCronNameForJobKey("market.sync_5m"), "sync-universe-5m")
  assert.equal(getPgCronNameForJobKey("market.sync_eod"), undefined)
  assert.equal(getPgCronNameForJobKey("kfsp.rating_daily"), undefined)
  assert.equal(getPgCronNameForJobKey("kfsp.ttai_history"), undefined)
  assert.equal(getPgCronNameForJobKey("signals.daily"), undefined)
})

test("source manual jobs are distinguished from scheduled jobs", () => {
  const manualKeys = ["scanner.run", "signals.monitor", "market.sync_universe", "market.cache_invalidate", "wyckoff.run"]
  for (const key of manualKeys) {
    const def = ADMIN_JOB_CATALOG.find((j) => j.key === key)
    assert.ok(def, `Job ${key} must exist in catalog`)
    assert.equal(def.scheduleKind, "manual", `${key} must have scheduleKind = manual`)
    assert.equal(def.scheduleUtc, undefined, `${key} must not have scheduleUtc`)
    assert.equal(def.schedulerName, undefined, `${key} must not have schedulerName`)
  }
})

test("effective QEO-64 catalog has no legacy market EOD overlap", () => {
  const conflicts = findScheduleConflicts(EFFECTIVE_ADMIN_JOB_CATALOG)
  assert.equal(conflicts.length, 0)
})

test("detects legacy 14:50 ICT overlap conflict for historical catalog inputs", () => {
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

test("effective catalog has complete structured ICT schedule policies after QEO-64/QEO-85 cutovers", () => {
  assert.equal(new Set(EFFECTIVE_ADMIN_JOB_CATALOG.map((job) => job.key)).size, 14)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind === "manual").length, 10)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => job.schedulePolicy?.kind !== "manual").length, 4)
  assert.equal(EFFECTIVE_ADMIN_JOB_CATALOG.filter((job) => !isValidSchedulePolicy(job.schedulePolicy)).length, 0)

  const ingest = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "wyckoff.ingest")
  assert.ok(ingest)
  assert.equal(ingest.schedulePolicy?.kind, "manual")
  assert.equal(ingest.manualPolicy, "confirm")
  assert.equal(ingest.manualPurpose, "maintenance")

  for (const key of ["kfsp.rating_daily", "kfsp.ttai_history"]) {
    const job = EFFECTIVE_ADMIN_JOB_CATALOG.find((candidate) => candidate.key === key)
    assert.ok(job)
    assert.equal(job.schedulePolicy?.kind, "manual")
    assert.equal(job.manualPolicy, "confirm")
    assert.equal(job.manualPurpose, "recovery")
    assert.deepEqual(job.automatedParentKeys, ["qeoindex.eod_pipeline"])
  }

  const research = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "research_reports.daily")
  assert.ok(research)
  assert.deepEqual(research.schedulePolicy, { kind: "fixed_time", timezone: "Asia/Ho_Chi_Minh", cadence: "daily", minuteOfDay: 425, graceMinutes: 30 })
  const researchBackfill = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "research_reports.backfill")
  assert.ok(researchBackfill)
  assert.equal(researchBackfill.schedulePolicy?.kind, "manual")
  assert.equal(researchBackfill.manualPolicy, "confirm")

  const marketEod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_eod")
  assert.ok(marketEod)
  assert.equal(marketEod.schedulePolicy?.kind, "manual")
  assert.equal(marketEod.manualPolicy, "disabled")
  assert.equal(marketEod.manualPurpose, "maintenance")
  assert.deepEqual(marketEod.automatedParentKeys, ["qeoindex.eod_pipeline"])

  const market = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_5m")
  const windows = (market?.schedulePolicy as { windows: Array<{ startMinuteOfDay: number; endMinuteOfDay: number; cadenceMinutes: number }> }).windows
  assert.deepEqual(windows, [
    { startMinuteOfDay: 540, endMinuteOfDay: 690, cadenceMinutes: 5 },
    { startMinuteOfDay: 780, endMinuteOfDay: 880, cadenceMinutes: 5 },
  ])
  assert.equal(isValidSchedulePolicy(undefined), false)
  assert.equal(isValidSchedulePolicy({ kind: "fixed_time", timezone: "UTC", cadence: "daily", minuteOfDay: 420, graceMinutes: 5 }), false)
})
