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

function recentRow(ticker: string, timeframe: "1H" | "1D", index: number): WyckoffV2RecentOhlcvRow {
  const base = timeframe === "1H" ? Date.parse("2026-08-25T01:00:00.000Z") : Date.parse("2026-08-20T00:00:00.000Z")
  const step = timeframe === "1H" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const barTime = new Date(base + index * step).toISOString()
  return {
    ticker,
    timeframe,
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
  return tickers.flatMap((ticker) => [
    recentRow(ticker, "1H", 2),
    recentRow(ticker, "1H", 0),
    recentRow(ticker, "1H", 1),
    recentRow(ticker, "1D", 1),
    recentRow(ticker, "1D", 2),
    recentRow(ticker, "1D", 0),
  ])
}

test("v2 chart-series builder produces exactly 1H and 1D read models per ticker from recent OHLCV cache", () => {
  const rows = buildWyckoffV2ChartSeriesRows({
    tickers: ["AAA", "BBB"],
    rows: completeRows(),
    runId: RUN_ID,
  })

  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((row) => `${row.ticker}|${row.timeframe}`), ["AAA|1H", "AAA|1D", "BBB|1H", "BBB|1D"])
  assert.ok(rows.every((row) => row.bars.length === 3))
  assert.ok(rows.every((row) => row.bars.length <= 260))
  assert.ok(rows.every((row) => row.run_id === RUN_ID))
  assert.ok(rows.every((row) => row.model_version === "qeo-wyckoff-rule-v1"))
  assert.ok(rows.every((row) => row.aggregation_version === "vn-session-v1"))

  const aaaDaily = rows.find((row) => row.ticker === "AAA" && row.timeframe === "1D")!
  assert.equal(aaaDaily.provider, "Fallback")
  assert.equal(aaaDaily.provider_detail, "latest provenance")
  assert.equal(aaaDaily.as_of, recentRow("AAA", "1D", 2).bar_time)
  assert.deepEqual(aaaDaily.bars.map((bar) => bar.time), aaaDaily.bars.map((bar) => bar.time).slice().sort((a, b) => a - b))
})

test("v2 chart-series coverage fails closed when any ticker is missing 1H or 1D series", () => {
  const rows = buildWyckoffV2ChartSeriesRows({
    tickers: ["AAA", "BBB"],
    rows: completeRows().filter((row) => !(row.ticker === "BBB" && row.timeframe === "1H")),
    runId: RUN_ID,
  })

  assert.throws(
    () => assertWyckoffV2ChartSeriesCoverage(["AAA", "BBB"], rows),
    /BBB\|1H/,
  )
})

test("chart-series loader keeps every RPC response below the row cap by loading one ticker per request", async () => {
  const tickers = Array.from({ length: 100 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
  const calls: string[][] = []
  const supabase = {
    rpc: async (_name: string, args: { p_tickers: string[] }) => {
      calls.push(args.p_tickers)
      const complete = completeRows(args.p_tickers)
      return {
        data: args.p_tickers.length > 1 ? complete.slice(0, 12) : complete,
        error: null,
      }
    },
  } as unknown as SupabaseClient

  const rows = await loadWyckoffV2ChartSeriesRows(supabase, tickers, RUN_ID)

  assert.equal(rows.length, 200)
  assert.equal(calls.length, 100)
  assert.ok(calls.every((call) => call.length === 1))
})
