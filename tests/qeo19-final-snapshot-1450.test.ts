import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import { getPgCronNameForJobKey } from "../lib/admin/job-schedule.ts"
import { buildVerifiedFinalDailyBar } from "../lib/qeoindex-eod-no-trade-repair-step.ts"

const migrationPath = "supabase/pending-migrations/20260903160000_fix_final_orderbook_sync_1450.sql"

test("QEO-19 rejects pre-14:50 snapshots as non-final evidence", () => {
  const snapshot = {
    symbol: "TCB",
    session_date: "2026-09-03",
    reference_price: 33.2,
    latest_price: 32.1,
    total_volume: 25_003_600,
    updated_at: "2026-09-03T07:49:59.000Z",
    latest_quote: {
      openPrice: 33.1,
      highPrice: 33.1,
      lowPrice: 32.1,
      matchPrice: 32.1,
      totalVolume: 25_003_600,
    },
  }

  assert.equal(buildVerifiedFinalDailyBar("TCB", "2026-09-03", snapshot), null)
})

test("QEO-19 stages canonical final orderbook sync at 14:50 ICT", () => {
  assert.equal(existsSync(migrationPath), true, "14:50 scheduler migration must be staged")
  if (!existsSync(migrationPath)) return

  const migration = readFileSync(migrationPath, "utf8")
  assert.match(migration, /cron\.unschedule\('sync-universe-eod-1445'\)/)
  assert.match(migration, /'sync-universe-eod-1450'/)
  assert.match(migration, /'50 7 \* \* 1-5'/)

  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_eod")
  assert.ok(eod)
  assert.equal(eod.schedulerName, "sync-universe-eod-1450")
  assert.equal(eod.scheduleUtc, "50 7 * * 1-5")
  assert.equal(eod.scheduleIct, "14:50 T2-T6")
  assert.equal(getPgCronNameForJobKey("market.sync_eod"), "sync-universe-eod-1450")
})
