import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  adjacentPrefetchTargets,
  clearChartHistoryCache,
  isStableClosedChartRange,
  planChartHistorySlices,
  prepareInitialChartHistory,
  requestChartRange,
  requestFreshChartRange,
  type ChartHistoryResponse,
  type ChartRangeInput,
} from "../../components/stock-detail/chart/chart-history.ts"
import { chartHttpCachePolicy } from "../../modules/market/chart-data/http-cache-policy.ts"
import {
  createChartPerformanceRecorder,
  type ChartPerfStage,
} from "../../modules/market/chart-data/performance.ts"

const STAGES: ChartPerfStage[] = ["daily-db", "hot-db", "derived-cache", "cold-object", "provider-fetch", "aggregation"]
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function browserBenchmarkSource() {
  return readFileSync(new URL("../browser/qeo172-chart-performance-production.spec.ts", import.meta.url), "utf8")
}
function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}
function completeResponse(input: ChartRangeInput, times: number[]): ChartHistoryResponse {
  return {
    ok: true,
    ticker: input.ticker.toUpperCase(),
    resolution: input.timeframe,
    from: input.from,
    to: input.to,
    bars: times.map((time, index) => ({ time, open: 100 + index, high: 101 + index, low: 99 + index, close: 100.5 + index, volume: 1_000 + index })),
    gaps: [], integrityIssues: [], coverage: { complete: true, state: "COMPLETE" }, errors: [],
    metadata: { priceBasis: "RAW", provider: null, lastUpdatedAt: new Date(input.to * 1000).toISOString(), sessionState: "CLOSED", currentBarTime: null, persistedThrough: input.to },
  }
}

test("QEO-172 recorder accumulates duration and count per stage", async () => {
  let now = 0
  const recorder = createChartPerformanceRecorder(() => now)
  await recorder.measure("hot-db", async () => { now += 7 })
  await recorder.measure("hot-db", async () => { now += 5 })
  recorder.measureSync("aggregation", () => { now += 3 })
  const snapshot = recorder.snapshot()
  assert.deepEqual(snapshot["hot-db"], { durationMs: 12, count: 2 })
  assert.deepEqual(snapshot.aggregation, { durationMs: 3, count: 1 })
  for (const stage of STAGES) assert.ok(stage in snapshot)
})

test("QEO-238 active Daily request stays wholly closed on a trading date", () => {
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: epoch("2026-09-01T00:00:00+07:00"), to: epoch("2026-09-10T00:00:00+07:00") }
  assert.deepEqual(planChartHistorySlices(input), { stableClosed: input, currentDateTail: null })
})

test("QEO-238 non-trading date also keeps the bounded Daily request closed", () => {
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: epoch("2026-09-01T00:00:00+07:00"), to: epoch("2026-09-11T00:00:00+07:00") }
  assert.deepEqual(planChartHistorySlices(input), { stableClosed: input, currentDateTail: null })
})

test("QEO-172 future-ending ranges are never stable-cacheable", () => {
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: epoch("2026-09-01T00:00:00+07:00"), to: epoch("2026-09-13T00:00:00+07:00") }
  assert.equal(isStableClosedChartRange(input, new Date("2026-09-12T10:00:00+07:00")), false)
})

test("QEO-172 completed Daily never gets an intraday current-date tail", () => {
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: 1, to: epoch("2026-09-10T00:00:00+07:00") }
  assert.deepEqual(planChartHistorySlices(input), { stableClosed: input, currentDateTail: null })
})

test("QEO-172 server cache policy admits only safe stable complete ranges", () => {
  const now = new Date("2026-09-10T16:00:00+07:00")
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: epoch("2026-09-01T00:00:00+07:00"), to: epoch("2026-09-09T00:00:00+07:00") }
  const safe = completeResponse(input, [input.from, input.to])
  assert.deepEqual(chartHttpCachePolicy(input, safe, now), { cacheControl: "private, max-age=600", vary: "Cookie" })
  assert.deepEqual(chartHttpCachePolicy(input, { ...safe, coverage: { complete: false, state: "PARTIAL" } }, now), { cacheControl: "no-store" })
})

