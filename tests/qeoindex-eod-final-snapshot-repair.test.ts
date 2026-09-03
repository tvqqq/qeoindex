import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  buildVerifiedFinalDailyBar,
  buildVerifiedNoTradeDailyBar,
} from "../lib/qeoindex-eod-no-trade-repair-step.ts"

const repairSource = readFileSync("lib/qeoindex-eod-no-trade-repair-step.ts", "utf8")
const scheduleMigrationPath = "supabase/pending-migrations/20260903160000_fix_final_orderbook_sync_1450.sql"

test("EOD gap repair accepts verified final traded OHLC snapshots instead of only no-trade rows", () => {
  const bar = buildVerifiedFinalDailyBar("VIC", "2026-09-03", {
    symbol: "VIC",
    session_date: "2026-09-03",
    reference_price: 236,
    latest_price: 244.5,
    total_volume: 7_676_800,
    latest_quote: {
      openPrice: 232.9,
      highPrice: 244.5,
      lowPrice: 226,
      matchPrice: 244.5,
      totalVolume: 7_676_800,
    },
    updated_at: "2026-09-03T07:50:01.000Z",
  })

  assert.deepEqual(bar, {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 232.9,
    high: 244.5,
    low: 226,
    close: 244.5,
    volume: 7_676_800,
  })
  assert.match(repairSource, /Verified final EOD repair from stock_orderbook_snapshots/)
})

test("final traded repair normalizes high/low around final close but rejects volume mismatch", () => {
  const base = {
    symbol: "SSB",
    session_date: "2026-09-03",
    reference_price: 17.15,
    latest_price: 18.25,
    total_volume: 3_303_000,
    latest_quote: {
      openPrice: 17.15,
      highPrice: 18.2,
      lowPrice: 17.1,
      matchPrice: 18.25,
      totalVolume: 3_303_000,
    },
    updated_at: "2026-09-03T07:50:01.000Z",
  }

  assert.deepEqual(buildVerifiedFinalDailyBar("SSB", "2026-09-03", base), {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 17.15,
    high: 18.25,
    low: 17.1,
    close: 18.25,
    volume: 3_303_000,
  })
  assert.equal(buildVerifiedFinalDailyBar("SSB", "2026-09-03", {
    ...base,
    latest_quote: { ...base.latest_quote, totalVolume: 3_000_000 },
  }), null)
})

test("14:45 snapshot is not final enough; final repair requires at least 14:50 ICT", () => {
  const stale = {
    symbol: "TCB",
    session_date: "2026-09-03",
    reference_price: 33.2,
    latest_price: 32.1,
    total_volume: 25_003_600,
    latest_quote: {
      openPrice: 33.1,
      highPrice: 33.1,
      lowPrice: 32.1,
      matchPrice: 32.1,
      totalVolume: 25_003_600,
    },
    updated_at: "2026-09-03T07:49:59.000Z",
  }

  assert.equal(buildVerifiedFinalDailyBar("TCB", "2026-09-03", stale), null)
  assert.equal(buildVerifiedNoTradeDailyBar("TCB", "2026-09-03", {
    ...stale,
    reference_price: 33.2,
    latest_price: 33.2,
    total_volume: 0,
    latest_quote: undefined,
  }), null)
})

test("production final snapshot schedule is staged at 14:50 ICT with no 14:45 EOD job", () => {
  assert.equal(existsSync(scheduleMigrationPath), true, "14:50 final snapshot schedule migration must be staged")
  if (!existsSync(scheduleMigrationPath)) return
  const migration = readFileSync(scheduleMigrationPath, "utf8")
  assert.match(migration, /sync-universe-eod-1450/)
  assert.match(migration, /'50 7 \* \* 1-5'/)
  assert.match(migration, /cron\.unschedule\('sync-universe-eod-1445'\)/)
  assert.doesNotMatch(migration, /cron\.schedule\([\s\S]*sync-universe-eod-1445/)
})
