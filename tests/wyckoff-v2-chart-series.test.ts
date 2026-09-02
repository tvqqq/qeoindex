import assert from "node:assert/strict"
import test from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  assertWyckoffV2ChartSeriesCoverage,
  buildWyckoffV2ChartSeriesRows,
  loadWyckoffV2ChartSeriesRows,
  type WyckoffV2RecentOhlcvRow,
} from "../lib/wyckoff-v2-chart-series.ts"

const RUN_ID = "11111111-1111-4111-8111-111111111111"

function recentRow(ticker: string, index: number): WyckoffV2RecentOhlcvRow {
  const barTime = new Date(Date.parse("2026-08-20T00:00:00.000Z") + index * 24 * 60 * 60 * 1000).toISOString()
  return {
    ticker,
    timeframe: "1D",
    bar_time: barTime,
    open: 60 + index,
    high: 61 + index,
    low: 59 + index,
    close: 60.5 + index,
    volume: 1_000_000 + index,
    provider: index === 2 ? "Fallback" : "DNSE",
    provider_detail: index === 2 ? "latest provenance" : "older provenance",
    source_url: index === 2 ? "https://example.com/latest" : "https://example.com/older",
    fetched_at: new Date(Date.parse(barTime) + 60_000).toISOString(),
  }
}

function completeRows(tickers = ["AAA", "BBB"]) {
  return tickers.flatMap((ticker) => [recentRow(ticker, 2), recentRow(ticker, 0), recentRow(ticker, 1)])
}

test("v2 chart-series builder produces exactly one raw Daily read model per ticker", () => {
  const rows = buildWyckoffV2ChartSeriesRows({
    tickers: ["AAA", "BBB"],
    rows: completeRows(),
    runId: RUN_ID,
  })

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => `${row.ticker}|${row.timeframe}`), ["AAA|1D", "BBB|1D"])
  assert.ok(rows.every((row) => row.bars.length === 3))
  assert.ok(rows.every((row) => row.bars.length <= 260))
  assert.ok(rows.every((row) => row.run_id === RUN_ID))
  assert.ok(rows.every((row) => row.model_version === "qeo-wyckoff-rule-v1"))
  assert.ok(rows.every((row) => row.aggregation_version === "vn-session-v1"))

  const aaaDaily = rows.find((row) => row.ticker === "AAA")!
  assert.equal(aaaDaily.provider, "Fallback")
  assert.equal(aaaDaily.provider_detail, "latest provenance")
  assert.equal(aaaDaily.as_of, recentRow("AAA", 2).bar_time)
  assert.deepEqual(aaaDaily.bars.map((bar) => bar.close), [60.5, 61.5, 62.5])
})

test("v2 chart-series coverage fails closed when any ticker is missing Daily series", () => {
  const rows = buildWyckoffV2ChartSeriesRows({
    tickers: ["AAA", "BBB"],
    rows: completeRows().filter((row) => row.ticker !== "BBB"),
    runId: RUN_ID,
  })

  assert.throws(
    () => assertWyckoffV2ChartSeriesCoverage(["AAA", "BBB"], rows),
    /BBB\|1D/,
  )
})

test("chart-series loader batches 100 tickers into at most 10 grouped RPC requests", async () => {
  const tickers = Array.from({ length: 100 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
  const calls: Array<{ name: string; tickers: string[] }> = []
  const supabase = {
    rpc: async (name: string, args: { p_tickers: string[] }) => {
      calls.push({ name, tickers: args.p_tickers })
      return {
        data: args.p_tickers.map((ticker) => ({ ticker, rows: completeRows([ticker]) })),
        error: null,
      }
    },
  } as unknown as SupabaseClient

  const rows = await loadWyckoffV2ChartSeriesRows(supabase, tickers, RUN_ID)

  assert.equal(rows.length, 100)
  assert.equal(calls.length, 10)
  assert.ok(calls.every((call) => call.name === "qeo_market_ohlcv_recent_grouped"))
  assert.ok(calls.every((call) => call.tickers.length > 0 && call.tickers.length <= 10))
  assert.deepEqual(calls.flatMap((call) => call.tickers), tickers)
  assert.ok(rows.every((row) => row.timeframe === "1D"))
})