test("QEO-172 stable request uses default transport while explicit fresh request stays no-store", async () => {
  clearChartHistoryCache()
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1D", from: epoch("2026-09-01T00:00:00+07:00"), to: epoch("2026-09-11T00:00:00+07:00") }
  const seen: Array<RequestInit["cache"]> = []
  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.cache)
    return new Response(JSON.stringify(completeResponse(input, [input.from, input.to])), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  await requestChartRange(input, undefined, fetchImpl, { now: new Date("2026-09-12T10:00:00+07:00") })
  await requestFreshChartRange(input, undefined, fetchImpl)
  assert.deepEqual(seen, ["default", "no-store"])
})

test("QEO-238 prepareInitialChartHistory performs one stable Daily request", async () => {
  clearChartHistoryCache()
  const calls: Array<RequestInit["cache"]> = []
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url), "https://qeoindex.local")
    const input: ChartRangeInput = { ticker: parsed.searchParams.get("ticker") || "VIC", timeframe: "1D", from: Number(parsed.searchParams.get("from")), to: Number(parsed.searchParams.get("to")) }
    calls.push(init?.cache)
    return new Response(JSON.stringify(completeResponse(input, [input.from, input.to])), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  const prepared = await prepareInitialChartHistory({ ticker: "VIC", timeframe: "1D", now: new Date("2026-09-10T16:00:00+07:00"), fetchImpl })
  assert.deepEqual(calls, ["default"])
  assert.equal(prepared.result.coverage.complete, true)
  assert.equal(prepared.result.bars.length, 2)
})

test("QEO-172 adjacent prefetch targets are bounded, ordered and never wrap", () => {
  assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VIC"), ["VCB", "VHM"])
  assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VCB"), ["VIC"])
  assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VHM"), ["VIC"])
  assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "SSI"), [])
})

test("QEO-172 production benchmark enters fullscreen from terminal state, not title metadata", () => {
  const browser = browserBenchmarkSource()
  assert.match(browser, /data-chart-maximized/)
  assert.match(browser, /toHaveAttribute\([\s\S]*?"data-chart-maximized",\s*"true"/)
  assert.doesNotMatch(browser, /\[title=\\?"Phóng to chart\\?"\]/)
})

test("QEO-172 production benchmark persists matrix evidence before adjacent navigation", () => {
  const browser = browserBenchmarkSource()
  const partialWrite = browser.indexOf("complete: false")
  const adjacentMeasure = browser.indexOf("await measureAdjacentTickerSwitches(page)")
  const completeWrite = browser.indexOf("complete: true")
  assert.ok(partialWrite >= 0 && adjacentMeasure >= 0 && completeWrite >= 0)
  assert.ok(partialWrite < adjacentMeasure)
  assert.ok(adjacentMeasure < completeWrite)
})

test("QEO-238 active chart contract is Daily-only and stale intraday API requests fail closed", () => {
  const types = source("components/stock-detail/chart/stock-chart-types.ts")
  const route = source("app/api/market/ohlcv/route.ts")
  const matrix = browserBenchmarkSource().match(/const MATRIX = \[[\s\S]*?\] as const/)?.[0] ?? ""
  assert.match(types, /export type ChartTimeframe = \"1D\" \| \"3D\" \| \"1W\" \| \"1M\" \| \"1Q\" \| \"1Y\"/)
  assert.doesNotMatch(types, /\| \"(?:1m|15m|30m|1h|2h|4h)\"/)
  assert.ok(matrix)
  assert.doesNotMatch(matrix, /\"(?:1m|15m|30m|1h|2h|4h)\"/)
  assert.match(route, /INTRADAY_TIMEFRAME_RETIRED/)
})

test("QEO-238 active server chart graph no longer imports intraday HOT COLD or derived storage", () => {
  const timeframeService = source("modules/market/chart-data/timeframe-service.ts")

  for (const retiredDependency of [
    "./cold-store",
    "./derived-hourly-ready-range",
    "./derived-hourly-source-coverage",
    "./hot-store",
  ]) {
    assert.doesNotMatch(timeframeService, new RegExp(retiredDependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.doesNotMatch(timeframeService, /loadHourlyFamily|HOURLY_RESOLUTIONS|VERIFIED_COLD_1M_RECOVERY|HOT_1M/)
  assert.match(timeframeService, /RETIRED_INTRADAY_RESOLUTIONS/)
  assert.match(timeframeService, /splitCanonicalSourceRange\("1D"/)
})
