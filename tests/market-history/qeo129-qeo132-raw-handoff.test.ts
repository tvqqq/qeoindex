import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { rebuildAdjustedDailyRange } from "../../modules/market/history/adjusted-daily-store.ts"

const RUN_ID = "00000000-0000-4000-8000-000000000129"
const LINEAGE = "a".repeat(64)
const FACTOR_VERSION = `qeo124-v1:${LINEAGE}`

function sessionIdentityHash(sessionDates: string[]) {
  return createHash("sha256").update(sessionDates.join("\n")).digest("hex")
}

function fakeSupabase(options: { tradingSessions?: string[] } = {}) {
  const calls: string[] = []
  let adjusted: Array<Record<string, unknown>> = []

  const rawRows = [{
    ticker: "VHM",
    session_date: "2026-08-05",
    evidence_id: "00000000-0000-4000-8000-000000000132",
    open: 154.2,
    high: 158.8,
    low: 153,
    close: 153,
    volume: 10_681_100,
    price_basis: "RAW",
    provider: "StockBiz",
    provider_detail: "bounded raw Daily evidence",
    source_url: "https://web.stockbiz.vn/Stocks/VHM/LookupQuote.aspx?Date=05%2F08%2F2026",
    source_price_unit: "VND_THOUSANDS",
    normalization_version: "qeo132-v1",
    raw_evidence_hash: "b".repeat(64),
  }]

  function rawQuery() {
    return {
      eq() { return this },
      gte() { return this },
      lte() { return this },
      async order() { return { data: rawRows, error: null } },
    }
  }

  function tradingSessionQuery() {
    return {
      eq() { return this },
      gte() { return this },
      lte() { return this },
      async order() {
        return {
          data: (options.tradingSessions ?? ["2026-08-05"]).map((session_date) => ({ session_date })),
          error: null,
        }
      },
    }
  }

  return {
    calls,
    client: {
      from(table: string) {
        calls.push(table)
        if (table === "market_adjustment_factor_runs") {
          return { select: () => ({
            eq() { return this },
            async maybeSingle() {
              return { data: {
                id: RUN_ID,
                ticker: "VHM",
                factor_version: FACTOR_VERSION,
                engine_version: "qeo124-v1",
                event_lineage_hash: LINEAGE,
                status: "candidate",
              }, error: null }
            },
          }) }
        }
        if (table === "market_price_adjustment_factors") {
          return { select: () => ({
            eq() { return this },
            async order() {
              return { data: [{
                effective_session: "2026-08-06",
                cumulative_price_factor: 0.5,
                cumulative_volume_factor: 2,
              }], error: null }
            },
          }) }
        }
        if (table === "market_ohlcv_raw_daily") return { select: () => rawQuery() }
        if (table === "market_trading_sessions") return { select: () => tradingSessionQuery() }
        if (table === "market_ohlcv_history") throw new Error("legacy Daily history must not be read by QEO-129")
        if (table === "market_ohlcv_adjusted_daily") {
          return { async upsert(payload: Array<Record<string, unknown>>) {
            adjusted = payload
            return { data: null, error: null }
          } }
        }
        if (table === "market_adjusted_daily_rollout") {
          return { async upsert() { return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
      async rpc(name: string) {
        assert.equal(name, "qeo_adjusted_daily_readback")
        return { data: adjusted.map((row) => ({
          session_date: row.session_date,
          bar_time: row.bar_time,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          raw_bar_time: row.raw_bar_time,
          factor_run_id: row.factor_run_id,
          factor_version: row.factor_version,
          event_lineage_hash: row.event_lineage_hash,
          adjustment_engine_version: row.adjustment_engine_version,
        })), error: null }
      },
    },
  }
}

test("QEO-129 rebuild consumes only QEO-132 canonical RAW Daily", async () => {
  const fake = fakeSupabase()
  const expectedSessions = ["2026-08-05"]
  const result = await rebuildAdjustedDailyRange({
    supabase: fake.client as never,
    ticker: "VHM",
    fromDate: "2026-08-05",
    toDate: "2026-08-05",
    expectedFactorRunId: RUN_ID,
    expectedLineageHash: LINEAGE,
    expectedRawSessionCount: expectedSessions.length,
    expectedRawSessionIdentityHash: sessionIdentityHash(expectedSessions),
  })

  assert.equal(result.rebuiltSessions, 1)
  assert.deepEqual(result.unresolvedSessions, [])
  assert.equal(fake.calls.includes("market_ohlcv_raw_daily"), true)
  assert.equal(fake.calls.includes("market_ohlcv_history"), false)
})

test("QEO-129 rejects a sparse canonical RAW range before shadow materialization", async () => {
  const fake = fakeSupabase({ tradingSessions: ["2026-08-04", "2026-08-05"] })
  const expectedSessions = ["2026-08-04", "2026-08-05"]

  await assert.rejects(
    rebuildAdjustedDailyRange({
      supabase: fake.client as never,
      ticker: "VHM",
      fromDate: "2026-08-04",
      toDate: "2026-08-05",
      expectedFactorRunId: RUN_ID,
      expectedLineageHash: LINEAGE,
      expectedRawSessionCount: expectedSessions.length,
      expectedRawSessionIdentityHash: sessionIdentityHash(expectedSessions),
    }),
    /canonical RAW range is incomplete/i,
  )

  assert.equal(fake.calls.includes("market_ohlcv_adjusted_daily"), false)
  assert.equal(fake.calls.includes("market_adjusted_daily_rollout"), false)
})

test("QEO-129 uses retained ticker session identity rather than assuming every exchange session has a bar", async () => {
  const fake = fakeSupabase({ tradingSessions: ["2026-08-04", "2026-08-05"] })
  const expectedSessions = ["2026-08-05"]

  const result = await rebuildAdjustedDailyRange({
    supabase: fake.client as never,
    ticker: "VHM",
    fromDate: "2026-08-04",
    toDate: "2026-08-05",
    expectedFactorRunId: RUN_ID,
    expectedLineageHash: LINEAGE,
    expectedRawSessionCount: expectedSessions.length,
    expectedRawSessionIdentityHash: sessionIdentityHash(expectedSessions),
  })

  assert.equal(result.rebuiltSessions, 1)
  assert.equal(fake.calls.includes("market_trading_sessions"), false)
  assert.equal(fake.calls.includes("market_ohlcv_history"), false)
})
