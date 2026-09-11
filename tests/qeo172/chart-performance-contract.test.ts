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

const STAGES: ChartPerfStage[] = [
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
]

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function browserBenchmarkSource() {
  return readFileSync(
    new URL("../browser/qeo172-chart-performance-production.spec.ts", import.meta.url),
    "utf8",
  )
}

function completeResponse(input: ChartRangeInput, times: number[]): ChartHistoryResponse {
  return {
    ok: true,
    ticker: input.ticker.toUpperCase(),
    resolution: input.timeframe,
    from: input.from,
    to: input.to,
    bars: times.map((time, index) => ({
      time,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100.5 + index,
      volume: 1_000 + index,
    })),
    gaps: [],
    integrityIssues: [],
    coverage: { complete: true, state: "COMPLETE" },
    errors: [],
    metadata: {
      priceBasis: "RAW",
      provider: null,
      lastUpdatedAt: new Date(input.to * 1000).toISOString(),
      sessionState: "CLOSED",
      currentBarTime: null,
      persistedThrough: input.to,
    },
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

test("QEO-172 trading date keeps 09:00 onward fresh even after EOD", () => {
  const now = new Date("2026-09-10T16:00:00+07:00")
  const input: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1h",
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-10T15:00:00+07:00"),
  }
  const slices = planChartHistorySlices(input, now)
  assert.equal(slices.stableClosed?.to, epoch("2026-09-10T08:59:59+07:00"))
  assert.equal(slices.currentDateTail?.from, epoch("2026-09-10T09:00:00+07:00"))
  assert.equal(slices.currentDateTail?.to, input.to)
})

test("QEO-172 non-trading date permits the bounded request to stay closed", () => {
  const now = new Date("2026-09-12T10:00:00+07:00")
  const input: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1h",
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-12T09:30:00+07:00"),
  }
  assert.deepEqual(planChartHistorySlices(input, now), {
    stableClosed: input,
    currentDateTail: null,
  })
})

test("QEO-172 future-ending ranges are never stable-cacheable", () => {
  const now = new Date("2026-09-12T10:00:00+07:00")
  const input: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1h",
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-12T11:00:00+07:00"),
  }
  assert.equal(isStableClosedChartRange(input, now), false)
})

test("QEO-172 completed Daily does not get an intraday current-date tail", () => {
  const now = new Date("2026-09-10T10:30:00+07:00")
  const input: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1D",
    from: 1,
    to: epoch("2026-09-10T10:30:00+07:00"),
  }
  assert.deepEqual(planChartHistorySlices(input, now), { stableClosed: input, currentDateTail: null })
})

test("QEO-172 server cache policy admits only safe stable complete ranges", () => {
  const now = new Date("2026-09-10T16:00:00+07:00")
  const stableInput: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1h",
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-09T15:00:00+07:00"),
  }
  const safe = completeResponse(stableInput, [stableInput.from, stableInput.to])
  assert.deepEqual(chartHttpCachePolicy(stableInput, safe, now), {
    cacheControl: "private, max-age=600",
    vary: "Cookie",
  })

  const sameDayInput = { ...stableInput, to: epoch("2026-09-10T15:00:00+07:00") }
  const sameDay = completeResponse(sameDayInput, [sameDayInput.from, sameDayInput.to])
  assert.deepEqual(chartHttpCachePolicy(sameDayInput, sameDay, now), { cacheControl: "no-store" })

  assert.deepEqual(chartHttpCachePolicy(stableInput, {
    ...safe,
    coverage: { complete: false, state: "PARTIAL" },
  }, now), { cacheControl: "no-store" })
})

test("QEO-172 stable request uses default transport while fresh request stays no-store", async () => {
  clearChartHistoryCache()
  const now = new Date("2026-09-12T10:00:00+07:00")
  const input: ChartRangeInput = {
    ticker: "VIC",
    timeframe: "1h",
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-11T15:00:00+07:00"),
  }
  const seen: Array<RequestInit["cache"]> = []
  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.cache)
    return new Response(JSON.stringify(completeResponse(input, [input.from, input.to])), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  await requestChartRange(input, undefined, fetchImpl, { now })
  await requestFreshChartRange(input, undefined, fetchImpl)
  assert.deepEqual(seen, ["default", "no-store"])
})

test("QEO-172 prepareInitialChartHistory merges stable + current-date slices with fresh duplicate winning", async () => {
  clearChartHistoryCache()
  const now = new Date("2026-09-10T16:00:00+07:00")
  const calls: Array<{ cache?: RequestCache; from: number; to: number }> = []
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url), "https://qeoindex.local")
    const input: ChartRangeInput = {
      ticker: parsed.searchParams.get("ticker") || "VIC",
      timeframe: (parsed.searchParams.get("resolution") || "1h") as ChartRangeInput["timeframe"],
      from: Number(parsed.searchParams.get("from")),
      to: Number(parsed.searchParams.get("to")),
    }
    calls.push({ cache: init?.cache, from: input.from, to: input.to })
    const isFresh = init?.cache === "no-store"
    const duplicate = epoch("2026-09-10T09:00:00+07:00")
    const result = completeResponse(input, isFresh ? [duplicate, input.to] : [input.from, duplicate])
    if (isFresh && result.bars[0]) result.bars[0] = { ...result.bars[0], close: 999 }
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } })
  }

  const prepared = await prepareInitialChartHistory({
    ticker: "VIC",
    timeframe: "1h",
    now,
    fetchImpl,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((call) => call.cache).sort(), ["default", "no-store"].sort())
  const duplicate = prepared.result.bars.find((bar) => bar.time === epoch("2026-09-10T09:00:00+07:00"))
  assert.equal(duplicate?.close, 999)
  assert.equal(prepared.result.coverage.complete, true)
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

  assert.ok(partialWrite >= 0, "benchmark must persist an incomplete baseline artifact")
  assert.ok(adjacentMeasure >= 0, "benchmark must measure adjacent ticker navigation")
  assert.ok(completeWrite >= 0, "benchmark must persist a completed artifact after adjacent navigation")
  assert.ok(partialWrite < adjacentMeasure, "matrix artifact must exist before adjacent navigation can fail")
  assert.ok(adjacentMeasure < completeWrite, "completed marker must only be written after adjacent navigation succeeds")
})
