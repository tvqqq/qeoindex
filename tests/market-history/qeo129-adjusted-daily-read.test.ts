import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { loadAdjustedDailyRange } from "../../modules/market/history/adjusted-daily-read.ts"

const RUN_ID = "00000000-0000-4000-8000-000000000129"
const LINEAGE = "a".repeat(64)
const FACTOR_VERSION = `qeo124-v1:${LINEAGE}`
const FROM_MS = Date.parse("2026-08-03T00:00:00.000Z")
const TO_MS = Date.parse("2026-08-05T23:59:59.999Z")

const BASE_ROWS = [
  {
    ticker: "VHM",
    session_date: "2026-08-03",
    bar_time: "2026-08-03T02:00:00.000Z",
    open: 50,
    high: 55,
    low: 48,
    close: 52.5,
    volume: 2_000,
    factor_run_id: RUN_ID,
    factor_version: FACTOR_VERSION,
    event_lineage_hash: LINEAGE,
    adjustment_engine_version: "qeo124-v1",
  },
  {
    ticker: "VHM",
    session_date: "2026-08-04",
    bar_time: "2026-08-04T02:00:00.000Z",
    open: 52,
    high: 56,
    low: 51,
    close: 55,
    volume: 2_200,
    factor_run_id: RUN_ID,
    factor_version: FACTOR_VERSION,
    event_lineage_hash: LINEAGE,
    adjustment_engine_version: "qeo124-v1",
  },
  {
    ticker: "VHM",
    session_date: "2026-08-05",
    bar_time: "2026-08-05T02:00:00.000Z",
    open: 55,
    high: 58,
    low: 54,
    close: 57,
    volume: 2_400,
    factor_run_id: RUN_ID,
    factor_version: FACTOR_VERSION,
    event_lineage_hash: LINEAGE,
    adjustment_engine_version: "qeo124-v1",
  },
]

function fakeSupabase(options: {
  rollout?: null | Record<string, unknown>
  rows?: Array<Record<string, unknown>>
} = {}) {
  const calls: Array<{ table: string; op: string }> = []
  const rollout = options.rollout === undefined
    ? {
        ticker: "VHM",
        status: "shadow",
        factor_run_id: RUN_ID,
        factor_version: FACTOR_VERSION,
        event_lineage_hash: LINEAGE,
        verified_from: "2026-08-03",
        verified_through: "2026-08-05",
      }
    : options.rollout
  const rows = options.rows ?? BASE_ROWS

  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ table, op: "from" })
        if (table === "market_adjusted_daily_rollout") {
          return {
            select() {
              calls.push({ table, op: "select" })
              return {
                eq() { return this },
                async maybeSingle() { return { data: rollout, error: null } },
              }
            },
          }
        }
        if (table === "market_ohlcv_adjusted_daily") {
          return {
            select() {
              calls.push({ table, op: "select" })
              return {
                eq() { return this },
                gte() { return this },
                lte() { return this },
                async order() { return { data: rows, error: null } },
              }
            },
          }
        }
        throw new Error(`QEO-129 adjusted read queried forbidden table ${table}`)
      },
    },
  }
}

test("QEO-129 shadow read returns complete ordered adjusted Daily range with exact lineage", async () => {
  const fake = fakeSupabase()
  const result = await loadAdjustedDailyRange(fake.client as never, "VHM", FROM_MS, TO_MS)

  assert.equal(result.complete, true)
  assert.deepEqual(result.unresolvedSessions, [])
  assert.equal(result.factorRunId, RUN_ID)
  assert.equal(result.factorVersion, FACTOR_VERSION)
  assert.equal(result.lineageHash, LINEAGE)
  assert.deepEqual(result.bars.map((bar) => bar.time), [
    Math.floor(Date.parse("2026-08-03T02:00:00.000Z") / 1000),
    Math.floor(Date.parse("2026-08-04T02:00:00.000Z") / 1000),
    Math.floor(Date.parse("2026-08-05T02:00:00.000Z") / 1000),
  ])
  assert.equal(fake.calls.some((call) => call.table === "market_ohlcv_history"), false)
})

test("QEO-129 shadow read fails closed on a missing expected trading session without raw fallback", async () => {
  const fake = fakeSupabase({ rows: BASE_ROWS.filter((row) => row.session_date !== "2026-08-04") })
  const result = await loadAdjustedDailyRange(fake.client as never, "VHM", FROM_MS, TO_MS)

  assert.equal(result.complete, false)
  assert.deepEqual(result.bars, [])
  assert.deepEqual(result.unresolvedSessions, ["2026-08-04"])
  assert.equal(fake.calls.some((call) => call.table === "market_ohlcv_history"), false)
})

test("QEO-129 shadow read fails closed on duplicate session or row/rollout lineage mismatch", async () => {
  const duplicate = fakeSupabase({ rows: [BASE_ROWS[0], BASE_ROWS[1], BASE_ROWS[1], BASE_ROWS[2]] })
  const duplicateResult = await loadAdjustedDailyRange(duplicate.client as never, "VHM", FROM_MS, TO_MS)
  assert.equal(duplicateResult.complete, false)
  assert.deepEqual(duplicateResult.bars, [])
  assert.deepEqual(duplicateResult.unresolvedSessions, ["2026-08-04"])

  const mismatchedRows = BASE_ROWS.map((row) => row.session_date === "2026-08-04"
    ? { ...row, event_lineage_hash: "b".repeat(64) }
    : row)
  const mismatch = fakeSupabase({ rows: mismatchedRows })
  const mismatchResult = await loadAdjustedDailyRange(mismatch.client as never, "VHM", FROM_MS, TO_MS)
  assert.equal(mismatchResult.complete, false)
  assert.deepEqual(mismatchResult.bars, [])
  assert.deepEqual(mismatchResult.unresolvedSessions, ["2026-08-04"])
})

test("QEO-129 shadow read fails closed without verified rollout and does not query adjusted rows", async () => {
  const fake = fakeSupabase({ rollout: null })
  const result = await loadAdjustedDailyRange(fake.client as never, "VHM", FROM_MS, TO_MS)

  assert.deepEqual(result, {
    bars: [],
    factorRunId: null,
    factorVersion: null,
    lineageHash: null,
    complete: false,
    unresolvedSessions: ["2026-08-03", "2026-08-04", "2026-08-05"],
  })
  assert.equal(fake.calls.some((call) => call.table === "market_ohlcv_adjusted_daily"), false)
  assert.equal(fake.calls.some((call) => call.table === "market_ohlcv_history"), false)
})

test("QEO-129 keeps Chart, Wyckoff and AI Council isolated from adjusted Daily shadow reads", () => {
  const consumerFiles = [
    "modules/market/chart-data/service.ts",
    "modules/wyckoff/eod-cache-read.ts",
    "modules/wyckoff/eod-chart-series.ts",
    "modules/ai-council/eod-market.ts",
  ]

  for (const path of consumerFiles) {
    const source = readFileSync(path, "utf8")
    assert.doesNotMatch(source, /adjusted-daily-read/i, `${path} must not import QEO-129 shadow read boundary`)
    assert.doesNotMatch(source, /market_ohlcv_adjusted_daily/i, `${path} must not query QEO-129 shadow storage`)
  }
})
